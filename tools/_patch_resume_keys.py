# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

BLOCKS = {
    '"coin.tailsLog": "Coin tails: opponent chose {order}",': '''
  "log.matchStart": "{me} ({myDeck}) vs {opp}",
  "log.firstPlayer": "Going first: {who}",
  "log.resume": "Refresh: restoring from the saved sequence",
  "log.resumeDone": "Match restored",
  "log.resuming": "Restoring match state…",
''',
    '"coin.tailsLog": "코인 뒷면: 상대가 {order}을(를) 골랐습니다",': '''
  "log.matchStart": "{me} ({myDeck}) vs {opp}",
  "log.firstPlayer": "선공: {who}",
  "log.resume": "새로고침: 저장된 수순으로 복구합니다",
  "log.resumeDone": "대전 복구 완료",
  "log.resuming": "대전 상태를 복구하는 중…",
''',
    '"coin.tailsLog": "コイン裏: 相手が{order}を選びました",': '''
  "log.matchStart": "{me} ({myDeck}) vs {opp}",
  "log.firstPlayer": "先攻: {who}",
  "log.resume": "更新: 保存された手順から復元します",
  "log.resumeDone": "対戦を復元しました",
  "log.resuming": "対戦状態を復元中…",
''',
}

for marker, block in BLOCKS.items():
    if marker not in text:
        raise SystemExit(f"missing {marker}")
    idx = text.find(marker)
    if '"log.matchStart"' in text[idx:idx + 600]:
        print("skip", marker)
        continue
    text = text.replace(marker, marker + block, 1)
    print("ok", marker)

p.write_text(text, encoding="utf-8")
print("done")
