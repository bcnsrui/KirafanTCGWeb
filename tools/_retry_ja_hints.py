"""Retry Latin-looking JA puzzle hints via DeepL EN→JA, then rebuild packs."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ja_pack import (  # noqa: E402
    PUZZLE_CAT,
    PUZZLE_TITLE,
    SPEAKER_JA,
    TERM_EN_JA,
    TERM_KO_JA,
    apply_ja_cleanup,
    apply_terms,
    translate_batch,
)
import build_puzzles_en  # noqa: E402

HINT_RE = re.compile(r"Debug\.ShowHint\[\[(.*?)\]\]", re.DOTALL)


def norm(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def is_latin_heavy(v: str) -> bool:
    body = "\n".join(v.split("\n")[1:]) if v.startswith("★") else v
    letters = sum(c.isalpha() for c in body)
    latin = sum(("A" <= c <= "Z") or ("a" <= c <= "z") for c in body)
    return bool(letters) and latin / letters > 0.35 and len(body) > 8


def finalize_ja(src_en: str, ja: str) -> str:
    ja = apply_ja_cleanup(apply_terms(apply_terms(ja, TERM_EN_JA), TERM_KO_JA))
    if ja.startswith("★"):
        line, _, rest = ja.partition("\n")
        sp = line[1:].strip()
        if src_en.startswith("★"):
            en_sp = src_en[1:].split("\n", 1)[0].strip()
            spj = SPEAKER_JA.get(en_sp, SPEAKER_JA.get(sp, sp))
        else:
            spj = SPEAKER_JA.get(sp, sp)
        ja = f"★{spj}\n{rest}" if rest else f"★{spj}"
    return ja


def rebuild_puzzles(ja_map: dict[str, str]) -> None:
    puzzles = json.loads((ROOT / "data/puzzles.json").read_text(encoding="utf-8"))
    out = []
    for p in puzzles:
        q = dict(p)
        q["category"] = PUZZLE_CAT[p["category"]]
        q["title"] = PUZZLE_TITLE[p["title"]]

        def repl(m: re.Match, _map=ja_map) -> str:
            body = norm(m.group(1))
            return f"Debug.ShowHint[[{_map.get(body, body)}]]"

        q["source"] = HINT_RE.sub(repl, norm(p["source"]))
        out.append(q)
    (ROOT / "data/ja/puzzles.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    en_map = {
        norm(k): v
        for k, v in json.loads((ROOT / "data/en/puzzle-hints.json").read_text(encoding="utf-8")).items()
    }
    en_to_ja = {en_map[k]: ja_map[k] for k in ja_map if k in en_map}
    (ROOT / "data/ja/_puzzle_hints_ja.json").write_text(
        json.dumps(en_to_ja, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    en_map = {
        norm(k): v
        for k, v in json.loads((ROOT / "data/en/puzzle-hints.json").read_text(encoding="utf-8")).items()
    }
    ja_map = {
        norm(k): v
        for k, v in json.loads((ROOT / "data/ja/puzzle-hints.json").read_text(encoding="utf-8")).items()
    }
    need = [k for k, v in ja_map.items() if is_latin_heavy(v)]
    print(f"need retry {len(need)}")
    if not need:
        rebuild_puzzles(ja_map)
        build_puzzles_en.main()
        print("nothing to translate")
        return

    prepared: list[str] = []
    meta: list[tuple[str | None, str]] = []  # (spj or None, en src)
    for k in need:
        src = en_map.get(k, k)
        if src.startswith("★"):
            line, _, rest = src.partition("\n")
            sp = line[1:].strip()
            spj = SPEAKER_JA.get(sp, sp)
            body = apply_terms(rest, TERM_EN_JA)
            prepared.append(body if body.strip() else " ")
            meta.append((spj, src))
        else:
            prepared.append(apply_terms(src, TERM_EN_JA))
            meta.append((None, src))

    translated = translate_batch(prepared, "en")
    for k, ja_body, (spj, src_en) in zip(need, translated, meta):
        if spj is not None:
            ja = f"★{spj}\n{ja_body.strip()}" if ja_body.strip() else f"★{spj}"
        else:
            ja = ja_body
        ja_map[k] = finalize_ja(src_en, ja)

    (ROOT / "data/ja/puzzle-hints.json").write_text(
        json.dumps(ja_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    rebuild_puzzles(ja_map)
    build_puzzles_en.main()
    left = sum(1 for v in ja_map.values() if is_latin_heavy(v))
    print(f"still_latin {left}")


if __name__ == "__main__":
    main()
