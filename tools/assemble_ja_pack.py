"""Assemble data/ja cards+engine from curated names + AI-translated descs."""
from __future__ import annotations

import json
import re
from pathlib import Path

# Reuse maps from build_ja_pack
import build_ja_pack as bj

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ja"


def assemble_cards() -> None:
    ko = json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))
    descs = json.loads((OUT / "_card_descs.json").read_text(encoding="utf-8"))
    cards = []
    for c in ko["cards"]:
        cid = str(c["id"])
        if cid not in descs and c["id"] not in bj.NAME_JA:
            raise KeyError(cid)
        card = dict(c)
        card["name"] = bj.NAME_JA[c["id"]]
        card["desc"] = descs.get(cid) or descs.get(c["id"]) or c.get("desc") or ""
        card["series"] = bj.SERIES_JA.get(c.get("series", ""), c.get("series", ""))
        cards.append(card)
    payload = {"maxCopies": ko.get("maxCopies", 3), "mainSize": ko.get("mainSize", 60), "cards": cards}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cards.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("cards", len(cards))


def assemble_engine() -> None:
    en = json.loads((ROOT / "data/en/engine.json").read_text(encoding="utf-8"))
    extra = {}
    p = OUT / "_engine_strings.json"
    if p.exists():
        extra = json.loads(p.read_text(encoding="utf-8"))
    cards = en.get("cards") or {}
    for cid, info in cards.items():
        try:
            iid = int(cid)
        except ValueError:
            iid = None
        if iid in bj.NAME_JA:
            info["name"] = bj.NAME_JA[iid]
        elif cid in extra and extra[cid].get("name"):
            info["name"] = extra[cid]["name"]
        elif "Sugar" in (info.get("name") or ""):
            info["name"] = (info.get("name") or "").replace("Sugar(Boss Character)", "シュガー(ボスキャラクター)").replace("Sugar", "シュガー")
        ex = extra.get(cid) or {}
        if ex.get("strings") is not None:
            info["strings"] = ex["strings"]
        cards[cid] = info
    en["cards"] = cards
    (OUT / "engine.json").write_text(json.dumps(en, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("engine", len(cards))


def assemble_puzzles_from_en() -> None:
    """Start from EN puzzles: rename titles/cats, MT speakers already EN; translate hints via map file if present."""
    en_puzzles = json.loads((ROOT / "data/en/puzzles.json").read_text(encoding="utf-8"))
    # EN category/title → JA
    cat = {"Tutorial": "チュートリアル", "Normal": "ノーマル", "Hard": "ハード"}
    title = {
        "Prologue": "プロローグ",
        "Summoning": "召喚",
        "Priests": "僧侶",
        "Alchemists": "アルケミスト",
        "Sanctuary": "聖典",
        "Healing": "回復",
        "Weakness & Hunger": "弱体＆空腹",
        "Sleep & Isolation": "睡眠＆孤立",
        "Bind": "拘束",
        "Misfortune": "不幸",
        "Huda Yumine": "布田由美音",
        "Fuda Yumine": "布田由美音",
        "Hatoya Kohane": "鳩谷こはね",
        "Kujo Karen": "九条カレン",
        "Etoaria Periodic Exam": "エトワリアの定期試験",
        "Etoilia Periodic Exam": "エトワリアの定期試験",
        "Honda Tamaki": "本田珠輝",
        "Anima Yell!": "アニマエール！",
        "Kirima Syaro": "桐間紗路",
        "Kirima Sharo": "桐間紗路",
        "Kin-iro Mosaic": "きんいろモザイク",
        "Sonoda Yuu": "園田優",
        "Stella's Magical": "ステラのまほう",
        "Magic of Stella": "ステラのまほう",
        "Oribe Yasuna": "折部やすな",
        "The Demon Girl Next Door": "まちカドまぞく",
        "Gotoh Hitori": "後藤ひとり",
        "Hidamari Sketch": "ひだまりスケッチ",
    }
    hint_path = OUT / "_puzzle_hints_ja.json"
    hint_map = {}
    if hint_path.exists():
        raw = json.loads(hint_path.read_text(encoding="utf-8"))
        hint_map = {k.replace("\r\n", "\n").replace("\r", "\n"): v for k, v in raw.items()}

    hint_re = re.compile(r"Debug\.ShowHint\[\[(.*?)\]\]", re.DOTALL)

    def repl(m: re.Match) -> str:
        body = m.group(1).replace("\r\n", "\n").replace("\r", "\n")
        if body in hint_map:
            return f"Debug.ShowHint[[{hint_map[body]}]]"
        # light term replace on EN body
        ja = bj.apply_terms(body, bj.TERM_EN_JA)
        if ja.startswith("★"):
            line, _, rest = ja.partition("\n")
            sp = line[1:].strip()
            spj = bj.SPEAKER_JA.get(sp, sp)
            ja = f"★{spj}\n{rest}" if rest else f"★{spj}"
        return f"Debug.ShowHint[[{ja}]]"

    out = []
    for p in en_puzzles:
        q = dict(p)
        q["category"] = cat.get(p["category"], p["category"])
        q["title"] = title.get(p["title"], p["title"])
        q["source"] = hint_re.sub(repl, p["source"].replace("\r\n", "\n").replace("\r", "\n"))
        out.append(q)
    (OUT / "puzzles.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("puzzles", len(out), "hints_mapped", len(hint_map))


if __name__ == "__main__":
    assemble_cards()
    assemble_engine()
    assemble_puzzles_from_en()
    print("assembled")
