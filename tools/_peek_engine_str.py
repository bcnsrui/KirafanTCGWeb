# -*- coding: utf-8 -*-
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "data"
for label, rel in [("ko", "engine.json"), ("en", "en/engine.json"), ("ja", "ja/engine.json")]:
    p = root / rel
    if not p.exists():
        print(label, "missing", p)
        continue
    data = json.loads(p.read_text(encoding="utf-8"))
    cards = data.get("cards") or {}
    card = cards.get("10050111") or cards.get(10050111)
    print("===", label, "card", bool(card))
    if card:
        strings = card.get("strings") or []
        for i, s in enumerate(strings):
            if s:
                print(f"  [{i}]", s.replace("\n", " / ")[:100])
