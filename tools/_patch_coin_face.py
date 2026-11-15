# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

reps = [
    ('"coin.headsTitle": "Heads",', '"coin.headsFace": "Heads",\n  "coin.headsTitle": "Heads",'),
    ('"coin.headsTitle": "코인 앞면이 나왔습니다",', '"coin.headsFace": "앞면",\n  "coin.headsTitle": "코인 앞면이 나왔습니다",'),
    ('"coin.headsTitle": "コイン表が出ました",', '"coin.headsFace": "表",\n  "coin.headsTitle": "コイン表が出ました",'),
]
for old, new in reps:
    if "coin.headsFace" in text and old in text:
        idx = text.find(old)
        if "coin.headsFace" in text[max(0, idx - 80):idx + 40]:
            print("skip", old[:40])
            continue
    if old not in text:
        print("MISSING", old)
        continue
    text = text.replace(old, new, 1)
    print("ok", old[:40])

p.write_text(text, encoding="utf-8")
print("done")
