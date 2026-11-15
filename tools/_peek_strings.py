# -*- coding: utf-8 -*-
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "data"
for label, rel in [("ko", "cards.json"), ("en", "en/cards.json"), ("ja", "ja/cards.json")]:
    p = root / rel
    data = json.loads(p.read_text(encoding="utf-8"))
    print("===", label, type(data).__name__, list(data)[:8] if isinstance(data, dict) else f"list[{len(data)}]")
    if isinstance(data, dict):
        # sample one key
        k = next(iter(data))
        v = data[k]
        print(" sample", k, type(v).__name__, list(v)[:20] if isinstance(v, dict) else v[:1] if isinstance(v, list) else v)
        # find 10050111
        card = data.get("10050111") or data.get(10050111)
        if not card:
            for kk, vv in data.items():
                if isinstance(vv, dict) and (vv.get("id") == 10050111 or vv.get("code") == 10050111):
                    card = vv
                    break
        if card:
            print(" card keys", list(card)[:30])
            s = card.get("strings") or card.get("str") or card.get("texts")
            print(" strings", s[:15] if isinstance(s, list) else s)
    elif isinstance(data, list):
        card = next((c for c in data if c.get("id") == 10050111 or c.get("code") == 10050111), None)
        print(" card", card and list(card)[:30])
