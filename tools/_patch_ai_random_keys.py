# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")
blocks = {
    '"ai.customDeck": "Custom · {name}",': '''"ai.customDeck": "Custom · {name}",
  "ai.randomToggle": "AI deck: random for this difficulty",
  "ai.randomPreview": "AI Lv.{n} random deck",
  "ai.randomDeck": "Random",''',
    '"ai.customDeck": "커스텀 · {name}",': '''"ai.customDeck": "커스텀 · {name}",
  "ai.randomToggle": "AI 덱은 해당 난이도의 랜덤 덱",
  "ai.randomPreview": "AI의 {n}단계 랜덤 덱입니다.",
  "ai.randomDeck": "랜덤",''',
    '"ai.customDeck": "カスタム · {name}",': '''"ai.customDeck": "カスタム · {name}",
  "ai.randomToggle": "AIデッキはこの難易度のランダム",
  "ai.randomPreview": "AIのLv.{n}ランダムデッキです。",
  "ai.randomDeck": "ランダム",''',
}
for old, new in blocks.items():
    if old not in text:
        print("MISSING", old)
        continue
    idx = text.find(old)
    if "ai.randomToggle" in text[idx:idx + 220]:
        print("skip", old[:40])
        continue
    text = text.replace(old, new, 1)
    print("ok", old[:40])
p.write_text(text, encoding="utf-8")
print("done")
