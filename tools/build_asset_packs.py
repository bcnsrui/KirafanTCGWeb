"""Build zip packs for live first download (KirafanTCG/packs/).

    python KirafanWeb/tools/build_asset_packs.py

Writes:
  _upload/KirafanTCG/packs/sound.zip
  _upload/KirafanTCG/packs/pics.zip
  _upload/KirafanTCG/packs/data.zip
  KirafanWeb/data/packs.json  (sha256/size — merged into manifest by build_manifest.py)

Localhost boot still uses on-disk files; live/exe pull these zips from GitHub.
"""
from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
UPLOAD_TCG = os.path.join(GAME, "_upload", "KirafanTCG")
PACKS_OUT = os.path.join(UPLOAD_TCG, "packs")
PACKS_META = os.path.join(WEB, "data", "packs.json")

# Paths inside each zip must match manifest keys (sound/…, pics/…, data/…)
SKIP_DATA_PREFIXES = ("ai/test/", "duels/")
SKIP_DATA_NAMES = {
    "manifest.json",
    "local_api.sqlite",
    "lobby_rooms.json",
    "packs.json",
}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def add_tree(zf: zipfile.ZipFile, root: str, arc_prefix: str, skip_prefixes=(), skip_names=()):
    if not os.path.isdir(root):
        return 0
    n = 0
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            if name in skip_names or rel in skip_names:
                continue
            if any(rel.startswith(p) for p in skip_prefixes):
                continue
            arc = f"{arc_prefix}/{rel}" if arc_prefix else rel
            zf.write(path, arcname=arc, compress_type=zipfile.ZIP_DEFLATED)
            n += 1
    return n


def write_pack(name: str, builder) -> dict:
    os.makedirs(PACKS_OUT, exist_ok=True)
    path = os.path.join(PACKS_OUT, f"{name}.zip")
    tmp = path + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        count = builder(zf)
    if os.path.exists(path):
        os.remove(path)
    os.replace(tmp, path)
    info = {
        "file": f"packs/{name}.zip",
        "sha256": sha256_file(path),
        "size": os.path.getsize(path),
        "files": count,
        "source": "packs",
    }
    print(f"{name}.zip: {count} files, {info['size'] / (1024 * 1024):.1f} MB")
    return info


def main() -> int:
    packs = {}
    packs["sound"] = write_pack(
        "sound",
        lambda zf: add_tree(zf, os.path.join(WEB, "sound"), "sound"),
    )
    packs["pics"] = write_pack(
        "pics",
        lambda zf: add_tree(zf, os.path.join(WEB, "pics"), "pics"),
    )

    def data_pack(zf: zipfile.ZipFile) -> int:
        n = add_tree(
            zf,
            os.path.join(WEB, "data"),
            "data",
            skip_prefixes=SKIP_DATA_PREFIXES,
            skip_names=SKIP_DATA_NAMES,
        )
        # thumbnails live under pics/small but are served from the data source base
        small = os.path.join(WEB, "pics", "small")
        if os.path.isdir(small):
            n += add_tree(zf, small, "pics/small")
        return n

    packs["data"] = write_pack("data", data_pack)

    meta = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "base": "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
        "packs": packs,
    }
    os.makedirs(os.path.dirname(PACKS_META), exist_ok=True)
    with open(PACKS_META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    # Mirror meta next to zips for the GitHub repo
    with open(os.path.join(PACKS_OUT, "packs.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {PACKS_META}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
