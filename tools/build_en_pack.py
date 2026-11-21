"""Build data/en/{cards,engine}.json from KO source via DeepL + wiki proper nouns.

MT backend: DeepL API (env DEEPL_AUTH_KEY or DEEPL_API_KEY).
Does not rewrite system strings (YGO/Ignis EN already present).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "en"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ja_pack import (  # noqa: E402
    _deepl_translator,
    _load_dotenv,
)

# EN display names — wiki.kirafan.moe NamedList readings / common EN titles
NAME_EN: dict[int, str] = {
    10050011: "Sugar",
    10050111: "Kirara (Summoner)",
    10050112: "Lamp (Summoner)",
    10050113: "Claire (Summoner)",
    10050114: "Archive (Summoner)",
    10050115: "Media (Summoner)",
    10050116: "Sumeragi Utsutsu (Summoner)",
    10050117: "Highpris (Summoner)",
    10051111: "Nonohara Yuzuko",
    10051121: "Morino Kirin",
    10051122: "Hosono Harumi",
    10051131: "Takimoto Hifumi",
    10051132: "Shima Rin",
    10051133: "Hirasawa Yui",
    10051211: "Kyouzuka Shion",
    10051221: "Shinoda Hajime",
    10051222: "Kagamihara Nadeshiko",
    10051231: "Hinata Kaho",
    10051311: "Sengoku Kamuri",
    10051321: "Miniwa Tsumiki",
    10051322: "Fa",
    10051331: "Sonya",
    10051332: "Kyouju (Daidou Miyabi)",
    10051411: "Karasuma Sakura",
    10051421: "Ushiku Kana",
    10051431: "Cocoa",
    10051511: "Sae",
    10051521: "Oomiya Shinobu",
    10051531: "Miyako",
    10051621: "Chiyoda Momo",
    10051622: "Matsubara Honoka",
    10051631: "Kujo Karen",
    10051632: "Merry Nightmare",
    10052121: "Kazairo Kotone",
    10052131: "Hatoya Kohane",
    10052221: "Murakami Shiina",
    10052222: "Tatejima Kotetsu",
    10052231: "Hoshikawa Mafuyu",
    10052232: "Hibarigaoka Ruri",
    10052321: "Katase Mayoi",
    10052322: "Koizuka Koyume",
    10052331: "Honda Tamaki",
    10052421: "Tatsumi Kon",
    10052422: "Nishikawa Youko",
    10052423: "Takeda Yomi",
    10052431: "Suzukaze Aoba",
    10052432: "Sonoda Yuu",
    10052433: "Nakano Azusa",
    10052521: "Midori Hemo",
    10052531: "Kirima Sharo",
    10052621: "Hinatsuki Mikan",
    10052631: "Chino",
    10053111: "Momoki Run",
    10053121: "Tooi Narumi",
    10053131: "Chiya",
    10053211: "Minagi Hiyori",
    10053221: "Shinoha Mayu",
    10053231: "Rize",
    10053311: "Amamiya Mayu",
    10053321: "Iijima Yun",
    10053331: "Oribe Yasuna",
    10053332: "Unlucky Person?",
    10053411: "Iketani Nono",
    10053421: "Ichii Yui",
    10053431: "Naoki Miki",
    10053511: "Leine",
    10053521: "Aikawa Chiho",
    10053531: "Sonobe Shino",
    10053611: "Sakura Ino",
    10053621: "Gotoh Hitori",
    10053631: "Ebisuzawa Kurumi",
    10054111: "Souenji Miku",
    10054121: "Noda Miki",
    10054122: "Uchiki Yuki",
    10054211: "Takeya Yuki",
    10054212: "Minagi Koharu",
    10054221: "Akiyama Mio",
    10054222: "Ichinose Hana",
    10054311: "Konohata Mira",
    10054312: "Wakasa Yuuri",
    10054321: "Kaosu (Moeta Kaoruko)",
    10054411: "Natsume Nono",
    10054412: "Odagiri Futaba",
    10054421: "Chiya",
    10054512: "Natsu Megumi",
    10054521: "Yuno",
    10054522: "Satonaka Chie",
    10054523: "Hiro",
    10054524: "Sekiya Naru",
    10054611: "Manaka Ao",
    10054621: "Fuda Yumine",
    10054622: "Shamiko (Yoshida Yuuko)",
    10055111: "Machiko Ryou",
    10055112: "Darkness Alice Cartelet",
    10055113: "Wonderland Alice Cartelet",
    10055114: "Enami Kiyose",
    10055211: "Takayama Haruka",
    10055212: "Yoshida Ryouko",
    10055213: "Onosaka Koharu",
    10055221: "Sakuranomiya Ichika",
    10055222: "Yamaguchi Kisaragi",
    10055311: "Irokawa Ruki",
    10055312: "Tennouji Nagisa",
    10055411: "Hayama Teru",
    10055421: "Nijou Omi",
    10055511: "Mother (Matsumoto Yoriko)",
    10055512: "Momochi Tamate",
    10055513: "Hana N. Fountainstand",
    10055611: "Sayama Tsubaki",
    10055612: "Hanakoizumi An",
    10055621: "Arima Hizume",
    10055622: "Kuro",
}

SERIES_EN = {
    "키라라 판타지아": "Kirara Fantasia",
    "유유시키": "Yuyushiki",
    "행복 그래피티": "Happiness Graffiti",
    "NEW GAME!": "NEW GAME!",
    "유루캠△": "Laid-Back Camp",
    "케이온!": "K-ON!",
    "슬로우 스타트": "Slow Start",
    "블렌드S": "Blend S",
    "여기저기": "Here and There",
    "RPG부동산": "RPG Real Estate",
    "킬미 베이비": "Kill Me Baby",
    "GA 예술과 아트 디자인 클래스": "GA: Geijutsuka Art Design Class",
    "금빛 모자이크": "Kin-iro Mosaic",
    "아니마 옐!": "Anima Yell!",
    "주문은 토끼입니까?": "Is the Order a Rabbit?",
    "히다마리 스케치": "Hidamari Sketch",
    "길모퉁이 마족": "The Demon Girl Next Door",
    "꿈을 먹는 메리": "Yume Kui Merry",
    "스텔라의 마법": "Stella no Mahou",
    "언해피♪": "Unhappy!",
    "코믹 걸즈": "Comic Girls",
    "우라라 미로첩": "Urara Meirochou",
    "삼자삼엽": "Sanjya San'you",
    "타마요미": "Tamayomi",
    "사쿠라 Trick": "Sakura Trick",
    "뒤떨어진 후르츠타르트": "The Fruit of Gravitas",
    "A채널": "A Channel",
    "하루카나 리시브": "Harukana Receive",
    "슬로우 루프": "Slow Loop",
    "파워 오브 스마일": "Power of Smile",
    "학교생활!": "Gakkou Gurashi!",
    "봇치 더 락!": "Bocchi the Rock!",
    "사랑하는 소행성": "Asteroid in Love",
    "하나야마타": "Hanayamata",
    "망가타임": "Manga Time",
    "코하루비요리": "Koharubiyori",
    "관지기 쿠로 ~마음속 여행자 이야기~": "Kuromukuro",
}

# Pre-map KO game terms so DeepL keeps TCG/Kirafan wording
TERM_KO_EN = [
    ("크리에메이트", "Creamate"),
    ("돗테오키 게이지", "Totteoki Gauge"),
    ("돗테오키 존", "Totteoki Zone"),
    ("돗테오키", "Totteoki"),
    ("배틀 존", "Battle Zone"),
    ("서포트 존", "Support Zone"),
    ("성전", "Sanctuary"),
    ("마을", "Village"),
    ("성채석", "Starlight Stone"),
    ("배틀 페이즈", "Battle Phase"),
    ("메인 페이즈", "Main Phase"),
    ("스탠바이 페이즈", "Standby Phase"),
    ("드로우 페이즈", "Draw Phase"),
    ("엔드 페이즈", "End Phase"),
    ("진실의 손", "True Hand"),
    ("통상 공격", "normal attack"),
    ("통상공격", "normal attack"),
    ("소환사", "Summoner"),
    ("공격력", "ATK"),
    ("체력", "HP"),
    ("경직", "Stiff"),
    ("딜레이", "Delay"),
    ("회복", "Heal"),
    ("나약함", "Weakness"),
    ("배고픔", "Hunger"),
    ("속박", "Bind"),
    ("수면", "Sleep"),
    ("불행", "Misfortune"),
    ("고립", "Isolation"),
    ("침묵", "Silence"),
    ("혼란", "Confusion"),
    ("적 단일", "a single enemy"),
    ("적 전체", "all enemies"),
    ("아군 단일", "a single ally"),
    ("아군 전체", "all allies"),
    ("아군단일", "a single ally"),
    ("아군전체", "all allies"),
    ("[패시브]", "[Passive]"),
    ("[스킬]", "[Skill]"),
    ("선택 효과", "Choose 1"),
    ("추가 경직", "extra Stiff"),
    ("불 속성", "Fire element"),
    ("물 속성", "Water element"),
    ("땅 속성", "Earth element"),
    ("바람 속성", "Wind element"),
    ("해 속성", "Sun element"),
    ("달 속성", "Moon element"),
    ("전사", "Fighter"),
    ("마법사", "Magician"),
    ("나이트", "Knight"),
    ("승려", "Priest"),
    ("알케미스트", "Alchemist"),
    ("상태이상", "abnormal status"),
    ("드로우", "draw"),
    ("[등장]", "[When Summoned]"),
]

# Wrong / non-wiki EN forms → wiki-aligned forms (longer first)
PROPER_EN_FIX = [
    ("Main Character", "Summoner"),
    ("Castle Stones", "Starlight Stones"),
    ("Castle Stone", "Starlight Stone"),
    ("When Sent to the Totteoki Zone", "When sent to the Totteoki Zone"),
    ("[Appearance: Add 1 Stiff card]", "[When Summoned, extra Stiff 1]"),
    ("[Appearance: Add 1 Stiff]", "[When Summoned, extra Stiff 1]"),
    ("[Upon Summon, adds 1 Stiff card]", "[When Summoned, extra Stiff 1]"),
    ("[When Summoned, add 1 Stiff card]", "[When Summoned, extra Stiff 1]"),
    ("[Appears]", "[When Summoned]"),
    ("[Appearance]", "[When Summoned]"),
    ("[Activation]", "[When Summoned]"),
    ("[Activate]", "[When Summoned]"),
    ("additional Stiffs", "extra Stiff"),
    ("additional Stiff", "extra Stiff"),
    ("Additional Stiff", "extra Stiff"),
    ("Extra Stiff", "extra Stiff"),
    ("Special Gauge", "Totteoki Gauge"),
    ("status ailments", "abnormal status"),
    ("status ailment", "abnormal status"),
    ("Alice Carteret of darkness", "Darkness Alice Cartelet"),
    ("Alice Carteret from Wonderland", "Wonderland Alice Cartelet"),
    ("Alice Carterlet of Wonderland", "Wonderland Alice Cartelet"),
    ("Darkness Alice Carterlet", "Darkness Alice Cartelet"),
    ("Wonderland Alice Carterlet", "Wonderland Alice Cartelet"),
    ("Alice Carteret", "Alice Cartelet"),
    ("Alice Carterlet", "Alice Cartelet"),
    ("Carterlet", "Cartelet"),
    ("Carteret", "Cartelet"),
    ("Clea(", "Claire("),
    ("Clea ", "Claire "),
    ("Kirima Syaro", "Kirima Sharo"),
    ("Shinohana Mayu", "Shinoha Mayu"),
    ("Tedeza Rize", "Rize"),
    ("Kafu Chino", "Kafuu Chino"),
    ("Kujou Karen", "Kujo Karen"),
    ("Yoshida Yuuko", "Yoshida Yuuko"),
    ("Alchev", "Archive"),
    ("Arsiv", "Archive"),
]

_SRC_LANG = {"en": "EN", "ko": "KO", "ja": "JA", "auto": None}


def apply_terms(text: str, pairs: list[tuple[str, str]]) -> str:
    out = text
    for a, b in pairs:
        if a.startswith("\\") or "[" in a and a.startswith("\\") or "\\b" in a:
            out = re.sub(a, b, out, flags=re.IGNORECASE)
        else:
            out = out.replace(a, b)
    return out


def apply_en_cleanup(text: str) -> str:
    out = apply_terms(text, PROPER_EN_FIX)
    # Avoid doubling: "abnormal abnormal status" if PROPER already fixed some.
    out = re.sub(r"\babnormal\s+abnormal\s+status\b", "abnormal status", out, flags=re.I)
    out = re.sub(
        r"(?<!abnormal )status effects?\b",
        "abnormal status",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\[Totteoki Gauge\s*(\d+)\s*,\s*(?:extra Stiff|additional Stiff(?: card)?)\s*(\d+)(?:\s*cards?)?\]",
        r"[Totteoki Gauge \1, extra Stiff \2]",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\[Totteoki Gauge\s*(\d+)\s*,\s*(\d+)\s+additional Stiff(?:\s*cards?)?\]",
        r"[Totteoki Gauge \1, extra Stiff \2]",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\[(?:Upon Summon|When Summoned|Appearance)[^\]]*Stiff[^\]]*\]",
        lambda m: re.sub(
            r".*?(\d+).*",
            r"[When Summoned, extra Stiff \1]",
            m.group(0),
        )
        if re.search(r"\d+", m.group(0))
        else "[When Summoned]",
        out,
        flags=re.I,
    )
    out = re.sub(r"\[Appearance\]", "[When Summoned]", out, flags=re.I)
    out = re.sub(r"\[Appears\]", "[When Summoned]", out, flags=re.I)
    out = re.sub(r"\[Activ(?:ation|ate)\]", "[When Summoned]", out, flags=re.I)
    # draw+N → Draw N card(s)
    def _draw_cards(n: str) -> str:
        k = int(n)
        return f"Draw {k} card" if k == 1 else f"Draw {k} cards"

    out = re.sub(
        r"\bdraws\s*\+\s*(\d+)\s*cards?\b",
        lambda m: f"draws {m.group(1)} card" if int(m.group(1)) == 1 else f"draws {m.group(1)} cards",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\bdraws\s*\+\s*(\d+)\b",
        lambda m: f"draws {m.group(1)} card" if int(m.group(1)) == 1 else f"draws {m.group(1)} cards",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\bdraw\s*\+\s*(\d+)\s*cards?\b",
        lambda m: _draw_cards(m.group(1)),
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\bdraw\s*\+\s*(\d+)\b",
        lambda m: _draw_cards(m.group(1)),
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\+(\d+)\s*draws\b",
        lambda m: _draw_cards(m.group(1)),
        out,
        flags=re.I,
    )
    out = re.sub(
        r"(?<=[a-zA-Z,;:])\s+Draw (\d+) cards?\b",
        lambda m: (
            f" draw {m.group(1)} card"
            if int(m.group(1)) == 1
            else f" draw {m.group(1)} cards"
        ),
        out,
    )
    # Totteoki Gauge +N / -N → Increase/Decrease … by N (not [Totteoki Gauge N] costs)
    def _gauge_inc(n: str, lower: bool = False) -> str:
        s = f"Increase the Totteoki Gauge by {int(n)}"
        return s[0].lower() + s[1:] if lower else s

    def _gauge_dec(n: str, lower: bool = False, opponent: bool = False) -> str:
        who = "the opponent's Totteoki Gauge" if opponent else "the Totteoki Gauge"
        s = f"Decrease {who} by {int(n)}"
        return s[0].lower() + s[1:] if lower else s

    out = re.sub(
        r"\b[Rr]educe (?:the |your )?opponent['’]?s Totteoki Gauge by\s*(\d+)\b",
        lambda m: _gauge_dec(m.group(1), opponent=True),
        out,
    )
    out = re.sub(
        r"\b[Oo]pponent['’]?s Totteoki Gauge\s*[-−–]\s*(\d+)\b",
        lambda m: _gauge_dec(m.group(1), opponent=True),
        out,
    )
    out = re.sub(
        r"\b[Oo]pponent['’]?s Totteoki Gauge\s*:\s*(\d+)\b",
        lambda m: _gauge_dec(m.group(1), opponent=True),
        out,
    )
    out = re.sub(
        r"\bTotteoki Gauge\s*\+\s*(\d+)\b",
        lambda m: _gauge_inc(m.group(1)),
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\bTotteoki Gauge\s*[-−–]\s*(\d+)\b",
        lambda m: _gauge_dec(m.group(1)),
        out,
        flags=re.I,
    )
    # Only mid-clause after lowercase / comma (keep capital after : / newline / ])
    out = re.sub(
        r"(?<=[a-z,;])\s+Increase the Totteoki Gauge by (\d+)\b",
        lambda m: f" {_gauge_inc(m.group(1), lower=True)}",
        out,
    )
    out = re.sub(
        r"(?<=[a-z,;])\s+Decrease the opponent's Totteoki Gauge by (\d+)\b",
        lambda m: f" {_gauge_dec(m.group(1), lower=True, opponent=True)}",
        out,
    )
    out = re.sub(
        r"(?<=[a-z,;])\s+Decrease the Totteoki Gauge by (\d+)\b",
        lambda m: f" {_gauge_dec(m.group(1), lower=True)}",
        out,
    )
    # Heal(s) … by N → Heal N to …
    out = re.sub(
        r"\b[Hh]eals?\s+all\s+allies\s+by\s+(\d+)\b",
        lambda m: f"Heal {m.group(1)} to all allies",
        out,
    )
    out = re.sub(
        r"\b[Hh]eals?\s+a\s+single\s+ally\s+by\s+(\d+)\b",
        lambda m: f"Heal {m.group(1)} to a single ally",
        out,
    )
    out = re.sub(
        r"\b[Hh]eals?\s+(a\s+single\s+Creamate(?:\s*\([^)]*\))?)\s+by\s+(\d+)\b",
        lambda m: f"Heal {m.group(2)} to {m.group(1)}",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\b[Hh]eals?\s+self\s+by\s+(\d+)\b",
        lambda m: f"Heal {m.group(1)} to self",
        out,
    )
    out = re.sub(
        r"\[등장\s*,\s*추가\s*경직\s*(\d+)\s*장?\]",
        r"[When Summoned, extra Stiff \1]",
        out,
    )
    out = re.sub(r"\[Totteoki Gauge\s*(\d+)\]", r"[Totteoki Gauge \1]", out, flags=re.I)
    out = re.sub(r"\[Passive(?: skill)?\]", "[Passive]", out, flags=re.I)
    out = out.replace("When Sent to the Totteoki Zone", "When sent to the Totteoki Zone")
    return out


def translate_batch(texts: list[str], src: str = "ko", target: str = "EN-US") -> list[str]:
    tr = _deepl_translator()
    source_lang = _SRC_LANG.get(src.lower(), src.upper() if src else None)
    out: list[str | None] = [None] * len(texts)
    pending_idx: list[int] = []
    pending_txt: list[str] = []

    def flush() -> None:
        nonlocal pending_idx, pending_txt
        if not pending_txt:
            return
        try:
            kwargs = {"target_lang": target, "preserve_formatting": True}
            if source_lang:
                kwargs["source_lang"] = source_lang
            results = tr.translate_text(pending_txt, **kwargs)
            if not isinstance(results, list):
                results = [results]
            for i, res in zip(pending_idx, results):
                out[i] = res.text
        except Exception as e:
            print(f"  DeepL batch fail ({len(pending_txt)} texts): {e}")
            for i, text in zip(pending_idx, pending_txt):
                try:
                    time.sleep(0.05)
                    kwargs = {"target_lang": target, "preserve_formatting": True}
                    if source_lang:
                        kwargs["source_lang"] = source_lang
                    out[i] = tr.translate_text(text, **kwargs).text
                except Exception as e2:
                    print(f"  DeepL fail [{i}]: {e2}")
                    out[i] = text
        pending_idx = []
        pending_txt = []

    batch_chars = 0
    for i, t in enumerate(texts):
        if not t or not t.strip():
            out[i] = t
            continue
        if pending_txt and (len(pending_txt) >= 40 or batch_chars + len(t) > 80000):
            flush()
            batch_chars = 0
            print(f"  translated {sum(1 for x in out if x is not None)}/{len(texts)}")
        pending_idx.append(i)
        pending_txt.append(t)
        batch_chars += len(t)

    flush()
    print(f"  DeepL done {sum(1 for x in out if x is not None)}/{len(texts)}")
    return [x if x is not None else texts[i] for i, x in enumerate(out)]


def build_cards() -> None:
    ko = json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))
    missing = [c["id"] for c in ko["cards"] if c["id"] not in NAME_EN]
    if missing:
        raise SystemExit(f"Missing EN names for: {missing}")

    prepared: list[str] = []
    for c in ko["cards"]:
        prepared.append(apply_terms(c.get("desc") or "", TERM_KO_EN))

    print(f"Translating {len(prepared)} card texts KO→EN…")
    descs = translate_batch(prepared, "ko")

    cards = []
    for c, desc_raw in zip(ko["cards"], descs):
        desc = apply_en_cleanup(desc_raw or "")
        # quoted card-name references inside effects
        for kid, en_name in NAME_EN.items():
            # replace KO name mentions that may survive
            pass
        card = dict(c)
        card["name"] = NAME_EN[c["id"]]
        card["desc"] = desc
        card["series"] = SERIES_EN.get(c.get("series", ""), c.get("series", ""))
        cards.append(card)

    # Cross-replace KO card names that appear in quotes with EN names
    ko_name_by_id = {c["id"]: c["name"] for c in ko["cards"]}
    for card in cards:
        d = card["desc"]
        for kid, kn in ko_name_by_id.items():
            en = NAME_EN[kid]
            if kn and kn in d:
                d = d.replace(f'"{kn}"', f'"{en}"').replace(f"'{kn}'", f"'{en}'")
                d = d.replace(f"「{kn}」", f'"{en}"')
        card["desc"] = apply_en_cleanup(d)

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"maxCopies": ko.get("maxCopies", 3), "mainSize": ko.get("mainSize", 60), "cards": cards}
    (OUT / "cards.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT / 'cards.json'} ({len(cards)} cards)")


def build_engine() -> None:
    ko = json.loads((ROOT / "data/engine.json").read_text(encoding="utf-8"))
    prev = {}
    prev_path = OUT / "engine.json"
    if prev_path.is_file():
        prev = json.loads(prev_path.read_text(encoding="utf-8"))

    cards_out: dict[str, dict] = {}
    jobs: list[tuple[str, int]] = []
    texts: list[str] = []

    for cid, info in (ko.get("cards") or {}).items():
        # Keep atk/def/level/type/race/attribute/setcode from KO; only localize name/strings.
        entry = dict(info)
        entry["strings"] = list(info.get("strings") or [])
        try:
            iid = int(cid)
        except ValueError:
            iid = None
        if iid in NAME_EN:
            entry["name"] = NAME_EN[iid]
        else:
            # translate leftover names
            if (entry.get("name") or "").strip():
                jobs.append((cid, -1))
                texts.append(apply_terms(entry["name"], TERM_KO_EN))
        for i, s in enumerate(entry["strings"]):
            if s and s.strip():
                jobs.append((cid, i))
                texts.append(apply_terms(s, TERM_KO_EN))
        cards_out[cid] = entry

    print(f"Translating {len(texts)} engine card strings KO→EN…")
    translated = translate_batch(texts, "ko") if texts else []
    ti = 0
    for cid, idx in jobs:
        val = apply_en_cleanup(translated[ti])
        ti += 1
        if idx < 0:
            cards_out[cid]["name"] = val
        else:
            cards_out[cid]["strings"][idx] = val

    # Keep prior EN-only token cards (HP stones etc.) if still referenced
    for cid, info in (prev.get("cards") or {}).items():
        if cid not in cards_out:
            cards_out[cid] = info

    out = {
        "cards": cards_out,
        "system": prev.get("system") or ko.get("system") or {},
    }
    # Prefer existing EN system (already localized); fall back to KO only if missing
    if prev.get("system"):
        out["system"] = prev["system"]

    (OUT / "engine.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT / 'engine.json'} ({len(cards_out)} cards)")


def main() -> None:
    _load_dotenv()
    OUT.mkdir(parents=True, exist_ok=True)
    build_cards()
    build_engine()
    print("EN pack done.")


if __name__ == "__main__":
    main()
