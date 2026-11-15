"""Replace TCG-style 敵1体/味方1体 with Kirafan wiki-style 敵単体/味方単体."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JA = ROOT / "data" / "ja"

PRETTY = {
    "_card_descs.json",
    "_engine_strings.json",
    "_puzzle_hints_ja.json",
    "puzzles.json",
}


def fix(s: str) -> str:
    return s.replace("敵1体", "敵単体").replace("味方1体", "味方単体")


def walk(obj):
    if isinstance(obj, dict):
        return {k: walk(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk(v) for v in obj]
    if isinstance(obj, str):
        return fix(obj)
    return obj


def main() -> None:
    for name in (
        "_card_descs.json",
        "_engine_strings.json",
        "cards.json",
        "engine.json",
        "_puzzle_hints_ja.json",
        "puzzles.json",
    ):
        path = JA / name
        if not path.exists():
            print("skip", name)
            continue
        raw = path.read_text(encoding="utf-8")
        before = (raw.count("敵1体"), raw.count("味方1体"))
        data = walk(json.loads(raw))
        if name in PRETTY:
            out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        else:
            out = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        path.write_text(out, encoding="utf-8")
        after_raw = path.read_text(encoding="utf-8")
        print(
            f"{name}: 敵1体 {before[0]}->{after_raw.count('敵1体')} "
            f"味方1体 {before[1]}->{after_raw.count('味方1体')} "
            f"敵単体={after_raw.count('敵単体')} 味方単体={after_raw.count('味方単体')}"
        )


if __name__ == "__main__":
    main()
