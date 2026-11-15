import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUZZLES_PATH = ROOT / "data" / "puzzles.json"
HINTS_PATH = ROOT / "data" / "en" / "puzzle-hints.json"
OUTPUT_PATH = ROOT / "data" / "en" / "puzzles.json"

CATEGORY_MAP = {
    "튜토리얼": "Tutorial",
    "노말모드": "Normal",
    "하드모드": "Hard",
}

TITLE_MAP = {
    "프롤로그": "Prologue",
    "소환": "Summoning",
    "승려": "Priests",
    "알케미스트": "Alchemists",
    "성전": "Sanctuary",
    "회복": "Healing",
    "나약함&배고픔": "Weakness & Hunger",
    "수면&고립": "Sleep & Isolation",
    "속박": "Bind",
    "불행": "Misfortune",
    "후다 유미네": "Fuda Yumine",
    "하토야 코하네": "Hatoya Kohane",
    "쿠죠 카렌": "Kujo Karen",
    "에토와리아의 정기시험": "Etoilia Periodic Exam",
    "혼다 타마키": "Honda Tamaki",
    "아니마옐": "Anima Yell!",
    "키리마 샤로": "Kirima Sharo",
    "금빛 모자이크": "Kin-iro Mosaic",
    "소노다 유우": "Sonoda Yuu",
    "스텔라의 마법": "Magic of Stella",
    "오리베 야스나": "Oribe Yasuna",
    "길모퉁이 마족": "The Demon Girl Next Door",
    "고토 히토리": "Gotoh Hitori",
    "히다마리 스케치": "Hidamari Sketch",
}

SHOW_HINT_RE = re.compile(r"Debug\.ShowHint\[\[(.*?)\]\]", re.DOTALL)


def normalize_newlines(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def main():
    puzzles = json.loads(PUZZLES_PATH.read_text(encoding="utf-8"))
    raw_hints = json.loads(HINTS_PATH.read_text(encoding="utf-8"))
    hints = {normalize_newlines(key): value for key, value in raw_hints.items()}

    used_hints = set()
    replacement_count = 0

    def replace_hint(match):
        nonlocal replacement_count
        korean = normalize_newlines(match.group(1))
        if korean not in hints:
            preview = korean.replace("\n", "\\n")[:160]
            raise KeyError(f"Missing English ShowHint translation: {preview}")
        used_hints.add(korean)
        replacement_count += 1
        return f"Debug.ShowHint[[{hints[korean]}]]"

    for puzzle in puzzles:
        category = puzzle["category"]
        title = puzzle["title"]
        if category not in CATEGORY_MAP:
            raise KeyError(f"Missing category translation: {category}")
        if title not in TITLE_MAP:
            raise KeyError(f"Missing title translation: {title}")
        puzzle["category"] = CATEGORY_MAP[category]
        puzzle["title"] = TITLE_MAP[title]
        puzzle["source"] = SHOW_HINT_RE.sub(replace_hint, normalize_newlines(puzzle["source"]))

    unused = set(hints) - used_hints
    if unused:
        previews = ", ".join(repr(item[:60]) for item in sorted(unused)[:3])
        raise ValueError(f"{len(unused)} hint translations were not used: {previews}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(puzzles, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(puzzles)} puzzles with {replacement_count} translated "
        f"ShowHint calls to {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()
