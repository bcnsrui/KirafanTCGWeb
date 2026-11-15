"""Make black studio backgrounds transparent on menu icons."""
from PIL import Image
from pathlib import Path

home = Path(r"d:\유기오프로\KirafanEdo(Windows PC)\KirafanWeb\assets\home")
files = [
    "menu-icon-server.png",
    "menu-icon-ai.png",
    "menu-icon-story.png",
    "menu-icon-replay.png",
    "menu-icon-deck.png",
]


def strip_black(path: Path, thr: int = 28) -> None:
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r <= thr and g <= thr and b <= thr:
                px[x, y] = (r, g, b, 0)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.save(path, "PNG")
    print(path.name, im.size)


def main():
    for name in files:
        strip_black(home / name)


if __name__ == "__main__":
    main()
