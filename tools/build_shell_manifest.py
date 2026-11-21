"""Build shell-manifest.json for exe to sync KirafanTCGWeb (html/js/css/assets)."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "shell-manifest.json"

COPY_DIRS = ("css", "js", "assets")
SKIP_DIR_NAMES = {"__pycache__", ".git", "node_modules"}
SKIP_SUFFIX = {".pyc", ".map", ".sqlite"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def collect() -> dict[str, dict]:
    files: dict[str, dict] = {}
    for html in sorted(WEB.glob("*.html")):
        rel = html.name.replace("\\", "/")
        files[rel] = {"sha256": sha256_file(html), "size": html.stat().st_size}

    if OUT.exists():
        # never include ourselves if sitting in WEB root during walk of dirs only
        pass

    for dirname in COPY_DIRS:
        root = WEB / dirname
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
            for name in filenames:
                if any(name.endswith(s) for s in SKIP_SUFFIX):
                    continue
                path = Path(dirpath) / name
                rel = path.relative_to(WEB).as_posix()
                files[rel] = {"sha256": sha256_file(path), "size": path.stat().st_size}

    # Include the manifest itself after hashing others? No — clients fetch this file separately.
    return files


def main() -> None:
    files = collect()
    doc = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": files,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(files)} files)")


if __name__ == "__main__":
    main()
