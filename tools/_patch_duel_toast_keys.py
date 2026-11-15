# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

blocks = {
    '"room.kick": "Kick",': '''"room.kick": "Kick",

  "duel.fallbackExampleDeck": "No AI match selected — starting with sample decks",
  "duel.tempAi": "Could not load AI model — using temporary AI",
  "duel.pickFirst": "Please choose who goes first",
  "duel.syncGuest": "Syncing with guest",
  "duel.syncHost": "Syncing with host",
  "duel.error": "Duel error: {msg}",
  "duel.noMatchDeck": "No deck data",
  "duel.startFailMsg": "Could not start the match: {msg}",
  "toast.needLogin": "Login required",''',
    '"room.kick": "강퇴",': '''"room.kick": "강퇴",

  "duel.fallbackExampleDeck": "AI 대전에서 고른 대전이 없어 예시 덱으로 대전합니다",
  "duel.tempAi": "AI 모델을 불러오지 못해 임시 AI로 대전합니다",
  "duel.pickFirst": "선후공을 선택해 주세요",
  "duel.syncGuest": "게스트와 동기화합니다",
  "duel.syncHost": "방장과 동기화합니다",
  "duel.error": "대전 중 오류: {msg}",
  "duel.noMatchDeck": "덱 정보가 없습니다",
  "duel.startFailMsg": "대전을 시작하지 못했습니다: {msg}",
  "toast.needLogin": "로그인이 필요합니다",''',
    '"room.kick": "キック",': '''"room.kick": "キック",

  "duel.fallbackExampleDeck": "AI対戦の選択がないためサンプルデッキで対戦します",
  "duel.tempAi": "AIモデルを読み込めず一時AIで対戦します",
  "duel.pickFirst": "先後攻を選んでください",
  "duel.syncGuest": "ゲストと同期します",
  "duel.syncHost": "ホストと同期します",
  "duel.error": "対戦エラー: {msg}",
  "duel.noMatchDeck": "デッキ情報がありません",
  "duel.startFailMsg": "対戦を開始できませんでした: {msg}",
  "toast.needLogin": "ログインが必要です",''',
}

for old, new in blocks.items():
    if old not in text:
        print("MISSING anchor:", old)
        continue
    if "duel.fallbackExampleDeck" in text and old.split('"')[3] in ("Kick", "강퇴", "キック"):
        # already patched? check nearby
        idx = text.find(old)
        snippet = text[idx:idx+200]
        if "duel.fallbackExampleDeck" in snippet:
            print("skip already", old[:40])
            continue
    text = text.replace(old, new, 1)
    print("ok", old[:40])

p.write_text(text, encoding="utf-8")
print("done")
