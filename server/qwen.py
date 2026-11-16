"""Qwen（DashScope OpenAI 兼容接口）客户端：流式文本与 JSON 两种调用。"""
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request

import config


class AIError(Exception):
    pass


def enabled() -> bool:
    return bool(config.QWEN_API_KEY)


# 额度用尽 / 不存在 / 限流的模型暂时跳过（秒）
_COOLDOWN = {}
_SKIP_SECONDS = {403: 1800, 404: 3600, 429: 60}
_lock = threading.Lock()


def _models(model=None):
    now = time.time()
    if model:
        return [model]
    chain = [config.QWEN_MODEL] + [m for m in config.QWEN_FALLBACK_MODELS if m != config.QWEN_MODEL]
    with _lock:
        alive = [m for m in chain if _COOLDOWN.get(m, 0) <= now]
    return alive or chain[:1]


def _open(body):
    req = urllib.request.Request(
        f"{config.QWEN_BASE_URL}/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.QWEN_API_KEY}",
        },
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=config.QWEN_TIMEOUT)


def _request(body: dict, model=None):
    """按模型链依次尝试；只对“换个模型可能就好”的错误切换。错误细节只写服务端日志。"""
    if config.QWEN_DISABLE_THINKING and not model:
        body["enable_thinking"] = False
    last_code = None
    for m in _models(model):
        try:
            return _open({**body, "model": m})
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="ignore")[:300]
            print(f"[ai] {m} HTTP {e.code}: {detail}", file=sys.stderr)
            last_code = e.code
            if e.code in _SKIP_SECONDS or e.code >= 500:
                with _lock:
                    _COOLDOWN[m] = time.time() + _SKIP_SECONDS.get(e.code, 30)
                continue
            raise AIError("AI 服务暂时不可用，请稍后再试")
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"[ai] upstream unreachable ({m}): {e}", file=sys.stderr)
            raise AIError("AI 服务暂时无法连接，请稍后再试")
    if last_code in (403, 429):
        raise AIError("AI 服务繁忙或额度不足，请稍后再试")
    raise AIError("AI 服务暂时不可用，请稍后再试")


def stream(messages, temperature=0.7, max_tokens=2000):
    """逐段产出模型回复文本。"""
    body = {
        "model": config.QWEN_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    resp = _request(body)
    with resp:
        for raw in resp:
            line = raw.decode("utf-8", errors="ignore").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if choices:
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield delta


def complete_json(messages, temperature=0.3, max_tokens=2500, model=None) -> dict:
    """model：指定单个模型（如视觉模型），不走降级链；此时不强制 JSON 模式（部分视觉模型不支持），靠容错解析。"""
    body = {
        "model": model or config.QWEN_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if not model:
        body["response_format"] = {"type": "json_object"}
    with _request(body, model) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"] or ""
    return parse_json(text)


def parse_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise AIError("模型返回的内容不是有效 JSON，请重试")
