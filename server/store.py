"""账号与训练状态存储（SQLite，标准库实现）。"""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time

import config

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-一-龥]{2,24}$")
SESSION_TTL = 60 * 60 * 24 * 60  # 60 天


class StoreError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Store:
    def __init__(self):
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(
            str(config.DATA_DIR / "epoch.db"), check_same_thread=False, isolation_level=None
        )
        self._db.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                pw_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS states (
                user_id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS feeds (
                user_id INTEGER PRIMARY KEY,
                token TEXT UNIQUE NOT NULL,
                ics TEXT NOT NULL DEFAULT '',
                widget TEXT NOT NULL DEFAULT '{}',
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """
        )
        # 迁移：桌面小组件与日历订阅拆成两个独立地址、各自开关（旧行 cal_token 为空，首次发布时沿用 token，已订阅的日历不受影响）
        cols = {r[1] for r in self._db.execute("PRAGMA table_info(feeds)")}
        if "cal_token" not in cols:
            self._db.execute("ALTER TABLE feeds ADD COLUMN cal_token TEXT")
            self._db.execute("ALTER TABLE feeds ADD COLUMN widget_on INTEGER NOT NULL DEFAULT 1")
            self._db.execute("ALTER TABLE feeds ADD COLUMN cal_on INTEGER NOT NULL DEFAULT 1")
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS feeds_cal_token ON feeds(cal_token)")

    @staticmethod
    def _hash_pw(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _new_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        self._db.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            (self._hash_token(token), user_id, int(time.time())),
        )
        return token

    def register(self, username: str, password: str) -> str:
        if not USERNAME_RE.match(username or ""):
            raise StoreError("用户名需为 2-24 位中英文、数字、下划线或短横线")
        if len(password or "") < 6:
            raise StoreError("密码至少 6 位")
        salt = secrets.token_hex(16)
        with self._lock:
            try:
                cur = self._db.execute(
                    "INSERT INTO users (username, pw_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                    (username, self._hash_pw(password, salt), salt, int(time.time())),
                )
            except sqlite3.IntegrityError:
                raise StoreError("用户名已被占用", 409)
            return self._new_session(cur.lastrowid)

    def login(self, username: str, password: str) -> str:
        with self._lock:
            row = self._db.execute(
                "SELECT id, pw_hash, salt FROM users WHERE username = ?", (username or "",)
            ).fetchone()
            if not row or not hmac.compare_digest(row[1], self._hash_pw(password or "", row[2])):
                raise StoreError("用户名或密码错误", 401)
            return self._new_session(row[0])

    def logout(self, token: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE token_hash = ?", (self._hash_token(token),))

    def user_for(self, token: str):
        if not token:
            return None
        with self._lock:
            row = self._db.execute(
                "SELECT u.id, u.username, s.created_at FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ?",
                (self._hash_token(token),),
            ).fetchone()
        if not row or time.time() - row[2] > SESSION_TTL:
            return None
        return {"id": row[0], "username": row[1]}

    def get_state(self, user_id: int):
        with self._lock:
            row = self._db.execute(
                "SELECT data, updated_at FROM states WHERE user_id = ?", (user_id,)
            ).fetchone()
        if not row:
            return None, 0
        return json.loads(row[0]), row[1]

    def put_state(self, user_id: int, state: dict, base=None):
        """保存状态。base 为客户端上次见到的云端版本（updated_at）；云端已被别的设备更新时返回冲突，由客户端合并后重试。"""
        data = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        if len(data.encode()) > config.MAX_BODY:
            raise StoreError("数据过大", 413)
        with self._lock:
            row = self._db.execute("SELECT data, updated_at FROM states WHERE user_id = ?", (user_id,)).fetchone()
            if base is not None and row and row[1] != base:
                return {"conflict": True, "state": json.loads(row[0]), "updatedAt": row[1]}
            now = max(int(time.time() * 1000), (row[1] + 1) if row else 0)
            self._db.execute(
                "INSERT INTO states (user_id, data, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                (user_id, data, now),
            )
        return {"conflict": False, "updatedAt": now}

    # ---------- 订阅源：日历（.ics）与桌面小组件（JSON），用不可猜的 token 公开读取 ----------
    def put_feed(self, user_id: int, ics: str, widget: dict, rotate=None, widget_on=True, cal_on=True) -> dict:
        """rotate: None | "widget" | "cal" | "all"——只给对应的那一项换新地址。"""
        data = json.dumps(widget, ensure_ascii=False, separators=(",", ":"))
        if len(ics) + len(data) > 512 * 1024:
            raise StoreError("订阅数据过大", 413)
        now = int(time.time() * 1000)
        with self._lock:
            row = self._db.execute("SELECT token, cal_token FROM feeds WHERE user_id = ?", (user_id,)).fetchone()
            token = secrets.token_urlsafe(18) if (not row or rotate in ("widget", "all")) else row[0]
            cal = row and (row[1] or row[0])
            cal_token = secrets.token_urlsafe(18) if (not cal or rotate in ("cal", "all")) else cal
            self._db.execute(
                "INSERT INTO feeds (user_id, token, cal_token, ics, widget, widget_on, cal_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, cal_token = excluded.cal_token, ics = excluded.ics, widget = excluded.widget, "
                "widget_on = excluded.widget_on, cal_on = excluded.cal_on, updated_at = excluded.updated_at",
                (user_id, token, cal_token, ics, data, int(bool(widget_on)), int(bool(cal_on)), now),
            )
        return {"token": token, "calToken": cal_token}

    def drop_feed(self, user_id: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM feeds WHERE user_id = ?", (user_id,))

    def get_feed(self, token: str, kind: str):
        """kind="widget" 按小组件地址读 JSON；kind="cal" 按日历地址读 .ics（未迁移的旧行沿用 token）。"""
        if not token:
            return None
        with self._lock:
            if kind == "cal":
                row = self._db.execute(
                    "SELECT ics, widget, updated_at FROM feeds WHERE cal_on = 1 AND (cal_token = ? OR (cal_token IS NULL AND token = ?))", (token, token)
                ).fetchone()
            else:
                row = self._db.execute("SELECT ics, widget, updated_at FROM feeds WHERE widget_on = 1 AND token = ?", (token,)).fetchone()
        return {"ics": row[0], "widget": json.loads(row[1]), "updatedAt": row[2]} if row else None

    # ---------- 只读快照 ----------
    def put_snapshot(self, state: dict) -> str:
        data = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        if len(data.encode()) > config.MAX_BODY:
            raise StoreError("数据过大", 413)
        sid = secrets.token_urlsafe(9)
        with self._lock:
            self._db.execute("INSERT INTO snapshots VALUES (?, ?, ?)", (sid, data, int(time.time() * 1000)))
        return sid

    def get_snapshot(self, sid: str):
        with self._lock:
            row = self._db.execute("SELECT data, created_at FROM snapshots WHERE id = ?", (sid,)).fetchone()
        return (json.loads(row[0]), row[1]) if row else (None, 0)

