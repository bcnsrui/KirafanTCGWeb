"""Build the web version's card data and images from the game folder.

    KirafanAI\\.venv\\Scripts\\python.exe KirafanWeb\\tools\\build_data.py
    KirafanAI\\.venv\\Scripts\\python.exe KirafanWeb\\tools\\build_data.py --lang en

- data/cards.json (or data/en/…): the cards a deck may hold
- data/ai_decks.json: the level bots' decks (Korean titles; shared)
- data/engine.json (or data/en/…): every card + system strings for the rules engine
- data/scripts.json, puzzles, sound, pics: language-independent (full build only)
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(GAME, "KirafanAI"))

from kirafan_ai import paths  # noqa: E402
from kirafan_ai.bridge.register import LEVEL_BOTS  # noqa: E402
from kirafan_ai.cards import CARD_ALIASES, CardDB, get_db  # noqa: E402
from kirafan_ai.core.constants import SUMMONER_CODES  # noqa: E402

MAX_COPIES = 3
MAIN_SIZE = 60

LANG_PATHS = {
    "ko": {
        "cdb": os.path.join(GAME, "expansions", "kirafan.cdb"),
        "strings": os.path.join(GAME, "expansions", "strings.conf"),
        "out": os.path.join(WEB, "data"),
    },
    "en": {
        "cdb": os.path.join(GAME, "expansions", "kirafan(EN).cdb"),
        "strings": os.path.join(GAME, "expansions", "strings_en.conf"),
        "out": os.path.join(WEB, "data", "en"),
    },
}


def strings(path):
    """!system and !setname (a later line wins)."""
    system, sets = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"!system (\d+) (.*)", line.rstrip("\n"))
            if m:
                system[int(m.group(1))] = m.group(2).strip()
            m = re.match(r"!setname 0x([0-9a-fA-F]+) (.*)", line.rstrip("\n"))
            if m:
                sets[int(m.group(1), 16)] = m.group(2).strip()
    return system, sets


def bit_names(value, base, system):
    return [system[base + i] for i in range(32) if value >> i & 1 and system.get(base + i)]


def read_ydk(path):
    main, extra, section = [], [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line in ("#main", "#extra", "!side"):
                section = line
            elif line.isdigit():
                (main if section == "#main" else extra if section == "#extra" else []).append(int(line))
    return main, extra


def ai_decks(db, cards):
    """The level decks of the newest model, strongest level first, named "AI 4단계 · 01 카무리 · 달+바람"."""
    deck_root = os.path.join(GAME, "WindBot", "Decks")
    models = [int(m.group(1)) for d in os.listdir(deck_root) for m in [re.match(r"KirafanAI_(\d+)_L\d$", d)] if m]
    if not models:
        return None, []
    model = max(models)
    by_id = {c["id"]: c for c in cards}
    out = []
    for level, _ in sorted(LEVEL_BOTS, reverse=True):
        folder = os.path.join(deck_root, "KirafanAI_%d_L%d" % (model, level))
        for i, name in enumerate(sorted(f for f in os.listdir(folder) if f.endswith(".ydk")), 1):
            main, extra = read_ydk(os.path.join(folder, name))
            summoner = next((c for c in extra if c in SUMMONER_CODES), None)
            title = "AI %d단계 · %02d" % (level, i)
            if summoner:
                title += " " + (
                    db.name(summoner)
                    .replace("(소환사 카드)", "")
                    .replace("(Main Character)", "")
                    .strip()
                )
            attrs = sorted({by_id[c]["attribute"] for c in main if c in by_id and by_id[c]["battle"]})
            if len(attrs) <= 2:
                title += " · " + "+".join(attrs)
            out.append({"name": title, "level": level, "summoner": summoner, "main": main})
    return model, out


def engine_data(system, cdb_path):
    """data/engine.json for the web rules engine (js/engine): every card of the card database as EDOPro reads
    it (type / race / attribute bits, setcodes, the effect strings aux.Stringid points at) and the system
    strings (the hints the rules show)."""
    con = sqlite3.connect(cdb_path)
    rows = con.execute("select d.id, d.type, d.atk, d.def, d.level, d.race, d.attribute, d.setcode, t.name, "
                       + ", ".join("t.str%d" % i for i in range(1, 17))
                       + " from datas d join texts t on t.id = d.id")
    cards = {}
    for r in rows:
        strs = [s or "" for s in r[9:]]
        while strs and not strs[-1]:
            strs.pop()
        cards[r[0]] = {"type": r[1], "atk": r[2], "def": r[3], "level": r[4] & 0xff, "race": r[5],
                       "attribute": r[6], "setcode": r[7], "name": r[8], "strings": strs}
    con.close()
    return {"cards": cards, "system": system}


AUDIO = (".mp3", ".wav", ".ogg")


def sounds():
    """sound/ BGM + creamate voices copied to the page; data/sounds.json lists them.
    Root-level EDOPro SFX (attack.wav, summon.wav, …) are skipped — web uses voices only.
    Folder sound/destroy/ → defeat; sound/Alchemist/ → alchemist."""
    src = os.path.join(GAME, "sound")
    dst = os.path.join(WEB, "sound")
    out = {"bgm": {}, "voice": {}, "effects": []}
    copied = 0
    voice_kinds = (
        "summon", "activate", "attack", "totteoki", "recovery", "damage",
        "defeat", "destroy", "Alchemist", "alchemist",
    )
    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        for name in files:
            if not name.lower().endswith(AUDIO):
                continue
            parts = rel.replace("\\", "/").split("/")
            # Skip EDOPro default SFX sitting in sound/ root
            if rel == ".":
                continue
            to = os.path.join(dst, rel, name)
            path = os.path.join(root, name)
            if not os.path.exists(to) or os.path.getmtime(to) < os.path.getmtime(path):
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.copy2(path, to)
                copied += 1
            if parts[0] == "BGM" and len(parts) > 1:
                out["bgm"].setdefault(parts[1], []).append(name)
            elif parts[0] in voice_kinds:
                code = os.path.splitext(name)[0]
                if code.isdigit():
                    folder = parts[0]
                    if folder == "destroy":
                        kind = "defeat"
                    elif folder.lower() == "alchemist":
                        kind = "alchemist"
                    else:
                        kind = folder
                    out["voice"].setdefault(kind, []).append(int(code))
    for v in out["bgm"].values():
        v.sort()
    for v in out["voice"].values():
        v.sort()
    return out, copied


def engine_scripts():
    """data/scripts.json: {file name: source} of the Lua the rules engine runs, the card scripts as EDOPro loads
    them (expansions/script) and EDOPro's constants (script/constant.lua)."""
    out = {"constant.lua": open(os.path.join(GAME, "script", "constant.lua"), encoding="utf-8").read()}
    folder = os.path.join(GAME, "expansions", "script")
    for name in sorted(os.listdir(folder)):
        if name.endswith(".lua"):
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                out[name] = f.read()
    return out


