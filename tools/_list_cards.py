import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ko = json.loads((root / "data/cards.json").read_text(encoding="utf-8"))
en = {c["id"]: c for c in json.loads((root / "data/en/cards.json").read_text(encoding="utf-8"))["cards"]}
for c in ko["cards"]:
    e = en[c["id"]]
    print(f"{c['id']}\t{c['name']}\t{e['name']}\t{c.get('series','')}\t{c.get('kind','')}")
