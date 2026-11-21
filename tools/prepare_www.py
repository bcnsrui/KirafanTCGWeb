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


def _clear_readonly(path: Path) -> None:
    """Windows: ReadOnly dirs/files block rmtree (WinError 5)."""
    if not path.exists():
        return
    for p in path.rglob("*"):
        try:
            p.chmod(0o666)
        except OSError:
            pass
    try:
        path.chmod(0o666)
    except OSError:
        pass


def main() -> None:
    if WWW.exists():
        _clear_readonly(WWW)
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

    # Shell manifest stub (live copy comes from KirafanTCGWeb on each launch)
    shell_manifest = WEB / "shell-manifest.json"
    if shell_manifest.exists():
        shutil.copy2(shell_manifest, WWW / "shell-manifest.json")

    # Placeholder so relative URLs exist before the first GitHub sync
    data = WWW / "data"
    data.mkdir(exist_ok=True)
    (data / "README.txt").write_text(
        "Card data, art, and sound are downloaded from GitHub when the exe starts.\n"
        "UI shell (html/js/css) syncs from KirafanTCGWeb into www/ beside the exe.\n",
        encoding="utf-8",
    )
    print(f"prepared {WWW}")


if __name__ == "__main__":
    main()
