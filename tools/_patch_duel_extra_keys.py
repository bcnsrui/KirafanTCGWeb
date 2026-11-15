# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

blocks = {
    '"toast.needLogin": "Login required",': '''"toast.needLogin": "Login required",
  "common.error": "Error",
  "duel.aborted": "The duel was interrupted.\\n{msg}",
  "duel.toRoomList": "Room list",
  "duel.startFailBody": "Could not start the match.\\n{msg}",''',
    '"toast.needLogin": "로그인이 필요합니다",': '''"toast.needLogin": "로그인이 필요합니다",
  "common.error": "오류",
  "duel.aborted": "대전이 중단되었습니다.\\n{msg}",
  "duel.toRoomList": "방 목록으로",
  "duel.startFailBody": "대전을 시작하지 못했습니다.\\n{msg}",''',
    '"toast.needLogin": "ログインが必要です",': '''"toast.needLogin": "ログインが必要です",
  "common.error": "エラー",
  "duel.aborted": "対戦が中断されました。\\n{msg}",
  "duel.toRoomList": "部屋一覧へ",
  "duel.startFailBody": "対戦を開始できませんでした。\\n{msg}",''',
}

for old, new in blocks.items():
    if old not in text:
        print("MISSING:", old)
        continue
    if '"common.error"' in text[text.find(old):text.find(old)+300]:
        print("skip", old[:40])
        continue
    text = text.replace(old, new, 1)
    print("ok", old[:40])

p.write_text(text, encoding="utf-8")
print("done")