def engine_puzzles():
    """data/puzzles.json: EDOPro's puzzles (the game's puzzles folder: "1.튜토리얼/2.소환.lua" ...), in their
    folders' and files' order - [{ id, category, title, source }]"""
    root = os.path.join(GAME, "puzzles")
    number = lambda name: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", name)]
    out = []
    for folder in sorted(os.listdir(root), key=number):
        path = os.path.join(root, folder)
        if not os.path.isdir(path):
            continue
        category = re.sub(r"^\d+\.", "", folder)
        for name in sorted((n for n in os.listdir(path) if n.endswith(".lua")), key=number):
            with open(os.path.join(path, name), encoding="utf-8") as f:
                source = f.read()
            stem = name[:-4]
            label, _, title = stem.partition(".")
            out.append({"id": len(out), "category": category, "number": label if title else "",
                        "title": title or stem, "source": source})
    return out


def build_card_lists(db, system, sets, cdb_path, bit_system=None):
    """bit_system: strings for attribute/class/type keys (keep Korean so deck filters/sort stay stable)."""
    bits = bit_system or system
    con = sqlite3.connect(cdb_path)
    rows = {r[0]: r for r in con.execute("select id, type, atk, def, level, race, attribute, setcode from datas")}
    con.close()
    tokens = sorted(c for c, r in rows.items() if r[1] & 0x4000 and c in db.cards)
    codes = [c for c in SUMMONER_CODES if c in db.cards] + db.creamate_pool() + sorted(CARD_ALIASES) + tokens
    cards = []
    for code in codes:
        if code not in rows:
            continue
        _, typ, atk, hp, level, race, attr, setcode = rows[code]
        card = db[code]
        cards.append({
            "id": code,
            "name": card.name,
            "kind": "summoner" if code in SUMMONER_CODES else "token" if code in tokens else "creamate",
            "types": bit_names(typ, 1050, bits),
            "class": "/".join(bit_names(race, 1020, bits)),
            "attribute": "/".join(bit_names(attr, 1010, bits)),
            "level": level & 0xff,
            "atk": atk,
            "hp": hp,
            "series": sets.get(setcode & 0xfff, ""),
            "battle": card.is_battle,
            "desc": card.desc.replace("\r", ""),
            "key": CARD_ALIASES.get(code, code),
        })
    return cards, codes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build KirafanWeb card/engine data")
    parser.add_argument("--lang", choices=sorted(LANG_PATHS), default="ko",
                        help="ko: data/*.json (full assets). en: data/en/cards.json + engine.json only")
    parser.add_argument("--full", action="store_true",
                        help="Also rebuild scripts/puzzles/sounds/pics (ko default does this)")
    args = parser.parse_args(argv)
    lang = args.lang
    cfg = LANG_PATHS[lang]
    cdb_path = cfg["cdb"]
    if not os.path.isfile(cdb_path):
        raise SystemExit(f"missing cdb: {cdb_path}")
    if not os.path.isfile(cfg["strings"]):
        raise SystemExit(f"missing strings: {cfg['strings']}")

    db = CardDB(cdb_path) if lang != "ko" else get_db()
    system, sets = strings(cfg["strings"])
    # Deck filter/sort keys stay Korean even for EN card text
    bit_system = strings(LANG_PATHS["ko"]["strings"])[0] if lang != "ko" else system
    out_dir = cfg["out"]
    os.makedirs(out_dir, exist_ok=True)

    cards, codes = build_card_lists(db, system, sets, cdb_path, bit_system=bit_system)
    with open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8") as f:
        json.dump({"maxCopies": MAX_COPIES, "mainSize": MAIN_SIZE, "cards": cards}, f, ensure_ascii=False)
    print("[%s] cards %d (summoner %d, creamate %d)" % (
        lang, len(cards), sum(c["kind"] == "summoner" for c in cards), sum(c["kind"] == "creamate" for c in cards)))

    engine = engine_data(system, cdb_path)
    with open(os.path.join(out_dir, "engine.json"), "w", encoding="utf-8") as f:
        json.dump(engine, f, ensure_ascii=False)
    print("[%s] engine cards %d" % (lang, len(engine["cards"])))

    # Shared Korean AI decks / scripts / media only on full ko build
    do_full = (lang == "ko") or args.full
    if lang == "ko":
        model, decks = ai_decks(db, cards)
        with open(os.path.join(WEB, "data", "ai_decks.json"), "w", encoding="utf-8") as f:
            json.dump({"model": model, "bots": {lv: name for lv, name in LEVEL_BOTS}, "decks": decks}, f,
                      ensure_ascii=False)
        print("AI decks %d (model %s)" % (len(decks), model))

    if do_full and lang == "ko":
        scripts = engine_scripts()
        with open(os.path.join(WEB, "data", "scripts.json"), "w", encoding="utf-8") as f:
            json.dump(scripts, f, ensure_ascii=False)
        print("scripts %d" % len(scripts))
        puzzles = engine_puzzles()
        with open(os.path.join(WEB, "data", "puzzles.json"), "w", encoding="utf-8") as f:
            json.dump(puzzles, f, ensure_ascii=False)
        print("puzzles %d" % len(puzzles))
        sound, copied = sounds()
        with open(os.path.join(WEB, "data", "sounds.json"), "w", encoding="utf-8") as f:
            json.dump(sound, f, ensure_ascii=False)
        print("sounds: bgm %d, voice %d, sfx %d (copied %d)" % (
            sum(map(len, sound["bgm"].values())), sum(map(len, sound["voice"].values())),
            len(sound["effects"]), copied))
        subprocess.check_call(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                               os.path.join(WEB, "tools", "resize_pics.ps1"),
                               os.path.join(GAME, "expansions", "pics"), os.path.join(WEB, "pics"),
                               ",".join(str(c) for c in codes)])


if __name__ == "__main__":
    main()
