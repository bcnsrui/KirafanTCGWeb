"""Sync KirafanWeb → _upload/{KirafanTCGWeb,KirafanTCG} for GitHub push."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "KirafanWeb"
UP_WEB = ROOT / "_upload" / "KirafanTCGWeb"
UP_TCG = ROOT / "_upload" / "KirafanTCG"

SKIP_DIR_NAMES = {
    ".git",
    ".vercel",
    "node_modules",
    "__pycache__",
    "pics",
    "sound",
    "script",
}
SKIP_FILE_SUFFIX = {".sqlite", ".pyc"}
SKIP_FILE_NAMES = {
    "local_api.sqlite",
    "lobby_rooms.json",
    ".env",
}
SKIP_REL_PREFIXES = (
    "data/ai/test/",
    "data/duels/",
    ".vercel/",
)


def should_skip(rel: str, name: str, is_dir: bool) -> bool:
    rel = rel.replace("\\", "/")
    if name in SKIP_DIR_NAMES and is_dir:
        return True
    if name in SKIP_FILE_NAMES:
        return True
    if any(name.endswith(s) for s in SKIP_FILE_SUFFIX):
        return True
    if any(rel.startswith(p) or rel == p.rstrip("/") for p in SKIP_REL_PREFIXES):
        return True
    # never ship real DeepL key leftovers
    if name == "deepl.env.example":
        return False  # placeholder only; scrubbed separately
    if name.startswith("_") and name.endswith(".py") and name.startswith("_"):
        # keep build tools; skip one-off helper scripts in tools/
        if rel.startswith("tools/_"):
            return True
    return False


def sync_tree(src: Path, dst: Path, *, only_prefixes: tuple[str, ...] | None = None) -> int:
    n = 0
    for dirpath, dirnames, filenames in os.walk(src):
        rel_dir = os.path.relpath(dirpath, src).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        # prune dirs
        keep = []
        for d in list(dirnames):
            rel = f"{rel_dir}/{d}".lstrip("/") if rel_dir else d
            if should_skip(rel, d, True):
                continue
            if only_prefixes and not any(
                rel == p.rstrip("/") or rel.startswith(p) or p.startswith(rel + "/") or p.startswith(rel)
                for p in only_prefixes
            ):
                # allow walking into parents of wanted prefixes
                if not any(p.startswith(rel + "/") or p == rel for p in only_prefixes):
                    continue
            keep.append(d)
        dirnames[:] = keep

        for name in filenames:
            rel = f"{rel_dir}/{name}".lstrip("/") if rel_dir else name
            if should_skip(rel, name, False):
                continue
            if only_prefixes and not any(rel == p or rel.startswith(p) for p in only_prefixes):
                continue
            s = src / rel
            d = dst / rel
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)
            n += 1
    return n


def sync_data_to_tcg() -> int:
    """KirafanWeb/data → _upload/KirafanTCG/web/data (+ packs already built into _upload)."""
    src = WEB / "data"
    dst = UP_TCG / "web" / "data"
    n = 0
    for dirpath, dirnames, filenames in os.walk(src):
        rel_dir = os.path.relpath(dirpath, src).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        dirnames[:] = [d for d in dirnames if d not in ("test", "__pycache__")]
        if rel_dir.startswith("ai/test") or rel_dir.startswith("duels"):
            dirnames[:] = []
            continue
        for name in filenames:
            if name in SKIP_FILE_NAMES or name.endswith(".sqlite"):
                continue
            rel = f"{rel_dir}/{name}".lstrip("/") if rel_dir else name
            if rel.startswith("ai/test/") or rel.startswith("duels/"):
                continue
            s = src / rel
            d = dst / rel
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)
            n += 1
    # also mirror packs.json next to packs/
    packs_meta = WEB / "data" / "packs.json"
    if packs_meta.exists():
        (UP_TCG / "packs").mkdir(parents=True, exist_ok=True)
        shutil.copy2(packs_meta, UP_TCG / "packs" / "packs.json")
        shutil.copy2(packs_meta, dst / "packs.json")
        n += 1
    return n


def main() -> None:
    UP_WEB.mkdir(parents=True, exist_ok=True)
    UP_TCG.mkdir(parents=True, exist_ok=True)

    # Web shell: everything except pics/sound/heavy data test
    # Include data lite for Railway static? DEPLOY says data goes to KirafanTCG.
    # KirafanTCGWeb historically has a data/ folder — sync data except ai/test.
    n_web = sync_tree(
        WEB,
        UP_WEB,
        only_prefixes=None,
    )
    # Remove accidental heavy dirs if copied
    for bad in ("pics", "sound", "script", ".vercel"):
        p = UP_WEB / bad
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    n_tcg = sync_data_to_tcg()
    print(f"KirafanTCGWeb files copied: {n_web}")
    print(f"KirafanTCG web/data files copied: {n_tcg}")
    print(f"packs dir: {UP_TCG / 'packs'} exists={ (UP_TCG / 'packs').exists() }")


if __name__ == "__main__":
    main()
