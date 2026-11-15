# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")
pairs = [
    ('"game.dotteGauge": "Totteoki Gauge",', '  "game.dotteZone": "Totteoki Zone",\n'),
    ('"game.dotteGauge": "돗테오키 게이지",', '  "game.dotteZone": "돗테오키 존",\n'),
    ('"game.dotteGauge": "とっておきゲージ",', '  "game.dotteZone": "とっておきゾーン",\n'),
]
for marker, insert in pairs:
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit(f"missing {marker}")
    if '"game.dotteZone"' in text[idx - 80 : idx + 40]:
        print("skip", marker)
        continue
    text = text.replace(marker, insert + marker, 1)
    print("ok", marker)
p.write_text(text, encoding="utf-8")
print("done")
