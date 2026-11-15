# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

blocks = {
    '"ai.deck": "AI deck",': '''"ai.deck": "AI deck",
  "ai.deckSource.level": "This level",
  "ai.deckSource.all": "All AI",
  "ai.deckSource.custom": "Custom",
  "ai.customDeck": "Custom · {name}",
  "ai.noCustomDecks": "No custom decks yet — make one in Deck Editor",''',
    '"ai.deck": "AI 덱",': '''"ai.deck": "AI 덱",
  "ai.deckSource.level": "이 난이도",
  "ai.deckSource.all": "전체 AI",
  "ai.deckSource.custom": "커스텀",
  "ai.customDeck": "커스텀 · {name}",
  "ai.noCustomDecks": "커스텀 덱이 없습니다. 덱 편집에서 만들어 주세요",''',
    '"ai.deck": "AIデッキ",': '''"ai.deck": "AIデッキ",
  "ai.deckSource.level": "この難易度",
  "ai.deckSource.all": "全AI",
  "ai.deckSource.custom": "カスタム",
  "ai.customDeck": "カスタム · {name}",
  "ai.noCustomDecks": "カスタムデッキがありません。デッキ編集で作成してください",''',
}

for old, new in blocks.items():
    if '"ai.deckSource.level"' in text and old in text:
        idx = text.find(old)
        if "ai.deckSource.level" in text[idx:idx + 120]:
            print("skip", old)
            continue
    if old not in text:
        print("MISSING", old)
        continue
    text = text.replace(old, new, 1)
    print("ok", old)

p.write_text(text, encoding="utf-8")
print("done")
