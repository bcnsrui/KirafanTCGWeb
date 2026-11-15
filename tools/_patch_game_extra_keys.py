# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

BLOCKS = {
    '"game.replayResignAsLoss": "Loss",': '''
  "game.viewPile": "View {who}'s {pile} (click again to close)",
  "game.pileOf": "{who}'s {pile}",
  "game.placedFromHand": "From hand ({n})",
  "game.concealSanctuary": "Hidden until both players choose Sanctuary cards",
  "game.dotteOrder": "← First card out is on the left",
  "game.pileTotal": "{title} ({n})",
  "game.replayWhere": "{at} / {total} · Turn {turn}",
  "game.replayTurns": "{n} turns",
  "game.win": "Victory",
  "game.loss": "Defeat",
  "duel.resultWin": "Victory",
  "duel.resultLoss": "Defeat",
  "duel.resultResign": "Surrender",
''',
    '"game.replayResignAsLoss": "패배",': '''
  "game.viewPile": "{who}의 {pile} 카드 보기 (다시 누르면 닫기)",
  "game.pileOf": "{who}의 {pile}",
  "game.placedFromHand": "패에서 넣은 카드 ({n}장)",
  "game.concealSanctuary": "양쪽이 성전 카드를 고를 때까지 볼 수 없습니다",
  "game.dotteOrder": "← 가장 먼저 빠지는 카드부터",
  "game.pileTotal": "{title} ({n}장)",
  "game.replayWhere": "{at} / {total} · {turn}턴",
  "game.replayTurns": "{n}턴",
  "game.win": "승리",
  "game.loss": "패배",
  "duel.resultWin": "승리",
  "duel.resultLoss": "패배",
  "duel.resultResign": "항복",
''',
    '"game.replayResignAsLoss": "敗北",': '''
  "game.viewPile": "{who}の{pile}を見る (再クリックで閉じる)",
  "game.pileOf": "{who}の{pile}",
  "game.placedFromHand": "手札から入れたカード ({n}枚)",
  "game.concealSanctuary": "双方が聖典カードを選ぶまで見れません",
  "game.dotteOrder": "← 先に出ていくカードから",
  "game.pileTotal": "{title} ({n}枚)",
  "game.replayWhere": "{at} / {total} · {turn}ターン",
  "game.replayTurns": "{n}ターン",
  "game.win": "勝利",
  "game.loss": "敗北",
  "duel.resultWin": "勝利",
  "duel.resultLoss": "敗北",
  "duel.resultResign": "降参",
''',
}

for marker, block in BLOCKS.items():
    if marker not in text:
        raise SystemExit(f"missing marker: {marker}")
    idx = text.find(marker)
    after = text[idx:idx + 900]
    if '"game.viewPile"' in after:
        print("skip", marker)
        continue
    text = text.replace(marker, marker + block, 1)
    print("injected", marker)

p.write_text(text, encoding="utf-8")
print("done", p)
