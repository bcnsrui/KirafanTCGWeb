"""Draw a clean deck frame: identical corners, no outer junk, translucent fill."""
from PIL import Image, ImageDraw
from pathlib import Path

dst = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\home\menu-card-deck-frame.png")

SIZE = 640
OUTER = 10
BAND = 22
RIVET = 8
EAR = 20

CREAM = (236, 214, 180, 255)
CREAM_HI = (248, 234, 210, 255)
GOLD = (148, 108, 70, 255)
GOLD_DK = (110, 78, 48, 255)
FILL = (28, 16, 10, 138)


def draw_corner(base: Image.Image, x: int, y: int):
    """Paste identical corner ornament centered at (x,y)."""
    s = EAR * 2 + 6
    c = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    cx = cy = s // 2
    d.ellipse([cx - EAR, cy - EAR, cx + EAR, cy + EAR], fill=CREAM, outline=GOLD, width=3)
    d.ellipse([cx - RIVET - 1, cy - RIVET - 1, cx + RIVET + 1, cy + RIVET + 1], fill=GOLD_DK)
    d.ellipse([cx - 3, cy - 4, cx + 4, cy + 2], fill=(190, 152, 112, 255))
    base.alpha_composite(c, (x - cx, y - cy))


def main():
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # translucent fill
    f0 = OUTER + 4
    d.rounded_rectangle([f0, f0, SIZE - f0 - 1, SIZE - f0 - 1], radius=16, fill=FILL)

    # gold outer rim (filled then punch)
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.rounded_rectangle([OUTER, OUTER, SIZE - OUTER - 1, SIZE - OUTER - 1], radius=18, fill=GOLD)
    rd.rounded_rectangle(
        [OUTER + 3, OUTER + 3, SIZE - OUTER - 4, SIZE - OUTER - 4],
        radius=16,
        fill=(0, 0, 0, 0),
    )
    im = Image.alpha_composite(im, ring)

    # cream band
    cream = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cream)
    a0 = OUTER + 3
    a1 = OUTER + 3 + BAND
    cd.rounded_rectangle([a0, a0, SIZE - a0 - 1, SIZE - a0 - 1], radius=16, fill=CREAM)
    cd.rounded_rectangle([a1, a1, SIZE - a1 - 1, SIZE - a1 - 1], radius=12, fill=(0, 0, 0, 0))
    im = Image.alpha_composite(im, cream)

    # inner gold + cream highlight
    inner = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    idr = ImageDraw.Draw(inner)
    b0 = a1
    idr.rounded_rectangle([b0, b0, SIZE - b0 - 1, SIZE - b0 - 1], radius=12, outline=GOLD, width=3)
    idr.rounded_rectangle([b0 + 3, b0 + 3, SIZE - b0 - 4, SIZE - b0 - 4], radius=10, outline=CREAM_HI, width=2)
    im = Image.alpha_composite(im, inner)

    # four identical corner rivets
    c = OUTER + BAND // 2 + 2
    for x, y in ((c, c), (SIZE - 1 - c, c), (c, SIZE - 1 - c), (SIZE - 1 - c, SIZE - 1 - c)):
        draw_corner(im, x, y)

    im.save(dst, "PNG")
    print("saved", dst, im.size, "center", im.getpixel((SIZE // 2, SIZE // 2)))


if __name__ == "__main__":
    main()
