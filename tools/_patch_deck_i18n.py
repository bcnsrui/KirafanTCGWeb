"""Insert deck/attr/class i18n keys into ui-i18n.js EN/KO/JA tables."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "js" / "ui-i18n.js"
src = path.read_text(encoding="utf-8")

KEYS = {
    "deck.aiDeck": ("AI Deck:", "AI 덱:", "AIデッキ:"),
    "deck.deck": ("Deck:", "덱:", "デッキ:"),
    "deck.name": ("Name:", "이름:", "名前:"),
    "deck.namePlaceholder": ("Deck name", "덱 이름", "デッキ名"),
    "deck.clear": ("Clear", "비우기", "空にする"),
    "deck.new": ("New Deck", "새 덱", "新規デッキ"),
    "deck.saveAs": ("Save As", "(으)로 저장", "名前を付けて保存"),
    "deck.exit": ("Exit Editor", "덱 편집 나가기", "編集を終了"),
    "deck.delete": ("Delete", "삭제", "削除"),
    "deck.import": ("Import Deck", "덱 불러오기", "デッキ読込"),
    "deck.export": ("Export Deck", "덱 내보내기", "デッキ書出"),
    "deck.importTitle": ("Load a .ydk file as a new deck", ".ydk 파일을 새 덱으로 불러옵니다", ".ydkファイルを新規デッキとして読み込みます"),
    "deck.exportTitle": ("Export the current deck as a .ydk file", "지금 덱을 .ydk 파일로 내보냅니다", "現在のデッキを.ydkファイルで書き出します"),
    "deck.summoner": ("Summoner", "소환사 카드", "召喚士カード"),
    "deck.mainCountLabel": ("Cards:", "덱 장수:", "枚数:"),
    "deck.unsaved": ("Unsaved · ", "저장 안 됨 · ", "未保存 · "),
    "deck.results": ("Results:", "결과:", "結果:"),
    "deck.sort": ("Sort", "정렬", "並べ替え"),
    "deck.sort.levelAsc": ("Level ↑", "레벨 ↑", "レベル ↑"),
    "deck.sort.levelDesc": ("Level ↓", "레벨 ↓", "레벨 ↓"),
    "deck.sort.class": ("Class", "클래스", "クラス"),
    "deck.sort.name": ("Name", "이름", "名前"),
    "deck.resetFilters": ("Reset", "초기화", "リセット"),
    "deck.attrTitle": ("{name} Attribute", "{name} 속성", "{name}属性"),
    "deck.levelN": ("Level {n}", "레벨 {n}", "レベル{n}"),
    "deck.atkHp": ("ATK/HP", "공격력/체력", "攻撃力/体力"),
    "deck.battleSupport": ("Battle {b} · Support {s}", "배틀 {b} · 서포트 {s}", "バトル {b} · サポート {s}"),
    "deck.aiBrowse": ("Browse AI decks…", "AI 덱 보기…", "AIデッキを見る…"),
    "deck.aiNone": ("(No AI decks)", "(AI 덱 없음)", "(AIデッキなし)"),
    "deck.aiLevel": ("AI Lv.{n}", "AI {n}단계", "AI Lv.{n}"),
    "deck.saved": ("Saved “{name}”", "“{name}” 덱을 저장했습니다", "「{name}」を保存しました"),
    "deck.renamed": ("Renamed “{old}” to “{name}”", "“{old}” 덱을 “{name}”(으)로 이름을 바꿔 저장했습니다", "「{old}」を「{name}」に改名して保存しました"),
    "deck.unsavedConfirm": ("“{name}” has unsaved changes.\nLeave without saving?", "“{name}” 덱에 저장하지 않은 변경 사항이 있습니다.\n저장하지 않고 넘어갈까요?", "「{name}」に未保存の変更があります。\n保存せずに移動しますか？"),
    "deck.needName": ("Enter a name to save", "저장할 이름을 입력해 주세요", "保存する名前を入力してください"),
    "deck.overwrite": ("Overwrite “{name}”?", "“{name}” 덱을 덮어쓸까요?", "「{name}」を上書きしますか？"),
    "deck.alreadyExists": ("“{name}” already exists. Overwrite?", "“{name}” 덱이 이미 있습니다. 덮어쓸까요?", "「{name}」は既にあります。上書きしますか？"),
    "deck.cannotDeleteAi": ("Cannot delete an AI deck", "AI 덱은 삭제할 수 없습니다", "AIデッキは削除できません"),
    "deck.deleteConfirm": ("Delete “{name}”?", "“{name}” 덱을 삭제할까요?", "「{name}」を削除しますか？"),
    "deck.mainFull": ("Main deck is limited to {n} cards", "메인 덱은 {n}장까지입니다", "メインデッキは{n}枚までです"),
    "deck.maxCopies": ("Up to {n} copies of the same card", "같은 카드는 {n}장까지입니다", "同じカードは{n}枚までです"),
    "deck.exported": ("Exported as “{name}.ydk”", "“{name}.ydk”(으)로 내보냈습니다", "「{name}.ydk」で書き出しました"),
    "deck.imported": ("Loaded “{name}”", "“{name}” 덱을 불러왔습니다", "「{name}」を読み込みました"),
    "deck.savedAs": ("Saved as “{name}”", "“{name}”(으)로 저장했습니다", "「{name}」として保存しました"),
    "deck.noSummoner": ("No summoner card", "소환사 카드 없음", "召喚士カードなし"),
    "deck.wrongSize": ("Not {n} cards", "{n}장이 아님", "{n}枚ではありません"),
    "deck.textSmaller": ("Smaller text", "글자 작게", "文字を小さく"),
    "deck.textBigger": ("Larger text", "글자 크게", "文字を大きく"),
    "attr.땅": ("Earth", "땅", "土"),
    "attr.물": ("Water", "물", "水"),
    "attr.불": ("Fire", "불", "炎"),
    "attr.바람": ("Wind", "바람", "風"),
    "attr.해": ("Sun", "해", "陽"),
    "attr.달": ("Moon", "달", "月"),
    "class.전사": ("Fighter", "전사", "せんし"),
    "class.마법사": ("Mage", "마법사", "まほうつかい"),
    "class.나이트": ("Knight", "나이트", "ナイト"),
    "class.승려": ("Priest", "승려", "そうりょ"),
    "class.알케미스트": ("Alchemist", "알케미스트", "アルケミスト"),
    "class.소환사": ("Summoner", "소환사", "召喚士"),
}

# Fix JA typo for levelDesc
KEYS["deck.sort.levelDesc"] = ("Level ↓", "레벨 ↓", "レベル ↓")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def inject(block_name: str, idx: int) -> None:
    global src
    m = re.search(rf"(const {block_name} = \{{)(.*?)(\n\}})", src, re.S)
    if not m:
        raise SystemExit(f"missing {block_name}")
    body = m.group(2)
    for key, vals in KEYS.items():
        line = f'\n  "{key}": "{esc(vals[idx])}",'
        # remove existing
        body = re.sub(rf'\n  "{re.escape(key)}": "[^"]*",', "", body)
        # insert before last entry area - append near end
        body = body.rstrip() + line
    src = src[: m.start()] + m.group(1) + body + m.group(3) + src[m.end() :]


inject("EN", 0)
inject("KO", 1)
inject("JA", 2)

# helpers after t()
helper = '''
export function attrLabel(v) {
  return t(`attr.${v}`);
}

export function classLabel(v) {
  return t(`class.${v}`);
}
'''
if "export function attrLabel" not in src:
    src = src.replace(
        "export function puzzleCategoryLabel(cat) {",
        helper + "\nexport function puzzleCategoryLabel(cat) {",
    )

path.write_text(src, encoding="utf-8")
print("patched keys", len(KEYS))
