#!/usr/bin/env python3
"""Epoch · AI 专业生涯训练台 —— 零依赖后端（仅需 Python 3.9+ 标准库）。

    python3 server/app.py            # 默认 http://127.0.0.1:8080
"""
import email.utils
import json
import re
import mimetypes
import threading
import time
import traceback
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import config
import guard
import mock
import prompts
import qwen
from store import Store, StoreError

store = Store()
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")


_build = {"at": 0.0, "mtime": 0.0}


def build_mtime():
    """web/ 下 css/js 的最新修改时间（每 2 秒最多扫描一次）。"""
    now = time.time()
    if now - _build["at"] > 2:
        files = [p for d in ("css", "js") for p in (config.WEB_DIR / d).rglob("*") if p.is_file()]
        _build["mtime"] = max((p.stat().st_mtime for p in files), default=0.0)
        _build["at"] = now
    return _build["mtime"]


_updated = {"at": 0.0, "mtime": 0.0}


def updated_at():
    """项目最近一次更新的时间：前端代码、页面与后端代码中最新的修改时间（部署用 rsync -a 保留原始时间）。"""
    now = time.time()
    if now - _updated["at"] > 30:
        files = [config.WEB_DIR / "index.html", *config.ROOT.joinpath("server").glob("*.py")]
        _updated["mtime"] = max([build_mtime(), *(p.stat().st_mtime for p in files if p.is_file())])
        _updated["at"] = now
    return _updated["mtime"]


def build_id():
    return format(int(build_mtime()), "x")


class RateLimiter:
    def __init__(self):
        self.hits = defaultdict(deque)
        self.day = time.strftime("%Y%m%d")
        self.day_count = 0
        self.lock = threading.Lock()

    def check(self, ip: str):
        now = time.time()
        with self.lock:
            today = time.strftime("%Y%m%d")
            if today != self.day:
                self.day, self.day_count = today, 0
            if self.day_count >= config.AI_DAILY_CAP:
                return "今日全站 AI 调用已达上限，明天再来吧"
            q = self.hits[ip]
            while q and now - q[0] > 3600:
                q.popleft()
            if len(q) >= config.AI_RATE_PER_HOUR:
                return "调用太频繁啦，休息一下再继续训练"
            q.append(now)
            self.day_count += 1
        return None


limiter = RateLimiter()


class AuthLimiter:
    """登录/注册防暴力尝试：单 IP 每 10 分钟最多 20 次。"""

    def __init__(self, limit=20, window=600):
        self.limit, self.window = limit, window
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, ip):
        now = time.time()
        with self.lock:
            q = self.hits[ip]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


auth_limiter = AuthLimiter()

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    "font-src 'self'; connect-src 'self'; script-src 'self'; frame-ancestors 'self'; base-uri 'self'"
)


