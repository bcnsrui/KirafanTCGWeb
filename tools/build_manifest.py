"""Write data/manifest.json for web/exe integrity check + GitHub download.

    KirafanAI\\.venv\\Scripts\\python.exe KirafanWeb\\tools\\build_manifest.py

Includes:
  - data/* (except ai/test, local db, manifest itself)  source=data
  - pics/* (full)                                      source=pics   → KirafanTCG/pics
  - pics/small/*                                       source=data   → KirafanTCG/web/pics/small
  - sound/**                                           source=sound  → KirafanTCG/sound

Upload after build (see _upload/):
  - pics/ + sound/ + web/data/* + web/pics/small/*  → bcnsrui/KirafanTCG
  - html/js/css/API shell                            → bcnsrui/KirafanTCGWeb
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(WEB, "data", "manifest.json")

SKIP_DATA_PREFIXES = ("ai/test/", "duels/")
SKIP_NAMES = {"manifest.json", "local_api.sqlite", "lobby_rooms.json"}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def add_tree(files: dict, root: str, url_prefix: str, source: str, skip_prefixes=(), skip_names=()):
    if not os.path.isdir(root):
        return
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            if name in skip_names or rel in skip_names:
                continue
            if any(rel.startswith(p) for p in skip_prefixes):
                continue
            key = f"{url_prefix}/{rel}" if url_prefix else rel
            files[key] = {
                "sha256": sha256_file(path),
                "size": os.path.getsize(path),
                "source": source,
            }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-assets", action="store_true", help="data/ only (skip pics+sound)")
    ap.add_argument("--data-only", action="store_true", help="alias of --no-assets")
    args = ap.parse_args()
    no_assets = args.no_assets or args.data_only

    files = {}
    add_tree(
        files,
        os.path.join(WEB, "data"),
        "data",
        "data",
        skip_prefixes=SKIP_DATA_PREFIXES,
        skip_names=SKIP_NAMES,
    )
    if not no_assets:
        pics_root = os.path.join(WEB, "pics")
        if os.path.isdir(pics_root):
            for dirpath, _dirs, names in os.walk(pics_root):
                for name in names:
                    path = os.path.join(dirpath, name)
                    rel = os.path.relpath(path, pics_root).replace("\\", "/")
                    key = f"pics/{rel}"
                    # thumbnails are web-resized; full art lives on KirafanTCG/pics
                    source = "data" if rel.startswith("small/") else "pics"
                    files[key] = {
                        "sha256": sha256_file(path),
                        "size": os.path.getsize(path),
                        "source": source,
                    }
        add_tree(files, os.path.join(WEB, "sound"), "sound", "sound")

    packs = {}
    packs_meta_path = os.path.join(WEB, "data", "packs.json")
    if os.path.isfile(packs_meta_path):
        try:
            with open(packs_meta_path, encoding="utf-8") as f:
                packs_doc = json.load(f)
            packs = packs_doc.get("packs") or {}
        except Exception as exc:
            print(f"warning: could not read packs.json: {exc}")

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": dict(sorted(files.items())),
        "packs": packs,
        "sources": {
            "data": "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main/web",
            "pics": "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
            "sound": "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
            "packs": "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
        },
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    by = {}
    for info in files.values():
        by[info["source"]] = by.get(info["source"], 0) + 1
    print(f"wrote {OUT} ({len(files)} files: {by}; packs {list(packs)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
