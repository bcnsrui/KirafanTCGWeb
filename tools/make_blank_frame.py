"""Take 2nd menu card, remove character + ribbon text, save shared blank frame."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
from collections import Counter

src = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\home\menu-card-ai.png")
dst = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\home\menu-card-frame.png")

im = Image.open(src).convert("RGBA")
w, h = im.size
px = im.load()


def cream_dist(r, g, b, cr, cg, cb):
    return abs(r - cr) + abs(g - cg) + abs(b - cb)


def is_brown(r, g, b):
    return r >= 55 and g >= 25 and b >= 10 and r > g >= b - 8 and (r - b) >= 25 and (r + g + b) < 520


def is_near_cream(r, g, b, cr, cg, cb, thr=55):
    if cream_dist(r, g, b, cr, cg, cb) <= thr:
        return True
    # warm parchment variants
    if r >= 210 and g >= 185 and b >= 145 and (r - b) >= 15:
        return True
    return False


# sample cream from upper interior (avoid frame)
samples = []
for y in range(int(h * 0.08), int(h * 0.22)):
    for x in range(int(w * 0.18), int(w * 0.82)):
        r, g, b, a = px[x, y]
        if a < 200:
            continue
        if is_brown(r, g, b):
            continue
        if r >= 200 and g >= 175 and b >= 130:
            samples.append((r, g, b))

# most common cream-ish
if not samples:
    cr, cg, cb = (245, 232, 210)
else:
    # average of brightest warm samples
    samples.sort(key=lambda t: t[0] + t[1], reverse=True)
    take = samples[: max(20, len(samples) // 5)]
    cr = sum(t[0] for t in take) // len(take)
    cg = sum(t[1] for t in take) // len(take)
    cb = sum(t[2] for t in take) // len(take)

print("cream", cr, cg, cb)

# ribbon band approx
ribbon_top = int(h * 0.72)
ribbon_bot = int(h * 0.92)

# remove character / non-cream in interior, keep frame+ribbon wood
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a < 8:
            continue
        # keep outer transparent fringe
        # protect brown ribbon wood
        if ribbon_top <= y <= ribbon_bot and is_brown(r, g, b):
            continue
        # protect darker frame outline near edges of opaque card
        # interior clear: replace non-cream with cream
        if y < ribbon_top and not is_near_cream(r, g, b, cr, cg, cb, thr=48):
            # don't erase thick outer frame: if near left/right opaque edge with tan frame, keep browns/tans
            if is_brown(r, g, b) and (x < w * 0.12 or x > w * 0.88 or y < h * 0.08):
                continue
            # faint pattern: slight variation
            jitter = ((x * 17 + y * 13) % 7) - 3
            px[x, y] = (
                max(0, min(255, cr + jitter)),
                max(0, min(255, cg + jitter)),
                max(0, min(255, cb + max(-2, jitter // 2))),
                a,
            )

# blank ribbon text: paint over bright (white) glyphs on ribbon
for y in range(ribbon_top, min(h, ribbon_bot + 1)):
    for x in range(int(w * 0.12), int(w * 0.88)):
        r, g, b, a = px[x, y]
        if a < 8:
            continue
        # white / light text
        if r >= 200 and g >= 190 and b >= 170 and (r + g + b) >= 600:
            # sample nearby brown
            nbr = None
            for dx, dy in ((0, 8), (0, -8), (12, 0), (-12, 0), (0, 14)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    rr, gg, bb, aa = px[nx, ny]
                    if aa > 200 and is_brown(rr, gg, bb):
                        nbr = (rr, gg, bb, a)
                        break
            if nbr:
                px[x, y] = nbr
            else:
                px[x, y] = (92, 58, 40, a)

im.save(dst, "PNG")
print("saved", dst, im.size)
