# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

BLOCKS = {
    '"log.resuming": "Restoring match state…",': '''
  "duel.pickVillage": "When a Battle Creamate falls, choose 1 card to send to the Village",
  "duel.battleEndOpp": "Opponent is ending the Battle Phase. Using a Support continues it.",
  "duel.battleStartMe": "Battle Phase begins.",
  "duel.battleStartOpp": "Opponent's Battle Phase begins.",
  "duel.phaseNow": "{phase} Phase.",
  "duel.attackAll": "{name} made a normal attack",
  "duel.attackOne": "{name} made a normal attack on {target}",
  "duel.usedOn": "{name} used {what} on {target}",
  "duel.used": "{name} used {what}",
  "duel.dotteEffect": "Totteoki effect",
  "duel.dotteZoneEffect": "Totteoki Zone effect",
  "duel.effect": "effect",
  "duel.battleEndEffect": "Battle Phase End effect",
  "duel.battleStartEffect": "Battle Phase Start effect",
  "duel.battleStartAtk": "Battle Phase Start: +1 normal attack for each Battle Creamate",
  "duel.dotteZoneWhen": "When sent to Totteoki Zone: {text}",
  "duel.phaseEffect": "{phase} Phase effect",
  "duel.pickSupport": "Choose a Support Creamate. Its effect resolves immediately.",
  "duel.placeLeft": "Left",
  "duel.placeMid": "Center",
  "duel.placeRight": "Right",
''',
    '"log.resuming": "대전 상태를 복구하는 중…",': '''
  "duel.pickVillage": "배틀 크리에메이트가 쓰러졌을 때는 마을로 보낼 카드 1장을 선택해주세요",
  "duel.battleEndOpp": "상대가 배틀 페이즈를 끝내려 합니다. 서포트를 사용하면 배틀 페이즈가 계속됩니다.",
  "duel.battleStartMe": "배틀 페이즈가 시작됩니다.",
  "duel.battleStartOpp": "상대의 배틀 페이즈가 시작됩니다.",
  "duel.phaseNow": "{phase} 페이즈입니다.",
  "duel.attackAll": "{name}이(가) 통상 공격했습니다",
  "duel.attackOne": "{name}이(가) {target}에게 통상 공격했습니다",
  "duel.usedOn": "{name}이(가) {target}에게 {what}을(를) 사용했습니다",
  "duel.used": "{name}이(가) {what}을(를) 사용했습니다",
  "duel.dotteEffect": "돗테오키 효과",
  "duel.dotteZoneEffect": "돗테오키 존 효과",
  "duel.effect": "효과",
  "duel.battleEndEffect": "배틀 페이즈 종료시 효과",
  "duel.battleStartEffect": "배틀 페이즈 개시시 효과",
  "duel.battleStartAtk": "배틀 페이즈 개시시: 배틀 크리에메이트마다 통상 공격 횟수 +1",
  "duel.dotteZoneWhen": "돗테오키 존으로 보내졌을 때: {text}",
  "duel.phaseEffect": "{phase} 페이즈 효과",
  "duel.pickSupport": "사용할 서포트 크리에메이트를 고르세요. 고른 서포트의 효과가 바로 적용됩니다.",
  "duel.placeLeft": "왼쪽",
  "duel.placeMid": "중앙",
  "duel.placeRight": "오른쪽",
''',
    '"log.resuming": "対戦状態を復元中…",': '''
  "duel.pickVillage": "バトルクリエメイトが倒れたとき、里へ送るカードを1枚選んでください",
  "duel.battleEndOpp": "相手がバトルフェイズを終えようとしています。サポートを使うとバトルフェイズが続きます。",
  "duel.battleStartMe": "バトルフェイズが始まります。",
  "duel.battleStartOpp": "相手のバトルフェイズが始まります。",
  "duel.phaseNow": "{phase}フェイズです。",
  "duel.attackAll": "{name}が通常攻撃しました",
  "duel.attackOne": "{name}が{target}に通常攻撃しました",
  "duel.usedOn": "{name}が{target}に{what}を使いました",
  "duel.used": "{name}が{what}を使いました",
  "duel.dotteEffect": "とっておき効果",
  "duel.dotteZoneEffect": "とっておきゾーン効果",
  "duel.effect": "効果",
  "duel.battleEndEffect": "バトルフェイズ終了時効果",
  "duel.battleStartEffect": "バトルフェイズ開始時効果",
  "duel.battleStartAtk": "バトルフェイズ開始時: バトルクリエメイトごとに通常攻撃回数+1",
  "duel.dotteZoneWhen": "とっておきゾーンへ送られたとき: {text}",
  "duel.phaseEffect": "{phase}フェイズ効果",
  "duel.pickSupport": "使うサポートクリエメイトを選んでください。選んだサポートの効果がすぐに適用されます。",
  "duel.placeLeft": "左",
  "duel.placeMid": "中央",
  "duel.placeRight": "右",
''',
}

for marker, block in BLOCKS.items():
    if marker not in text:
        raise SystemExit(f"missing {marker}")
    idx = text.find(marker)
    if '"duel.pickVillage"' in text[idx:idx + 800]:
        print("skip", marker)
        continue
    text = text.replace(marker, marker + block, 1)
    print("ok", marker)

p.write_text(text, encoding="utf-8")
print("done")
