"""Draw the app icons (app/*.png): the museum's eye (the favicon) on paper.

    python tools/make_icons.py

Writes the home-screen icons the web app manifest and iOS use: 180 px
(apple-touch-icon), 192 and 512 px, and a 512 px maskable one whose eye sits
inside the safe zone Android crops to.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'app'
PAPER = (247, 245, 240)
PAPER_EDGE = (235, 230, 220)
INK = (29, 26, 22)
IRIS = (63, 163, 143)


def quad(p0, p1, p2, n=64):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


def icon(size, eye_scale):
    s = size * 4  # drawn large, then scaled down smoothly
    img = Image.new('RGB', (s, s), PAPER)
    d = ImageDraw.Draw(img)
    # A soft paper vignette, like the welcome screen's.
    for i in range(40):
        t = i / 40
        c = tuple(round(PAPER_EDGE[k] + (PAPER[k] - PAPER_EDGE[k]) * t) for k in range(3))
        r = s * (0.75 - 0.4 * t)
        d.ellipse([s / 2 - r, s * 0.46 - r, s / 2 + r, s * 0.46 + r], fill=c)
    # The eye, in the favicon's 64-unit drawing, scaled to `eye_scale` of the icon.
    k = s * eye_scale / 56
    ox = s / 2 - 32 * k
    oy = s / 2 - 32 * k
    P = lambda x, y: (ox + x * k, oy + y * k)  # noqa: E731
    outline = quad(P(4, 32), P(32, 6), P(60, 32), 600) + quad(P(60, 32), P(32, 58), P(4, 32), 600)[1:]
    d.polygon(outline, fill=(255, 255, 255))
    # The outline with a round brush: a disc at every point along it.
    w = 1.5 * k
    for x, y in outline:
        d.ellipse([x - w, y - w, x + w, y + w], fill=INK)
    for r, col in ((11, IRIS), (5, (0, 0, 0))):
        cx, cy = P(32, 32)
        d.ellipse([cx - r * k, cy - r * k, cx + r * k, cy + r * k], fill=col)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    icon(180, 0.74).save(OUT / 'apple-touch-icon.png', optimize=True)
    icon(192, 0.74).save(OUT / 'icon-192.png', optimize=True)
    icon(512, 0.74).save(OUT / 'icon-512.png', optimize=True)
    icon(512, 0.56).save(OUT / 'icon-maskable-512.png', optimize=True)
    print('icons written to', OUT)


if __name__ == '__main__':
    main()
