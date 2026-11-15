from pathlib import Path

root = Path(__file__).resolve().parents[1]
ui = root / "js/ui-i18n.js"
snippet = (root / "tools/_ja_ui_snippet.js").read_text(encoding="utf-8")
src = ui.read_text(encoding="utf-8")

# Insert JA after KO block (before PUZZLE_CAT)
marker = "\n/** Puzzle list meta"
if "const JA = {" in src:
    # replace existing JA
    import re
    src = re.sub(r"\nconst JA = \{.*?\n\};\n", "\n" + snippet + "\n", src, count=1, flags=re.S)
else:
    if marker not in src:
        raise SystemExit("marker not found")
    src = src.replace(marker, "\n" + snippet + "\n" + marker)

# TABLES
src = src.replace("const TABLES = { ko: KO, en: EN };", "const TABLES = { ko: KO, en: EN, ja: JA };")

# toast.langJa in EN/KO already - update EN/KO values
src = src.replace(
    '"toast.langJa": "Japanese is not ready yet. Showing Korean.",',
    '"toast.langJa": "Language set to Japanese — reloading…",',
)
src = src.replace(
    '"toast.langJa": "일본어는 준비 중입니다. 한국어로 표시합니다",',
    '"toast.langJa": "언어를 일본어로 저장했습니다 — 새로고침…",',
)

# documentElement.lang
src = src.replace(
    'document.documentElement.lang = getLang() === "en" ? "en" : "ko";',
    'document.documentElement.lang = getLang() === "en" ? "en" : getLang() === "ja" ? "ja" : "ko";',
)

# puzzle helpers for ja - categories already in data/ja so labels may be unused
ui.write_text(src, encoding="utf-8")
print("patched", ui)
