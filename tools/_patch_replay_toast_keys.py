# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "js" / "ui-i18n.js"
text = p.read_text(encoding="utf-8")

BLOCKS = {
    '"replay.missing": "Replay not found",': '''
  "replay.imported": "Replay imported",
  "replay.notFile": "Not a replay file",
  "replay.readFail": "Could not read the file",
  "replay.saveFail": "Could not save the replay",
''',
    '"replay.missing": "리플레이를 찾지 못했습니다",': '''
  "replay.imported": "리플레이를 불러왔습니다",
  "replay.notFile": "리플레이 파일이 아닙니다",
  "replay.readFail": "파일을 읽지 못했습니다",
  "replay.saveFail": "리플레이를 저장하지 못했습니다",
''',
    '"replay.missing": "リプレイが見つかりません",': '''
  "replay.imported": "リプレイを読み込みました",
  "replay.notFile": "リプレイファイルではありません",
  "replay.readFail": "ファイルを読めませんでした",
  "replay.saveFail": "リプレイを保存できませんでした",
''',
}

for marker, block in BLOCKS.items():
    if marker not in text:
        raise SystemExit(f"missing {marker}")
    idx = text.find(marker)
    if '"replay.imported"' in text[idx:idx + 400]:
        print("skip", marker)
        continue
    text = text.replace(marker, marker + block, 1)
    print("ok", marker)

p.write_text(text, encoding="utf-8")
print("done")
