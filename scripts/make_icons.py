"""產生 App 圖示與啟動畫面原始圖（frontend/assets/），再由 @capacitor/assets 產生 Android 各尺寸。

    uv run python scripts/make_icons.py
    cd frontend && npx capacitor-assets generate --android

設計：紅色漸層（#ff6b5f → #ff3b30 → #d70015）＋白色圓角警示三角形與驚嘆號，與 App 內圖示一致。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "assets"
S = 1024


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    stops = [(0.0, (255, 107, 95)), (0.5, (255, 59, 48)), (1.0, (215, 0, 21))]
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size  # 斜向漸層
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t <= t1:
                    k = (t - t0) / (t1 - t0)
                    px[x, y] = tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
                    break
            else:
                px[x, y] = stops[-1][1]
    return img


def glyph(size: int, scale: float = 0.62) -> Image.Image:
    """白色圓角三角形＋紅色驚嘆號（透明背景）。"""
    big = size * 4  # 超取樣讓邊緣平滑
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = big * scale
    cx, cy = big / 2, big / 2 + big * 0.02
    h = w * 0.88
    tri = [(cx, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
    d.polygon(tri, fill=(255, 255, 255, 255))
    r = big * 0.035  # 圓角：在三個角畫圓並用描邊加粗
    d.line(tri + [tri[0]], fill=(255, 255, 255, 255), width=int(r * 2), joint="curve")
    for x, y in tri:
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255))
    red = (230, 30, 30, 255)
    bw = w * 0.085
    d.rounded_rectangle([cx - bw / 2, cy - h * 0.16, cx + bw / 2, cy + h * 0.2], radius=bw / 2, fill=red)
    d.ellipse([cx - bw * 0.62, cy + h * 0.27, cx + bw * 0.62, cy + h * 0.27 + bw * 1.24], fill=red)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    bg = gradient(S)
    # 1. 完整圖示（舊版 Android、Play 用）：圓角方形（iOS 風格曲率）
    icon = bg.copy().convert("RGBA")
    shadow = glyph(S, 0.6).split()[3].filter(ImageFilter.GaussianBlur(18))
    dark = Image.new("RGBA", (S, S), (120, 0, 0, 90))
    icon.paste(dark, (0, 14), shadow)
    icon.alpha_composite(glyph(S, 0.6))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2237), fill=255)
    icon.putalpha(mask)
    icon.save(OUT / "icon-only.png")
    # 2. Adaptive icon：前景（圖案留在安全區 66% 內）＋背景（漸層）
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fg.alpha_composite(glyph(S, 0.42))
    fg.save(OUT / "icon-foreground.png")
    bg.save(OUT / "icon-background.png")
    # 3. 啟動畫面（2732×2732，置中圖示）：淺色與深色
    for name, color in (("splash.png", (242, 242, 247)), ("splash-dark.png", (0, 0, 0))):
        sp = Image.new("RGB", (2732, 2732), color)
        small = icon.resize((440, 440), Image.LANCZOS)
        sp.paste(small, ((2732 - 440) // 2, (2732 - 440) // 2), small)
        sp.save(OUT / name)
    print(f"已產生：{', '.join(p.name for p in sorted(OUT.glob('*.png')))}")


if __name__ == "__main__":
    main()
