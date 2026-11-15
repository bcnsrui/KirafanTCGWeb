"""EDOPro's side of the rules comparison (js/engine/rulesdiff.js has the web engine's): random duels on the real
engine (ocgcore.dll), with what could be done and what happened, for the page to compare with its own.

    KirafanAI\\py32\\python.exe KirafanWeb\\tools\\rules_diff.py [--games 300] [--seed 1]

Both sides play the AI decks of data/ai_decks.json with the same random player (a meaningful option at random,
card choices one pick at a time) and count, per game:
  - opt: each option of a decision with more than one, by (kind, card code, location, effect description) and
    situation (phase, own turn or not, chain open or not)
  - cards: card choices by their hint, and the cards they offered
  - chain: activations (MSG_CHAINING) by (card code, location it was activated from, description)
  - summon / destroy / counters, the game's length and how it ended
-> data/ai/test/rules_edopro.json
"""
import argparse
import collections
import json
import os
import random
import struct
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(GAME, "KirafanAI"))

from kirafan_ai.cards import get_db  # noqa: E402
from kirafan_ai.core.constants import *  # noqa: E402,F401,F403
from kirafan_ai.core.messages import K_CARD_PICK, K_CARD_FINISH, K_CARD_CANCEL  # noqa: E402
from kirafan_ai.sim.decks import Deck  # noqa: E402
from kirafan_ai.sim.duel import Duel  # noqa: E402

OUT = os.path.join(WEB, "data", "ai", "test", "rules_edopro.json")
PHASE_NAMES = {0x1: "draw", 0x2: "standby", 0x4: "main", 0x8: "battle", 0x100: "main2", 0x200: "end"}
KIND_GROUP = {1: "summon", 5: "activate", 9: "activate", 21: "activate", 6: "to_bp", 7: "to_ep", 10: "attack",
              11: "to_m2", 12: "battle_to_ep", 13: "effectyn", 14: "effectyn_no", 15: "yes", 16: "no", 22: "pass",
              23: "number", 17: "option"}
LOC_NAMES = {0x1: "deck", 0x2: "hand", 0x4: "mzone", 0x8: "szone", 0x10: "grave", 0x20: "removed", 0x40: "extra"}


def situation(duel, player):
    return "%s/%s/%s" % (PHASE_NAMES.get(duel.phase, hex(duel.phase)), "own" if duel.turn_player == player else "opp",
                         "chain" if duel.chain_targets else "open")


def deck_pair(pool, g):
    """the decks of game g (the same in js/engine/rulesdiff.js): every pair in turn"""
    n = len(pool)
    return pool[g % n], pool[(g // n + g) % n]


def option_key(o, forced=False):
    group = "order" if forced else KIND_GROUP.get(o.kind, str(o.kind))
    if o.card:
        code, con, loc, seq = o.card
        place = "emz" if loc == LOCATION_MZONE and seq >= 5 else LOC_NAMES.get(loc & 0x7f, hex(loc))
        return "%s|%d|%s|%d" % (group, code, place, o.desc)
    return "%s|||%d" % (group, o.desc if group in ("yes", "no", "number", "option") else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=300)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    db = get_db()
    with open(os.path.join(WEB, "data", "ai_decks.json"), encoding="utf-8") as f:
        pool = [Deck(d["main"], d["summoner"], d["name"]) for d in json.load(f)["decks"]]
    rng = random.Random(args.seed)
    stats = {k: collections.Counter() for k in ("opt", "cards", "cardsOffered", "chain", "summon", "destroy",
                                                 "counter", "end", "decisionTypes", "byTurn")}
    turns = []
    for g in range(args.games):
        decks = deck_pair(pool, g)
        duel = Duel(db, decks, seed=rng.getrandbits(32), rng=random.Random(rng.getrandbits(32)))
        duel.keep_messages = True
        d = duel.advance()
        while d is not None:
            sit = situation(duel, d.player)
            stats["decisionTypes"]["%d|%s" % (d.msg, sit)] += 1
            if d.selection is not None:
                if not d.selection.picked:
                    stats["cards"]["%d|%s" % (d.hint, sit)] += 1
                    for c in d.cards:
                        stats["cardsOffered"]["%d|%d|%s" % (d.hint, c[0], LOC_NAMES.get(c[2] & 0x7f, hex(c[2])))] += 1
            else:
                # (a chain question without "pass": the order of effects that happen at once, no choice in the web)
                forced = d.msg == MSG_SELECT_CHAIN and d.meta.get("forced")
                for o in d.options:
                    stats["opt"]["%s|%s" % (option_key(o, forced), sit)] += 1
            real = [i for i, o in enumerate(d.options) if not o.noop] or list(range(len(d.options)))
            if d.selection is not None:
                picks = [i for i in real if d.options[i].kind == K_CARD_PICK]
                stop = [i for i in real if d.options[i].kind in (K_CARD_FINISH, K_CARD_CANCEL)]
                real = picks if picks and (not stop or rng.random() < 0.6) else (stop or real)
            d = duel.step(rng.choice(real))
        last_hint = 0
        turn = 0
        for raw in duel.message_log:
            m = raw[0]
            if m == MSG_NEW_TURN:
                turn += 1
            elif m == MSG_ATTACK:
                stats["byTurn"]["attack|%d" % turn] += 1
            elif m == MSG_DRAW:
                stats["byTurn"]["draw|%d" % turn] += raw[2]
            elif m == MSG_CHAINING:
                stats["byTurn"]["chain|%d" % turn] += 1
            elif m == MSG_MOVE and raw[6] & LOCATION_OVERLAY and raw[16] == LOCATION_REMOVED:
                stats["byTurn"]["hpLost|%d" % turn] += 1
            elif m == MSG_MOVE and raw[6] == LOCATION_MZONE and raw[16] == LOCATION_EXTRA:
                stats["byTurn"]["destroy|%d" % turn] += 1
            if m == MSG_HINT and raw[1] == 2:   # HINT_MESSAGE: what the scripts tell (a loss's reason among them)
                last_hint = struct.unpack_from("<Q", raw, 3)[0]
            if m == MSG_CHAINING:
                code = struct.unpack_from("<I", raw, 1)[0]
                tloc = raw[16]
                desc = struct.unpack_from("<Q", raw, 21)[0]
                stats["chain"]["%d|%s|%d" % (code, LOC_NAMES.get(tloc, hex(tloc)), desc)] += 1
            elif m == MSG_MOVE:
                code = struct.unpack_from("<I", raw, 1)[0]
                floc, to_loc = raw[6], raw[16]
                to_seq = struct.unpack_from("<I", raw, 17)[0]
                if to_loc == LOCATION_MZONE and to_seq < 5 and floc != LOCATION_MZONE:
                    stats["summon"][str(code)] += 1
                if floc == LOCATION_MZONE and to_loc == LOCATION_EXTRA:
                    stats["destroy"][str(code)] += 1
            elif m == MSG_ADD_COUNTER:
                ctype = struct.unpack_from("<H", raw, 1)[0]
                stats["counter"][hex(ctype)] += 1
        stats["end"]["%d|%s" % (last_hint, "early" if duel.turn <= 2 else "mid" if duel.turn <= 12 else "late")] += 1
        turns.append(duel.turn)
        duel.close()
        if (g + 1) % 50 == 0:
            print("%d판" % (g + 1))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"games": args.games, "turns": turns, **{k: dict(v) for k, v in stats.items()}}, f, ensure_ascii=False)
    print("EDOPro %d판: 평균 %.1f턴" % (args.games, sum(turns) / len(turns)))


if __name__ == "__main__":
    main()
