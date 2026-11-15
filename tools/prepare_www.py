"""Copy KirafanWeb shell only into KirafanDesktop/www for the Tauri exe bundle.

Excludes data/, pics/, sound/ — those are downloaded from GitHub on first/every launch.
"""
from __future__ import annotations

import shutil
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
WWW = Path(__file__).resolve().parents[2] / "KirafanDesktop" / "www"

COPY_DIRS = ("css", "js", "assets")
SKIP_DIR_NAMES = {"__pycache__", ".git"}


def main() -> None:
    if WWW.exists():
        shutil.rmtree(WWW)
    WWW.mkdir(parents=True)

    for name in COPY_DIRS:
        src = WEB / name
        if not src.is_dir():
            continue
        shutil.copytree(
            src,
            WWW / name,
            ignore=shutil.ignore_patterns(*SKIP_DIR_NAMES, "*.pyc"),
        )

    for html in WEB.glob("*.html"):
        shutil.copy2(html, WWW / html.name)

    # Placeholder so relative URLs exist before the first GitHub sync
    data = WWW / "data"
    data.mkdir(exist_ok=True)
    (data / "README.txt").write_text(
        "Card data, art, and sound are downloaded from GitHub when the exe starts.\n",
        encoding="utf-8",
    )
    print(f"prepared {WWW}")


if __name__ == "__main__":
    main()
