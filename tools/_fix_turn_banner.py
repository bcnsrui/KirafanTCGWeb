# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")
reps = [
    ('"log.turnBanner": "── {n}턴 · {who} 턴 ──",', '"log.turnBanner": "── {n}턴 · {who} ──",'),
]
for a, b in reps:
    if a in text:
        text = text.replace(a, b)
        print("fixed", b)
    else:
        print("missing", a)
p.write_text(text, encoding="utf-8")