class Handler(BaseHTTPRequestHandler):
    server_version = "Epoch"
    sys_version = ""  # 不暴露 Python 版本
    protocol_version = "HTTP/1.1"

    # ---------- 基础工具 ----------
    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def client_ip(self):
        if config.TRUST_PROXY:
            return self.headers.get("X-Real-IP") or self.client_address[0]
        return self.client_address[0]

    def _common_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._common_headers()
        self.end_headers()
        self.wfile.write(body)

    def error_json(self, message, status=400):
        self.send_json({"ok": False, "error": message}, status)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > config.MAX_BODY:
            raise StoreError("请求体过大", 413)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise StoreError("请求格式错误")
        if not isinstance(data, dict):
            raise StoreError("请求格式错误")
        return data

    def token(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:] if auth.startswith("Bearer ") else ""

    def require_user(self):
        user = store.user_for(self.token())
        if not user:
            raise StoreError("请先登录", 401)
        return user

    # ---------- 路由 ----------
    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/health":
                # 不返回模型名称：前端只需要知道 AI 是否在线
                return self.send_json({"ok": True, "ai": qwen.enabled(), "register": config.ALLOW_REGISTER, "updated": int(updated_at() * 1000), "build": build_id()})
            if path == "/api/me":
                user = self.require_user()
                return self.send_json({"ok": True, "user": user})
            if path == "/api/state":
                user = self.require_user()
                state, updated = store.get_state(user["id"])
                return self.send_json({"ok": True, "state": state, "updatedAt": updated})
            m = re.match(r"^/api/feed/([A-Za-z0-9_\-]{10,64})\.(ics|json)$", path)
            if m:
                return self.serve_feed(m.group(1), m.group(2))
            m = re.match(r"^/api/snapshot/([A-Za-z0-9_\-]{6,32})$", path)
            if m:
                state, created = store.get_snapshot(m.group(1))
                if not state:
                    return self.error_json("快照不存在或已删除", 404)
                return self.send_json({"ok": True, "state": state, "createdAt": created})
            if path.startswith("/api/"):
                return self.error_json("Not found", 404)
            return self.serve_static(path)
        except StoreError as e:
            self.error_json(str(e), e.status)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path in ("/api/auth/register", "/api/auth/login") and not auth_limiter.allow(self.client_ip()):
                raise StoreError("尝试次数过多，请 10 分钟后再试", 429)
            if path == "/api/auth/register":
                if not config.ALLOW_REGISTER:
                    raise StoreError("当前站点未开放注册", 403)
                body = self.read_json()
                token = store.register(body.get("username", "").strip(), body.get("password", ""))
                return self.send_json({"ok": True, "token": token, "username": body["username"].strip()})
            if path == "/api/auth/login":
                body = self.read_json()
                token = store.login(body.get("username", "").strip(), body.get("password", ""))
                return self.send_json({"ok": True, "token": token, "username": body["username"].strip()})
            if path == "/api/auth/logout":
                store.logout(self.token())
                return self.send_json({"ok": True})
            if path == "/api/feed":
                user = self.require_user()
                body = self.read_json()
                if body.get("disable"):
                    store.drop_feed(user["id"])
                    return self.send_json({"ok": True, "token": None})
                widget = body.get("widget") if isinstance(body.get("widget"), dict) else {}
                kinds = body.get("kinds") if isinstance(body.get("kinds"), dict) else {}
                rotate = body.get("rotate")
                rotate = rotate if rotate in ("widget", "cal") else ("all" if rotate is True else None)
                widget_on, cal_on = kinds.get("widget", True) is not False, kinds.get("cal", True) is not False
                if not widget_on and not cal_on:
                    store.drop_feed(user["id"])
                    return self.send_json({"ok": True, "token": None, "calToken": None})
                res = store.put_feed(user["id"], str(body.get("ics") or "")[:400000], widget, rotate, widget_on, cal_on)
                return self.send_json({"ok": True, **res})
            if path == "/api/snapshot":
                body = self.read_json()
                if not isinstance(body.get("state"), dict):
                    raise StoreError("state 必须是对象")
                return self.send_json({"ok": True, "id": store.put_snapshot(body["state"])})
            if path.startswith("/api/ai/"):
                return self.handle_ai(path[len("/api/ai/"):])
            return self.error_json("Not found", 404)
        except StoreError as e:
            self.error_json(str(e), e.status)

    def do_PUT(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/state":
                user = self.require_user()
                body = self.read_json()
                state = body.get("state")
                if not isinstance(state, dict):
                    raise StoreError("state 必须是对象")
                base = body.get("base")
                res = store.put_state(user["id"], state, base if isinstance(base, int) else None)
                if res["conflict"]:
                    return self.send_json({"ok": False, "error": "云端数据已在其他设备更新", "conflict": True, "state": res["state"], "updatedAt": res["updatedAt"]}, 409)
                return self.send_json({"ok": True, "updatedAt": res["updatedAt"]})
            return self.error_json("Not found", 404)
        except StoreError as e:
            self.error_json(str(e), e.status)

    # ---------- AI ----------
    def handle_ai(self, task):
        spec = prompts.TASKS.get(task)
        if not spec:
            return self.error_json("未知的 AI 任务", 404)
        payload = self.read_json()
        kind, builder, temperature = spec
        use_mock = not qwen.enabled()
        # 预检：问模型身份、套提示词、明显无关的请求 → 固定回答，不调用模型
        guarded, canned = guard.precheck(task, payload)
        if guarded:
            return self.stream_text(canned, use_mock, guarded)
        if not use_mock:
            blocked = limiter.check(self.client_ip())
            if blocked:
                return self.error_json(blocked, 429)

        if kind in ("json", "vision"):
            try:
                if use_mock:
                    data = mock.HANDLERS[task](payload)
                else:
                    model = config.QWEN_VL_MODEL if kind == "vision" else None
                    data = qwen.complete_json(guard.harden(builder(payload)), temperature=temperature, model=model)
            except qwen.AIError as e:
                return self.error_json(str(e), 502)
            except Exception:
                traceback.print_exc()
                return self.error_json("AI 任务处理失败", 500)
            return self.send_json({"ok": True, "data": guard.sanitize_obj(data), "mock": use_mock})

        self.begin_sse()

        def emit(event, data):
            self.wfile.write(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()

        # 输出过滤：边流式输出边检查“自我介绍式”泄露。末尾保留 HOLD 个字符暂不发送，
        # 保证泄露片段在被识别前不会到达前端；极少数跨越保留窗口的情况用 replace 事件整体替换。
        HOLD = 12
        state = {"full": "", "sent": ""}

        def push(piece, final=False):
            state["full"] += piece
            clean = guard.sanitize(state["full"])
            ready = clean if final else clean[: max(0, len(clean) - HOLD)]
            if ready.startswith(state["sent"]):
                if len(ready) > len(state["sent"]):
                    emit("delta", {"t": ready[len(state["sent"]):]})
                    state["sent"] = ready
            else:
                emit("replace", {"t": ready})
                state["sent"] = ready

        try:
            emit("meta", {"mock": use_mock})
            if use_mock:
                text = mock.HANDLERS[task](payload)
                for i in range(0, len(text), 6):
                    push(text[i : i + 6])
                    time.sleep(0.012)
            else:
                for piece in qwen.stream(guard.harden(builder(payload)), temperature=temperature, max_tokens=3500):
                    push(piece)
            push("", final=True)
            emit("done", {})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except qwen.AIError as e:
            try:
                emit("error", {"message": str(e)})
            except OSError:
                pass
        except Exception:
            traceback.print_exc()
            try:
                emit("error", {"message": "AI 服务异常"})
            except OSError:
                pass

    def begin_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self._common_headers()
        self.end_headers()
        self.close_connection = True

    def stream_text(self, text, use_mock, kind):
        """把固定文本以 SSE 形式返回（与模型流式输出格式一致）。"""
        self.begin_sse()
        try:
            for event, data in (("meta", {"mock": use_mock, "guard": kind}), ("delta", {"t": text}), ("done", {})):
                self.wfile.write(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def serve_feed(self, token, ext):
        """日历订阅（webcal）与桌面小组件的数据源：凭 token 读取，不需要登录。"""
        feed = store.get_feed(token, "cal" if ext == "ics" else "widget")
        if not feed:
            return self.error_json("订阅不存在或已关闭", 404)
        if ext == "ics":
            body = (feed["ics"] or "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Epoch//ZH\r\nEND:VCALENDAR\r\n").encode()
            ctype = "text/calendar; charset=utf-8"
        else:
            body = json.dumps({"ok": True, "updatedAt": feed["updatedAt"], **feed["widget"]}, ensure_ascii=False).encode()
            ctype = "application/json; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self._common_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ---------- 静态文件 ----------
    def serve_static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        # v/<build>/... 是带版本号的资源地址：内容随部署变化即换 URL，可放心长缓存
        # （Cloudflare 会把 no-cache 改写成 4 小时浏览器缓存，不带版本号会让用户看到旧页面）
        versioned = re.match(r"v/[0-9a-f]+/(.+)", rel)
        if versioned:
            rel = versioned.group(1)
        target = (config.WEB_DIR / rel).resolve()
        web_root = config.WEB_DIR.resolve()
        if web_root not in target.parents and target != web_root:
            return self.error_json("Forbidden", 403)
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            if "." in rel.rsplit("/", 1)[-1]:
                return self.error_json("Not found", 404)
            target = web_root / "index.html"

        is_html = target.suffix == ".html"
        stat = target.stat()
        last_mod = email.utils.formatdate(max(stat.st_mtime, build_mtime()) if is_html else stat.st_mtime, usegmt=True)
        if self.headers.get("If-Modified-Since") == last_mod:
            self.send_response(304)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        body = target.read_bytes()
        if is_html:
            body = re.sub(rb'(href|src)="(css|js|fonts)/', rb'\1="v/' + build_id().encode() + rb'/\2/', body)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", last_mod)
        immutable = bool(versioned) or rel.startswith("fonts/")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-cache")
        if is_html:
            self.send_header("Content-Security-Policy", CSP)
        self._common_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def main():
    server = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    server.daemon_threads = True
    chain = " → ".join([config.QWEN_MODEL] + config.QWEN_FALLBACK_MODELS)
    mode = f"{chain}" if qwen.enabled() else "演示模式（未配置 QWEN_API_KEY）"
    print(f"Epoch 生涯训练台已启动 → http://{config.HOST}:{config.PORT}   AI：{mode}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
