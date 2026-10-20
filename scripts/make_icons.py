"""產生 App 圖示與啟動畫面原始圖（frontend/assets/），再由 @capacitor/assets 產生 Android 各尺寸。

    uv run python scripts/make_icons.py
    cd frontend && npx capacitor-assets generate --android

設計：綠底（#226B4E）＋白色盾牌外框＋透視道路（使用者提供的圖示，重畫成向量比例以便各尺寸清晰）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "assets"
S = 1024


GREEN = (34, 107, 78)  # #226B4E，使用者提供的圖示底色


def gradient(size: int) -> Image.Image:
    """底色：使用者提供的綠色（純色，與參考圖一致）。"""
    return Image.new("RGB", (size, size), GREEN)


def _quad(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


def _cubic(p0, p1, p2, p3, n=60):
    return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
             (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
            for t in (i / n for i in range(n + 1))]


def glyph(size: int, scale: float = 0.62) -> Image.Image:
    """白色盾牌外框＋透視道路（兩側路緣、三段中線），依使用者提供的圖示比例重畫成可縮放的圖形。

    原圖座標以 1254 為邊長：盾牌寬約 820（占 0.65），scale 是盾牌寬占圖示邊長的比例。
    """
    big = size * 4  # 超取樣讓邊緣平滑
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = big * scale / 820          # 原圖 1 單位 → 畫布像素
    ox = big / 2 - 627 * k          # 以原圖中心 (627, 616) 對齊畫布中心
    oy = big / 2 - 616 * k
    P = lambda x, y: (ox + x * k, oy + y * k)
    white = (255, 255, 255, 255)
    # 盾牌外框（描邊的中線），左半邊再鏡射
    left = (_quad(P(627, 187), P(470, 262), P(262, 292))
            + _quad(P(262, 292), P(246, 296), P(246, 335))
            + _cubic(P(246, 335), P(246, 760), P(430, 930), P(627, 1047)))
    right = [(big - x, y) for x, y in reversed(left)]
    outline = left + right[1:]
    w = 64 * k
    # 描邊：沿路徑密集蓋圓形筆刷（Pillow 粗線的接角會出現毛邊），邊緣才會平滑
    pts = outline + [outline[0]]
    step = w / 8
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / step))
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=white)
    # 道路兩側路緣（細長梯形）與中線三段
    for poly in (
        [(540, 383), (565, 383), (424, 833), (377, 767)],
        [(688, 383), (713, 383), (876, 767), (830, 833)],
        [(614, 408), (640, 408), (646, 470), (608, 470)],
        [(607, 517), (650, 517), (656, 610), (598, 610)],
        [(596, 675), (661, 675), (668, 803), (584, 803)],
    ):
        d.polygon([P(x, y) for x, y in poly], fill=white)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    bg = gradient(S)
    # 1. 完整圖示（舊版 Android、Play 用）：圓角方形（iOS 風格曲率）
    icon = bg.copy().convert("RGBA")
    shadow = glyph(S, 0.6).split()[3].filter(ImageFilter.GaussianBlur(18))
    dark = Image.new("RGBA", (S, S), (0, 40, 25, 70))
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
