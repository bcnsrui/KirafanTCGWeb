"""Build data/ja/{cards,engine,puzzles}.json — JP names curated, effects MT + TCG terms."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ja"

# Official / wiki-style Japanese names (きらファン / 原作準拠)
NAME_JA: dict[int, str] = {
    10050111: "きらら(召喚士カード)",
    10050112: "ランプ(召喚士カード)",
    10050113: "クレア(召喚士カード)",
    10050114: "アルシーヴ(召喚士カード)",
    10050115: "メディア(召喚士カード)",
    10050116: "住良木うつつ(召喚士カード)",
    10050117: "ハイプリス(召喚士カード)",
    10051111: "野々原ゆずこ",
    10051121: "森野きりん",
    10051122: "細野はるみ",
    10051131: "滝本ひふみ",
    10051132: "志摩リン",
    10051133: "平沢唯",
    10051211: "京塚志温",
    10051221: "篠田はじめ",
    10051222: "各務原なでしこ",
    10051231: "日向夏帆",
    10051311: "千石冠",
    10051321: "御庭つみき",
    10051322: "ファー",
    10051331: "ソニーヤ",
    10051332: "キョージュ(大道寺美弥)",
    10051411: "烏丸さくら",
    10051421: "牛久花和",
    10051431: "保登ココア",
    10051511: "沙英",
    10051521: "大宮忍",
    10051531: "宮子",
    10051621: "千代田桃",
    10051622: "松原穂乃花",
    10051631: "九条カレン",
    10051632: "メリー・ナイトメア",
    10052121: "風色琴音",
    10052131: "鳩谷こはね",
    10052221: "村上椎奈",
    10052222: "舘島虎徹",
    10052231: "星川麻冬",
    10052232: "雲雀丘瑠璃",
    10052321: "片瀬真宵",
    10052322: "恋塚小さゆめ",
    10052331: "本田珠輝",
    10052421: "巽紺",
    10052422: "西川葉子",
    10052423: "武田詠深",
    10052431: "涼風青葉",
    10052432: "園田優",
    10052433: "中野梓",
    10052521: "緑へも",
    10052531: "桐間紗路",
    10052621: "陽夏木ミカン",
    10052631: "香風智乃",
    10053111: "百木るん",
    10053121: "遠井成美",
    10053131: "千矢",
    10053211: "海凪ひより",
    10053221: "篠花真由",
    10053231: "天々座理世",
    10053311: "雨宮まゆ",
    10053321: "飯島ゆん",
    10053331: "折部やすな",
    10053332: "非運の人物？",
    10053411: "池谷のの",
    10053421: "櫟井唯",
    10053431: "直樹美紀",
    10053511: "ライネ",
    10053521: "相川千穂",
    10053531: "園部篠",
    10053611: "桜衣乃",
    10053621: "ぼっち(後藤ひとり)",
    10053631: "恵飛須沢胡桃",
    10054111: "蒼苑寺美紅",
    10054121: "野田美紀",
    10054122: "内木ユキ",
    10054211: "丈槍由紀",
    10054212: "海凪小春",
    10054221: "秋山澪",
    10054222: "一之瀬花名",
    10054311: "木ノ幡みら",
    10054312: "若狭悠里",
    10054321: "かおす(萌田薫子)",
    10054411: "棗ノノ",
    10054412: "小田切双葉",
    10054421: "宇治松千夜",
    10054512: "奈津恵",
    10054521: "ゆの",
    10054522: "里中千枝",
    10054523: "ヒロ",
    10054524: "関谷なる",
    10054611: "真中蒼",
    10054621: "布田由美音",
    10054622: "シャミ子(吉田優子)",
    10055111: "町子リョウ",
    10055112: "闇のアリス・カータレット",
    10055113: "不思議の国のアリス・カータレット",
    10055114: "榎並清瀬",
    10055211: "高山春香",
    10055212: "吉田優子",  # リリス側表記差あり → リリスママ表記は別
    10055213: "小野寺小春",
    10055221: "桜ノ宮苺香",
    10055222: "山口綺羅星",
    10055311: "色川琉姫",
    10055312: "天王寺渚",
    10055411: "葉山照",
    10055421: "二条臣",
    10055511: "おかあさん(松本頼子)",
    10055512: "百地たまて",
    10055513: "ハナ・N・フォンテーンスタンド",
    10055611: "佐山菫",
    10055612: "花小泉杏",
    10055621: "有馬ひづめ",
    10055622: "クロ",
}

# 55212 is 吉田涼子 (Lilith) not Yuuko - fix
NAME_JA[10055212] = "吉田涼子"

SERIES_JA = {
    "키라라 판타지아": "きららファンタジア",
    "유유시키": "ゆゆ式",
    "행복 그래피티": "幸腹グラフィティ",
    "NEW GAME!": "NEW GAME!",
    "유루캠△": "ゆるキャン△",
    "케이온!": "けいおん！",
    "슬로우 스타트": "スロウスタート",
    "블렌드S": "ブレンド・S",
    "여기저기": "あっちこっち",
    "RPG부동산": "RPG不動産",
    "킬미 베이비": "キルミーベイベー",
    "GA 예술과 아트 디자인 클래스": "GA 芸術科アートデザインクラス",
    "금빛 모자이크": "きんいろモザイク",
    "아니마 옐!": "アニマエール！",
    "주문은 토끼입니까?": "ご注文はうさぎですか？",
    "히다마리 스케치": "ひだまりスケッチ",
    "길모퉁이 마족": "まちカドまぞく",
    "꿈을 먹는 메리": "夢喰いメリー",
    "스텔라의 마법": "ステラのまほう",
    "언해피♪": "あんハピ♪",
    "코믹 걸즈": "こみっくがーるず",
    "우라라 미로첩": "うらら迷路帖",
    "삼자삼엽": "三者三葉",
    "타마요미": "球詠",
    "사쿠라 Trick": "桜Trick",
    "뒤떨어진 후르츠타르트": "おちこぼれフルーツタルト",
    "A채널": "Aチャンネル",
    "하루카나 리시브": "はるかなレシーブ",
    "슬로우 루프": "スローループ",
    "파워 오브 스마일": "ぱわーおぶすまいる。",
    "학교생활!": "がっこうぐらし！",
    "봇치 더 락!": "ぼっち・ざ・ろっく！",
    "사랑하는 소행성": "恋する小惑星",
    "하나야마타": "ハナヤマタ",
    "망가타임": "まんがタイム",
    "코하루비요리": "こはる日和。",
    "관지기 쿠로 ~마음속 여행자 이야기~": "棺担ぎのクロ。～懐中旅話～",
}

# Keep class/attribute Korean keys for filters (same as EN pack)
# Game terms: EN → JP (TCG / きらファン風)
TERM_EN_JA = [
    (r"\bMain Character\b", "召喚士"),
    (r"\bCreamates?\b", "クリエメイト"),
    (r"\bTotteoki Gauge\b", "とっておきゲージ"),
    (r"\bTotteoki Zone\b", "とっておきゾーン"),
    (r"\bTotteoki\b", "とっておき"),
    (r"\bBattle Zone\b", "バトルゾーン"),
    (r"\bSupport Zone\b", "サポートゾーン"),
    (r"\bSanctuary\b", "聖典"),
    (r"\bVillage\b", "里"),
    (r"\bCastle Stones?\b", "城石"),
    (r"\bBattle Phase\b", "バトルフェイズ"),
    (r"\bMain Phase\b", "メインフェイズ"),
    (r"\bStandby Phase\b", "スタンバイフェイズ"),
    (r"\bDraw Phase\b", "ドローフェイズ"),
    (r"\bEnd Phase\b", "エンドフェイズ"),
    (r"\bTrue Hand\b", "真実の手"),
    (r"\bbasic attack\b", "通常攻撃"),
    (r"\bnormal attack\b", "通常攻撃"),
    (r"\[Summon\]", "【召喚】"),
    (r"\[Totteoki Gauge (\d+)\]", r"【とっておきゲージ\1】"),
    (r"\bATK\b", "攻撃力"),
    (r"\bHP\b", "体力"),
    (r"\bStiff\b", "硬直"),
    (r"\bDelay\b", "ディレイ"),
    (r"\bHeal\b", "回復"),
    (r"\bWeakness\b", "弱体"),
    (r"\bHunger\b", "空腹"),
    (r"\bBind\b", "拘束"),
    (r"\bSleep\b", "睡眠"),
    (r"\bMisfortune\b", "不幸"),
    (r"\bIsolation\b", "孤立"),
    (r"\bSilence\b", "沈黙"),
    (r"\bConfusion\b", "混乱"),
    (r"\bBoss Character\b", "ボスキャラクター"),
    # Kirafan wiki-style targeting (not TCG 「1体」)
    (r"\ba single enemy\b", "敵単体"),
    (r"\ball enemies\b", "敵全体"),
    (r"\ba single ally\b", "味方単体"),
    (r"\ball allies\b", "味方全体"),
]

TERM_KO_JA = [
    ("크리에메이트", "クリエメイト"),
    ("돗테오키 게이지", "とっておきゲージ"),
    ("돗테오키 존", "とっておきゾーン"),
    ("돗테오키", "とっておき"),
    ("배틀 존", "バトルゾーン"),
    ("서포트 존", "サポートゾーン"),
    ("성전", "聖典"),
    ("마을", "里"),
    ("성채석", "城石"),
    ("배틀 페이즈", "バトルフェイズ"),
    ("메인 페이즈", "メインフェイズ"),
    ("스탠바이 페이즈", "スタンバイフェイズ"),
    ("드로우 페이즈", "ドローフェイズ"),
    ("엔드 페이즈", "エンドフェイズ"),
    ("진실의 손", "真実の手"),
    ("통상 공격", "通常攻撃"),
    ("통상공격", "通常攻撃"),
    ("소환사", "召喚士"),
    ("공격력", "攻撃力"),
    ("체력", "体力"),
    ("경직", "硬直"),
    ("회복", "回復"),
    ("나약함", "弱体"),
    ("배고픔", "空腹"),
    ("속박", "拘束"),
    ("수면", "睡眠"),
    ("불행", "不幸"),
    ("고립", "孤立"),
    ("침묵", "沈黙"),
    ("혼란", "混乱"),
    # wiki.kirafan.moe skill targeting style
    ("적 단일", "敵単体"),
    ("적 전체", "敵全体"),
    ("아군 단일", "味方単体"),
    ("아군 전체", "味方全体"),
    ("아군단일", "味方単体"),
    ("아군전체", "味方全体"),
]

# TCG-style leftovers → Kirafan wiki terms
TERM_JA_CLEANUP = [
    ("敵1体", "敵単体"),
    ("味方1体", "味方単体"),
]


def apply_terms(text: str, pairs: list[tuple[str, str]]) -> str:
    out = text
    for a, b in pairs:
        if a.startswith("\\") or "[" in a or "\\b" in a:
            out = re.sub(a, b, out, flags=re.IGNORECASE)
        else:
            out = out.replace(a, b)
    return out


def apply_ja_cleanup(text: str) -> str:
    return apply_terms(text, TERM_JA_CLEANUP)


def translate_batch(texts: list[str], src: str = "en") -> list[str]:
    try:
        from deep_translator import GoogleTranslator
    except ImportError:
        print("Installing deep_translator…")
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "deep_translator", "-q"])
        from deep_translator import GoogleTranslator

    tr = GoogleTranslator(source=src, target="ja")
    out: list[str] = []
    for i, t in enumerate(texts):
        if not t or not t.strip():
            out.append(t)
            continue
        # protect already-JP / terms with placeholders
        try:
            # chunk long texts
            chunks = []
            buf = t
            while len(buf) > 4500:
                cut = buf.rfind("\n", 0, 4000)
                if cut < 500:
                    cut = 4000
                chunks.append(buf[:cut])
                buf = buf[cut:]
            chunks.append(buf)
            parts = []
            for ch in chunks:
                parts.append(tr.translate(ch) if ch.strip() else ch)
                time.sleep(0.05)
            out.append("\n".join(parts) if len(chunks) > 1 and "\n" in t else "".join(parts) if len(chunks) == 1 else "\n".join(parts))
        except Exception as e:
            print(f"  MT fail [{i}]: {e}")
            out.append(t)
        if (i + 1) % 20 == 0:
            print(f"  translated {i + 1}/{len(texts)}")
    return out


def build_cards() -> None:
    ko = json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))
    en_by_id = {c["id"]: c for c in json.loads((ROOT / "data/en/cards.json").read_text(encoding="utf-8"))["cards"]}

    missing = [c["id"] for c in ko["cards"] if c["id"] not in NAME_JA]
    if missing:
        raise SystemExit(f"Missing JA names for: {missing}")

    descs_en = []
    for c in ko["cards"]:
        e = en_by_id[c["id"]]
        descs_en.append(e.get("desc") or "")

    print(f"Translating {len(descs_en)} card texts EN→JA…")
    descs_ja = translate_batch(descs_en, "en")

    cards = []
    for c, desc_raw in zip(ko["cards"], descs_ja):
        e = en_by_id[c["id"]]
        desc = apply_terms(desc_raw or "", TERM_EN_JA)
        desc = apply_terms(desc, [(a, b) for a, b in TERM_KO_JA])  # leftover
        desc = apply_ja_cleanup(desc)
        card = dict(c)
        card["name"] = NAME_JA[c["id"]]
        card["desc"] = desc
        card["series"] = SERIES_JA.get(c.get("series", ""), c.get("series", ""))
        # keep class/attribute/types in Korean for filters
        cards.append(card)

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"maxCopies": ko.get("maxCopies", 3), "mainSize": ko.get("mainSize", 60), "cards": cards}
    (OUT / "cards.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT / 'cards.json'} ({len(cards)} cards)")


def build_engine() -> None:
    en = json.loads((ROOT / "data/en/engine.json").read_text(encoding="utf-8"))
    cards = en.get("cards") or {}
    # collect strings to translate
    jobs: list[tuple[str, str, int | None]] = []  # (card_id, field, str_index or None for name)
    texts: list[str] = []
    for cid, info in cards.items():
        name = info.get("name") or ""
        # map name if known id
        try:
            iid = int(cid)
        except ValueError:
            iid = None
        if iid in NAME_JA:
            info["name"] = NAME_JA[iid]
        else:
            # Sugar boss etc.
            jobs.append((cid, "name", None))
            texts.append(name)
        for i, s in enumerate(info.get("strings") or []):
            if s and s.strip():
                jobs.append((cid, "strings", i))
                texts.append(s)

    print(f"Translating {len(texts)} engine strings EN→JA…")
    translated = translate_batch(texts, "en")
    ti = 0
    for cid, field, idx in jobs:
        val = apply_ja_cleanup(apply_terms(translated[ti], TERM_EN_JA))
        ti += 1
        if field == "name":
            cards[cid]["name"] = val
        else:
            cards[cid]["strings"][idx] = val

    en["cards"] = cards
    (OUT / "engine.json").write_text(json.dumps(en, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT / 'engine.json'}")


PUZZLE_CAT = {"튜토리얼": "チュートリアル", "노말모드": "ノーマル", "하드모드": "ハード"}
PUZZLE_TITLE = {
    "프롤로그": "プロローグ",
    "소환": "召喚",
    "승려": "僧侶",
    "알케미스트": "アルケミスト",
    "성전": "聖典",
    "회복": "回復",
    "나약함&배고픔": "弱体＆空腹",
    "수면&고립": "睡眠＆孤立",
    "속박": "拘束",
    "불행": "不幸",
    "후다 유미네": "布田由美音",
    "하토야 코하네": "鳩谷こはね",
    "쿠죠 카렌": "九条カレン",
    "에토와리아의 정기시험": "エトワリアの定期試験",
    "혼다 타마키": "本田珠輝",
    "아니마옐": "アニマエール！",
    "키리마 샤로": "桐間紗路",
    "금빛 모자이크": "きんいろモザイク",
    "소노다 유우": "園田優",
    "스텔라의 마법": "ステラのまほう",
    "오리베 야스나": "折部やすな",
    "길모퉁이 마족": "まちカドまぞく",
    "고토 히토리": "後藤ひとり",
    "히다마리 스케치": "ひだまりスケッチ",
}

SPEAKER_JA = {
    "클레어": "クレア",
    "Claire": "クレア",
    "램프": "ランプ",
    "Lamp": "ランプ",
    "키라라": "きらら",
    "Kirara": "きらら",
    "슈가": "シュガー",
    "Sugar": "シュガー",
    "아르시브": "アルシーヴ",
    "Archive": "アルシーヴ",
    "유노": "ゆの",
    "Yuno": "ゆの",
    "미야코": "宮子",
    "Miyako": "宮子",
    "히로": "ヒロ",
    "Hiro": "ヒロ",
    "쿠죠 카렌": "九条カレン",
    "Kujo Karen": "九条カレン",
    "Kujou Karen": "九条カレン",
    "하토야 코하네": "鳩谷こはね",
    "Hatoya Kohane": "鳩谷こはね",
    "혼다 타마키": "本田珠輝",
    "Honda Tamaki": "本田珠輝",
}


def build_puzzles() -> None:
    puzzles = json.loads((ROOT / "data/puzzles.json").read_text(encoding="utf-8"))
    hint_re = re.compile(r"Debug\.ShowHint\[\[(.*?)\]\]", re.DOTALL)
    unique: list[str] = []
    seen = set()
    for p in puzzles:
        for m in hint_re.finditer(p["source"].replace("\r\n", "\n").replace("\r", "\n")):
            h = m.group(1)
            if h not in seen:
                seen.add(h)
                unique.append(h)

    # Prefer English puzzle-hints if present (cleaner MT source)
    en_hints_path = ROOT / "data/en/puzzle-hints.json"
    en_map = {}
    if en_hints_path.exists():
        en_map = json.loads(en_hints_path.read_text(encoding="utf-8"))
        en_map = {k.replace("\r\n", "\n").replace("\r", "\n"): v for k, v in en_map.items()}

    to_mt = []
    for h in unique:
        src = en_map.get(h, h)
        # speaker swap on EN first
        if src.startswith("★"):
            line, _, rest = src.partition("\n")
            sp = line[1:].strip()
            spj = SPEAKER_JA.get(sp, sp)
            src = f"★{spj}\n{rest}" if rest else f"★{spj}"
        to_mt.append(apply_terms(src, TERM_EN_JA))

    print(f"Translating {len(to_mt)} puzzle hints → JA…")
    ja_bodies = translate_batch(to_mt, "en")
    hint_map = {}
    for ko_h, ja in zip(unique, ja_bodies):
        ja = apply_terms(ja, TERM_EN_JA)
        ja = apply_terms(ja, TERM_KO_JA)
        ja = apply_ja_cleanup(ja)
        # fix speaker if KO path
        if ja.startswith("★"):
            line, _, rest = ja.partition("\n")
            sp = line[1:].strip()
            spj = SPEAKER_JA.get(sp, sp)
            ja = f"★{spj}\n{rest}" if rest else f"★{spj}"
        hint_map[ko_h] = ja

    (OUT / "puzzle-hints.json").write_text(
        json.dumps(hint_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    def repl(m: re.Match) -> str:
        body = m.group(1).replace("\r\n", "\n").replace("\r", "\n")
        return f"Debug.ShowHint[[{hint_map.get(body, body)}]]"

    out = []
    for p in puzzles:
        q = dict(p)
        q["category"] = PUZZLE_CAT[p["category"]]
        q["title"] = PUZZLE_TITLE[p["title"]]
        q["source"] = hint_re.sub(repl, p["source"].replace("\r\n", "\n").replace("\r", "\n"))
        out.append(q)

    (OUT / "puzzles.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT / 'puzzles.json'} ({len(out)} puzzles)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build_cards()
    build_engine()
    build_puzzles()
    print("JA pack done.")


if __name__ == "__main__":
    main()
