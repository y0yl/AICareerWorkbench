#!/usr/bin/env python3
"""生成 PWA 图标（需要 Pillow）：python3 tools/build_icons.py

图形与站标同源：小球沿 loss 曲线滚进谷底，谷底一圈圈等高线；配色取站点默认的纸面主题。
- icon-192 / icon-512：带圆角的完整图标（purpose any）
- maskable-512：内容收进 80% 安全区、底色铺满（purpose maskable，安卓自适应图标）
- apple-touch-icon：180×180，iOS 主屏
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
# 纸面主题（站点默认）：暖白纸 + 墨色曲线 + 荧光笔小球，等高线用纸面主题的深绿
BG = (239, 237, 230)
INK = (21, 22, 26)
LINE = (171, 165, 149)
RING = (93, 138, 0)
LIME = (205, 245, 69)
SS = 4  # 超采样倍数


def cubic(p0, p1, p2, p3, n=160):
    return [
        tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))
        for t in (i / n for i in range(n + 1))
    ]


def stroke(draw, pts, width, color):
    """沿路径密集地盖圆点：粗线条也没有折线接缝，端点自然是圆头。"""
    r = width / 2
    step = max(1.0, r / 6)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def render(size, *, safe=1.0, rounded=True):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rad = S * 0.22 if rounded else 0
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=rad, fill=BG)

    # 32 单位画布（与 favicon 相同），内容按 safe 缩放到中心
    k = S / 32 * safe
    off = (S - 32 * k) / 2
    P = lambda x, y: (off + x * k, off + y * k)  # noqa: E731
    ball = (17, 21)

    # 谷底等高线：以小球为中心的同心椭圆，越靠里越亮
    rings = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    cx, cy = P(*ball)
    rd.ellipse((cx - 7.4 * k, cy - 4.9 * k, cx + 7.4 * k, cy + 4.9 * k), fill=(*LIME, 255))  # 谷底涂上荧光笔
    for i, (rx, ry) in enumerate([(4.6, 3.0), (7.4, 4.9), (10.4, 6.9), (13.6, 9.0)]):
        cx, cy = P(*ball)
        a = int(120 * (1 - i / 4.4))
        rd.ellipse((cx - rx * k, cy - ry * k, cx + rx * k, cy + ry * k), outline=(*RING, a), width=max(1, round(0.45 * k)))
    img.alpha_composite(rings)
    # 圆角之外的等高线裁掉
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=rad, fill=255)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (S, S), 0), mask))
    d = ImageDraw.Draw(img)

    tail = cubic(P(17, 21), P(21, 21), P(24, 19), P(26, 19))
    stroke(d, tail, 1.7 * k, LINE)
    main = cubic(P(6, 8), P(10, 8), P(11, 21), P(17, 21))
    stroke(d, main, 1.9 * k, INK)

    gx, gy = P(*ball)
    r = 3.0 * k
    d.ellipse((gx - r, gy - r, gx + r, gy + r), fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    render(192).save(OUT / "icon-192.png", optimize=True)
    render(512).save(OUT / "icon-512.png", optimize=True)
    render(512, safe=0.78, rounded=False).save(OUT / "maskable-512.png", optimize=True)
    render(180, safe=0.9, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    for f in sorted(OUT.glob("*.png")):
        print(f"{f.relative_to(OUT.parent.parent)}  {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
