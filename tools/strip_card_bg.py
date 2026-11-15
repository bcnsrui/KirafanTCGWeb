"""Remove only the flat outer backdrop; never eat cream fill or wood frame."""
from PIL import Image
from pathlib import Path
from collections import deque
import shutil

src_cursor = Path(r"C:\Users\sanso\.cursor\projects\d-KirafanEdo-Windows-PC\assets")
dst_dir = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\home")
dst_dir.mkdir(parents=True, exist_ok=True)

jobs = [
    (src_cursor / "menu-card-server.jpg", dst_dir / "menu-card-server.png", 38),
    (src_cursor / "menu-card-ai.jpg", dst_dir / "menu-card-ai.png", 38),
    (src_cursor / "menu-card-story.jpg", dst_dir / "menu-card-story.png", 38),
    (src_cursor / "menu-card-replay.jpg", dst_dir / "menu-card-replay.png", 38),
    (src_cursor / "menu-card-deck-v2.jpg", dst_dir / "menu-card-deck.png", 38),
]


def is_neutral_backdrop(r: int, g: int, b: int) -> bool:
    """Flat gray/white/black studio backdrop — safe to erase from edges."""
    if abs(r - g) <= 14 and abs(g - b) <= 14 and abs(r - b) <= 14:
        return True
    return False


def is_cream_or_wood(r: int, g: int, b: int) -> bool:
    if is_neutral_backdrop(r, g, b):
        return False
    # cream parchment / soft gold frame (warm)
    if r >= 195 and g >= 165 and b >= 120 and (r - b) >= 18:
        return True
    # wood / brown ribbon / dark outline
    if r >= 55 and g >= 30 and b >= 15 and r > g and g >= b - 5 and (r - b) >= 22:
        return True
    # mid tan frame
    if 130 <= r <= 225 and 95 <= g <= 195 and 55 <= b <= 165 and r >= g and (r - b) >= 15:
        return True
    return False


def remove_outer_bg(im: Image.Image, thr: int = 38) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size

    samples = []
    for x, y in (
        (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
        (w // 2, 0), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1),
        (2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3),
    ):
        r, g, b, a = px[x, y]
        if a > 8 and not is_cream_or_wood(r, g, b):
            samples.append((r, g, b))
    if not samples:
        # fallback: corners anyway
        for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            r, g, b, a = px[x, y]
            if a > 8:
                samples.append((r, g, b))
    if not samples:
        return im

    br = sum(s[0] for s in samples) // len(samples)
    bg = sum(s[1] for s in samples) // len(samples)
    bb = sum(s[2] for s in samples) // len(samples)

    visited = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    limit = thr * 3
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        visited[y][x] = True
        r, g, b, a = px[x, y]
        if a == 0:
            q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            continue
        if is_cream_or_wood(r, g, b):
            continue
        dist = abs(r - br) + abs(g - bg) + abs(b - bb)
        if dist > limit and not is_neutral_backdrop(r, g, b):
            continue
        px[x, y] = (r, g, b, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    bbox = im.getbbox()
    if bbox:
        l, t, rgt, btm = bbox
        l = max(0, l - 1)
        t = max(0, t - 1)
        rgt = min(w, rgt + 1)
        btm = min(h, btm + 1)
        im = im.crop((l, t, rgt, btm))
    return im


def main():
    for src, dst, thr in jobs:
        out = remove_outer_bg(Image.open(src), thr=thr)
        out.save(dst, "PNG")
        w, h = out.size
        px = out.load()
        opaque = sum(
            1
            for x in range(0, w, 6)
            for y in range(0, h, 6)
            if px[x, y][3] > 8
        )
        total = len(range(0, w, 6)) * len(range(0, h, 6))
        print(f"{dst.name}: {w}x{h} opaque={opaque/total*100:.1f}%")


if __name__ == "__main__":
    main()
