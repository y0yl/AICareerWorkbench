"""运行配置：读取项目根目录的 .env 与环境变量（环境变量优先）。"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


HOST = os.environ.get("HOST", "127.0.0.1")
PORT = _int("PORT", 8080)
WEB_DIR = ROOT / "web"
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))

# Qwen / DashScope（OpenAI 兼容模式）
QWEN_API_KEY = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY", "")
QWEN_BASE_URL = os.environ.get(
    "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
).rstrip("/")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-plus")
# 备用模型（逗号分隔）：主模型额度用尽 / 限流 / 不可用时依次尝试。每个模型有独立免费额度。
# 视觉任务（成绩单识别）用的模型
QWEN_VL_MODEL = os.environ.get("QWEN_VL_MODEL", "qwen-vl-max").strip()
QWEN_FALLBACK_MODELS = [m.strip() for m in os.environ.get("QWEN_FALLBACK_MODELS", "").split(",") if m.strip()]
QWEN_TIMEOUT = _int("QWEN_TIMEOUT", 90)
# 使用 qwen3 系列开源模型（默认开启思考模式）时设为 1，关闭思考以支持 JSON 模式
QWEN_DISABLE_THINKING = os.environ.get("QWEN_DISABLE_THINKING", "0") == "1"

# 保护你的 API 额度：单 IP 每小时次数、全站每日总次数
AI_RATE_PER_HOUR = _int("AI_RATE_PER_HOUR", 60)
AI_DAILY_CAP = _int("AI_DAILY_CAP", 3000)

# 部署在 nginx 之后时设为 1，使用 X-Real-IP 识别访客
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
ALLOW_REGISTER = os.environ.get("ALLOW_REGISTER", "1") == "1"
MAX_BODY = 3 * 1024 * 1024
