"""Sync missing KR cards into kirafan(EN).cdb and apply light TCG-English polish."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

GAME = Path(__file__).resolve().parents[2]
KR = GAME / "expansions" / "kirafan.cdb"
EN = GAME / "expansions" / "kirafan(EN).cdb"

# Systematic polish on existing EN text (TCG-familiar phrasing, consistent terms)
REPLACEMENTS = [
    (r"\btotteoki gauge\b", "Totteoki Gauge"),
    (r"\bTotteoki gauge\b", "Totteoki Gauge"),
    (r"\btotteoki Zone\b", "Totteoki Zone"),
    (r"\bTotteoki zone\b", "Totteoki Zone"),
    (r"\bBattle zone\b", "Battle Zone"),
    (r"\bbattle zone\b", "Battle Zone"),
    (r"\bcreamates\b", "Creamates"),
    (r"\bcreamate\b", "Creamate"),
    (r"\[Consume (\d+) from the totteoki gauge\]", r"[Totteoki Gauge \1]"),
    (r"\[Consume (\d+) from the Totteoki Gauge\]", r"[Totteoki Gauge \1]"),
    (r"\[Summon\]", "[Skill]"),
    (r"Send 1 card of your hand or Battle Zone to Totteoki Zone\.",
     "Send 1 card from your hand or Battle Zone to the Totteoki Zone."),
]

# Removed from KO pack; strip leftover EN/JA deck notes on sync
DISCLAIMER_RES = [
    re.compile(
        r"(?:\r?\n)*※\s*Include only 1 Main Character\.?(?:\r?\n)※\s*Do not activate this card's effect\.?\s*$",
        re.I,
    ),
    re.compile(
        r"(?:\r?\n)*※\s*Please include only 1 Main Character[^\n]*(?:\r?\n)※\s*Do not activate this card's effect\.?\s*$",
        re.I,
    ),
]

# KR-only cards → English placeholders (name + short desc) when missing from EN
KR_TO_EN_FALLBACK = {
    10054524: {
        "name": "Sekiya Naru",
        "desc": (
            "[Skill]\n"
            "Heal a single ally by 4\n\n"
            "[Totteoki Gauge 2, extra Stiff 1]\n"
            "The ATK of all allies' next attack increases once by the number of times "
            "you have activated your Totteoki effect this game (up to 3)."
        ),
    },
}


def polish(text: str) -> str:
    if not text:
        return text
    out = text.replace("\r\n", "\n").replace("\r", "\n")
    for pat, repl in REPLACEMENTS:
        out = re.sub(pat, repl, out, flags=re.IGNORECASE if "totteoki" in pat.lower() or "creamate" in pat.lower() or "battle zone" in pat.lower() else 0)
    for pat in DISCLAIMER_RES:
        out = pat.sub("", out)
    # Fix double periods from polish
    out = out.replace("..", ".").rstrip()
    return out


def text_cols(con: sqlite3.Connection) -> list[str]:
    return [r[1] for r in con.execute("pragma table_info(texts)")]


def datas_cols(con: sqlite3.Connection) -> list[str]:
    return [r[1] for r in con.execute("pragma table_info(datas)")]


def main() -> None:
    kr = sqlite3.connect(KR)
    en = sqlite3.connect(EN)
    tcols = text_cols(en)
    dcols = datas_cols(en)
    assert tcols[0] == "id" and tcols[1] == "name" and tcols[2] == "desc"

    kr_ids = {r[0] for r in kr.execute("select id from datas")}
    en_ids = {r[0] for r in en.execute("select id from datas")}
    missing = sorted(kr_ids - en_ids)
    print("EN missing from KR:", missing)

    # Copy datas + texts for missing IDs
    for cid in missing:
        drow = kr.execute(f"select {', '.join(dcols)} from datas where id=?", (cid,)).fetchone()
        trow = kr.execute(f"select {', '.join(tcols)} from texts where id=?", (cid,)).fetchone()
        if not drow or not trow:
            print("skip incomplete", cid)
            continue
        # Translate name/desc if we have fallback; else mark as TBD English from KR romanization
        fb = KR_TO_EN_FALLBACK.get(cid)
        tlist = list(trow)
        if fb:
            tlist[1] = fb["name"]
            tlist[2] = fb["desc"]
            for i in range(3, len(tlist)):
                tlist[i] = tlist[i] or ""
        else:
            # Keep KR name with EN note — better than leaving out of web pool sync via datas
            tlist[1] = f"{tlist[1]} [EN TBD]"
        en.execute(f"insert or replace into datas ({', '.join(dcols)}) values ({', '.join('?' * len(dcols))})", drow)
        en.execute(f"insert or replace into texts ({', '.join(tcols)}) values ({', '.join('?' * len(tcols))})", tlist)
        print("copied", cid, tlist[1])

    # Polish all EN texts
    n = 0
    for row in list(en.execute(f"select {', '.join(tcols)} from texts")):
        rid = row[0]
        new = list(row)
        changed = False
        for i in range(1, len(new)):
            if isinstance(new[i], str) and new[i]:
                p = polish(new[i])
                if p != new[i]:
                    new[i] = p
                    changed = True
        if changed:
            en.execute(
                f"update texts set {', '.join(f'{c}=?' for c in tcols[1:])} where id=?",
                (*new[1:], rid),
            )
            n += 1
    en.commit()
    print("polished rows", n)
    en.close()
    kr.close()


if __name__ == "__main__":
    main()
