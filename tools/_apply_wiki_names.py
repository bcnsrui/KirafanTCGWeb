"""Align JA puzzle speakers/proper nouns to wiki.kirafan.moe NamedList, rebuild puzzles."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ja_pack import (  # noqa: E402
    PUZZLE_CAT,
    PUZZLE_TITLE,
    SPEAKER_JA,
    apply_ja_cleanup,
)

HINT_RE = re.compile(r"Debug\.ShowHint\[\[(.*?)\]\]", re.DOTALL)


def norm(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


# wiki.kirafan.moe NamedList m_FullName (dialogue speaker tags)
WIKI_SPEAKER = {
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
    "Alchev": "アルシーヴ",
    "Arsiv": "アルシーヴ",
    "소라": "ソラ",
    "Sola": "ソラ",
    "유노": "ゆの",
    "Yuno": "ゆの",
    "미야코": "宮子",
    "Miyako": "宮子",
    "히로": "ヒロ",
    "Hiro": "ヒロ",
    "쿠죠 카렌": "九条 カレン",
    "카렌 쿠죠": "九条 カレン",
    "Kujo Karen": "九条 カレン",
    "Karen Kujo": "九条 カレン",
    "Kujou Karen": "九条 カレン",
    "하토야 코하네": "鳩谷 こはね",
    "Hatoya Kohane": "鳩谷 こはね",
    "혼다 타마키": "本田 珠輝",
    "Honda Tamaki": "本田 珠輝",
    "마츠바라 호노카": "松原 穂乃花",
    "Matsubara Honoka": "松原 穂乃花",
    "오오미야 시노부": "大宮 忍",
    "Oomiya Shinobu": "大宮 忍",
    "우시쿠 카나": "牛久 花和",
    "Ushiku Kana": "牛久 花和",
    "후다 유미네": "布田 裕美音",
    "Fuda Yumine": "布田 裕美音",
    "샤미코": "シャミ子",
    "Shamiko": "シャミ子",
    "소노다 유우": "園田 優",
    "Sonoda Yuu": "園田 優",
    "이케타니 노노": "池谷 乃々",
    "Iketani Nono": "池谷 乃々",
    "타테지마 코테츠": "舘島 虎徹",
    "Tatejima Kotetsu": "舘島 虎徹",
    "키리마 샤로": "桐間 紗路",  # Anima Yell; not in NamedList — original JA
    "Kirima Sharo": "桐間 紗路",
    "카타세 마요이": "片瀬 真宵",
    "Katase Mayoi": "片瀬 真宵",
    "센고쿠 카무리": "千石 冠",
    "Sengoku Kamuri": "千石 冠",
    "고토 히토리": "後藤 ひとり",
    "Gotoh Hitori": "後藤 ひとり",
    "앨리스 카터릿": "アリス・カータレット",
    "Alice Cartelet": "アリス・カータレット",
    "타카야마 하루카": "高山 春香",
    "Takayama Haruka": "高山 春香",
    "오리베 야스나": "折部 やすな",
    "Oribe Yasuna": "折部 やすな",
    "히나츠키 미캉": "陽夏木 ミカン",
    "Hinatsuki Mikan": "陽夏木 ミカン",
    "호토 코코아": "ココア",
    "Hoto Cocoa": "ココア",
    "미도리 헤모": "緑 へも",
    "Midorii Hemo": "緑 へも",
    "타츠미 콘": "巽 紺",
    "Tatsumi Kon": "巽 紺",
    "에비스자와 쿠루미": "恵飛須沢 胡桃",
    "Ebisuzawa Kurumi": "恵飛須沢 胡桃",
    "모모치 타마테": "百地 たまて",
    "Momochi Tamate": "百地 たまて",
    "메리 나이트메어": "メリー・ナイトメア",
    "Mary Nightmare": "メリー・ナイトメア",
    "카오스": "かおす",
    "Chaos": "かおす",
    "스즈카제 아오바": "涼風 青葉",
    "Suzukaze Aoba": "涼風 青葉",
    "하나코이즈미 안": "花小泉 杏",
    "Hanakoizumi An": "花小泉 杏",
    "테데자 리제": "リゼ",
    "Tedeza Rize": "リゼ",
    "아리마 히즈메": "有馬 ひづめ",
    "Arima Hizume": "有馬 ひづめ",
    "코이즈카 코유메": "恋塚 小夢",
    "Koizuka Koyume": "恋塚 小夢",
    "사에": "沙英",
    "Sae": "沙英",
    "시노하 마유": "篠華 まゆ",
    "Shinoha Mayu": "篠華 まゆ",
    "소냐": "ソーニャ",
    "Sonya": "ソーニャ",
    "치요다 모모": "千代田 桃",
    "Chiyoda Momo": "千代田 桃",
    "사야마 츠바키": "狭山 椿",
    "Sayama Tsubaki": "狭山 椿",
    "교수(오미치 미야비)": "キョージュ",
    "Professor (Omichi Miyabi)": "キョージュ",
    "이치노세 하나": "一之瀬 花名",
    "Ichinose Hana": "一之瀬 花名",
}

# Wrong / non-wiki forms → wiki.kirafan.moe forms (longer first)
WIKI_BODY_FIX = [
    ("不思議の国のアリス・カータレット", "アリス・カータレット"),
    ("キョージュ(大道寺美弥)", "キョージュ"),
    ("教授（大道寺美弥）", "キョージュ"),
    ("大道寺美弥", "大道 雅"),
    ("保登ココア", "ココア"),
    ("天々座理世", "リゼ"),
    ("ぼっち(後藤ひとり)", "後藤 ひとり"),
    ("シャミ子(吉田優子)", "シャミ子"),
    ("かおす(萌田薫子)", "かおす"),
    ("布田由美音", "布田 裕美音"),
    ("由美音教団", "裕美音教団"),
    ("由美音先生", "裕美音先生"),
    ("由美音", "裕美音"),
    ("池谷のの", "池谷 乃々"),
    ("恋塚小さゆめ", "恋塚 小夢"),
    ("篠花真由", "篠華 まゆ"),
    ("ソニーヤ", "ソーニャ"),
    ("佐山菫", "狭山 椿"),
    ("九条カレン", "九条 カレン"),
    ("松原穂乃花", "松原 穂乃花"),
    ("鳩谷こはね", "鳩谷 こはね"),
    ("本田珠輝", "本田 珠輝"),
    ("大宮忍", "大宮 忍"),
    ("牛久花和", "牛久 花和"),
    ("園田優", "園田 優"),
    ("高山春香", "高山 春香"),
    ("舘島虎徹", "舘島 虎徹"),
    ("片瀬真宵", "片瀬 真宵"),
    ("千石冠", "千石 冠"),
    ("折部やすな", "折部 やすな"),
    ("陽夏木ミカン", "陽夏木 ミカン"),
    ("緑へも", "緑 へも"),
    ("巽紺", "巽 紺"),
    ("恵飛須沢胡桃", "恵飛須沢 胡桃"),
    ("百地たまて", "百地 たまて"),
    ("涼風青葉", "涼風 青葉"),
    ("花小泉杏", "花小泉 杏"),
    ("有馬ひづめ", "有馬 ひづめ"),
    ("千代田桃", "千代田 桃"),
    ("一之瀬花名", "一之瀬 花名"),
    ("後藤ひとり", "後藤 ひとり"),
    ("桐間紗路", "桐間 紗路"),
    ("エトイリア", "エトワリア"),
    ("アルシヴ", "アルシーヴ"),
]


def fix_speaker_line(text: str) -> str:
    if not text.startswith("★"):
        return text
    line, _, rest = text.partition("\n")
    sp = line[1:].strip()
    spj = WIKI_SPEAKER.get(sp) or SPEAKER_JA.get(sp, sp)
    # also normalize already-JA speakers without space
    for wrong, right in WIKI_BODY_FIX:
        if spj == wrong or spj.replace(" ", "") == wrong.replace(" ", ""):
            # only when exact compact match of known names
            pass
    compact = {a.replace(" ", ""): b for a, b in WIKI_BODY_FIX}
    if spj.replace(" ", "") in compact and " " not in spj:
        spj = compact[spj.replace(" ", "")]
    if spj in WIKI_BODY_FIX:  # unlikely
        spj = dict(WIKI_BODY_FIX).get(spj, spj)
    # direct map of old JA speakers
    ja_speaker_fix = {
        "九条カレン": "九条 カレン",
        "松原穂乃花": "松原 穂乃花",
        "鳩谷こはね": "鳩谷 こはね",
        "本田珠輝": "本田 珠輝",
        "大宮忍": "大宮 忍",
        "牛久花和": "牛久 花和",
        "園田優": "園田 優",
        "高山春香": "高山 春香",
        "舘島虎徹": "舘島 虎徹",
        "片瀬真宵": "片瀬 真宵",
        "千石冠": "千石 冠",
        "折部やすな": "折部 やすな",
        "陽夏木ミカン": "陽夏木 ミカン",
        "緑へも": "緑 へも",
        "巽紺": "巽 紺",
        "恵飛須沢胡桃": "恵飛須沢 胡桃",
        "百地たまて": "百地 たまて",
        "涼風青葉": "涼風 青葉",
        "花小泉杏": "花小泉 杏",
        "有馬ひづめ": "有馬 ひづめ",
        "千代田桃": "千代田 桃",
        "一之瀬花名": "一之瀬 花名",
        "後藤ひとり": "後藤 ひとり",
        "ぼっち(後藤ひとり)": "後藤 ひとり",
        "布田由美音": "布田 裕美音",
        "池谷のの": "池谷 乃々",
        "恋塚小さゆめ": "恋塚 小夢",
        "篠花真由": "篠華 まゆ",
        "ソニーヤ": "ソーニャ",
        "佐山菫": "狭山 椿",
        "保登ココア": "ココア",
        "天々座理世": "リゼ",
        "教授（大道寺美弥）": "キョージュ",
        "キョージュ(大道寺美弥)": "キョージュ",
        "シャミ子(吉田優子)": "シャミ子",
        "かおす(萌田薫子)": "かおす",
        "不思議の国のアリス・カータレット": "アリス・カータレット",
        "桐間紗路": "桐間 紗路",
    }
    # fix typo above
    ja_speaker_fix["ソニーヤ"] = "ソーニャ"
    spj = ja_speaker_fix.get(spj, spj)
    spj = WIKI_SPEAKER.get(sp, spj)
    return f"★{spj}\n{rest}" if rest else f"★{spj}"


def fix_body(text: str) -> str:
    out = text
    for a, b in WIKI_BODY_FIX:
        out = out.replace(a, b)
    return apply_ja_cleanup(out)


def main() -> None:
    hints_path = ROOT / "data/ja/puzzle-hints.json"
    hints = {norm(k): v for k, v in json.loads(hints_path.read_text(encoding="utf-8")).items()}
    out_map = {}
    for k, v in hints.items():
        v2 = fix_speaker_line(norm(v))
        v2 = fix_body(v2)
        out_map[k] = v2
    hints_path.write_text(json.dumps(out_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    puzzles = json.loads((ROOT / "data/puzzles.json").read_text(encoding="utf-8"))
    rebuilt = []
    for p in puzzles:
        q = dict(p)
        q["category"] = PUZZLE_CAT[p["category"]]
        q["title"] = PUZZLE_TITLE[p["title"]]

        def repl(m: re.Match, _map=out_map) -> str:
            body = norm(m.group(1))
            return f"Debug.ShowHint[[{_map.get(body, body)}]]"

        q["source"] = HINT_RE.sub(repl, norm(p["source"]))
        rebuilt.append(q)
    (ROOT / "data/ja/puzzles.json").write_text(
        json.dumps(rebuilt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # sample speakers
    speakers = sorted(
        {
            h[1:].split("\n", 1)[0]
            for h in out_map.values()
            if h.startswith("★")
        }
    )
    print("speakers", len(speakers))
    for s in speakers:
        print(" ", s)
    print("done")


if __name__ == "__main__":
    main()
