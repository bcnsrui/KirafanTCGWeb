"""EDOPro's games for the lockstep comparison (js/engine/replay.js plays them again on the web engine).

    KirafanAI\\py32\\python.exe KirafanWeb\\tools\\replay_record.py [--games 200] [--seed 1]

Random duels on the real engine (ocgcore.dll) between the random player of tools/rules_diff.py, the AI decks of
data/ai_decks.json (the pairs of rules_diff.deck_pair). Per game, in order:
  - entries: every decision of more than one option - who, the message, its options and what was picked (a card
    choice with all its picks), the very cards picked / the card of the option (cardids: pickIds, chosenId - of
    two copies in the hand, which one), and the state the deciding player saw then (compact, see compact())
  - deckExits: per player, the cards ([code, cardid]) that left the deck (draws, HP cards, the dotte zone ...), so
    the web takes the very same ones whatever its shuffles did (Recording)
  - randomPicks: the HP cards ([code, cardid]) each random choice (Group.RandomSelect: damage, 배고픔) took
-> data/ai/test/replay_edopro.jsonl (one game a line)
"""
import argparse
import json
import os
import random
import struct
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(GAME, "KirafanAI"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kirafan_ai.cards import get_db  # noqa: E402
from kirafan_ai.core.constants import *  # noqa: E402,F401,F403
from kirafan_ai.core.messages import K_CARD_PICK, K_CARD_FINISH, K_CARD_CANCEL  # noqa: E402
from kirafan_ai.sim.decks import Deck  # noqa: E402
from kirafan_ai.sim.duel import Duel  # noqa: E402
from rules_diff import deck_pair  # noqa: E402

OUT = os.path.join(WEB, "data", "ai", "test", "replay_edopro.jsonl")
PLACES = {0x1: "deck", 0x2: "hand", 0x8: "sz", 0x10: "gr", 0x20: "rm", 0x40: "ex"}
NUMERIC_DESC = (13, 14, 15, 16, 17, 23)   # options whose description tells them apart


def place(loc, seq):
    """(both engines put cards in the same free zone: ocgcore's order MZONE_ORDER / SZONE_ORDER)"""
    if loc & LOCATION_OVERLAY:
        return "ov:" + place(loc & 0x7f, seq)
    if loc == LOCATION_MZONE:
        return "emz" if seq >= 5 else "mz%d" % seq
    if loc == LOCATION_SZONE:
        return "sz%d" % seq
    return PLACES.get(loc, hex(loc))


def events(log):
    """what happened between two decisions, short (replay.js prints the web's alike)"""
    out = []
    for raw in log:
        m = raw[0]
        if m == MSG_MOVE:
            out.append("M %d %d:%x->%d:%x" % (struct.unpack_from("<I", raw, 1)[0] & 0x7fffffff, raw[5], raw[6], raw[15], raw[16]))
        elif m == MSG_CHAINING:
            out.append("C %d" % struct.unpack_from("<I", raw, 1)[0])
        elif m == MSG_CHAIN_SOLVED:
            out.append("S")
        elif m == MSG_DRAW:
            n = struct.unpack_from("<I", raw, 2)[0]
            out.append("D%d %s" % (raw[1], ",".join(str(struct.unpack_from("<I", raw, 6 + 8 * k)[0] & 0x7fffffff) for k in range(n))))
        elif m == MSG_NEW_PHASE:
            out.append("P%x" % struct.unpack_from("<H", raw, 1)[0])
        elif m == MSG_NEW_TURN:
            out.append("T")
        elif m == MSG_ATTACK:
            out.append("A")
    return out


def option_key(o):
    """the same in replay.js: kind | card code | controller | place | description"""
    if o.card:
        code, con, loc, seq = o.card
        return "%d|%d|%d|%s|%d" % (o.kind, code, con, place(loc, seq), o.desc)
    return "%d||||%d" % (o.kind, o.desc if o.kind in NUMERIC_DESC else 0)


def card_key(c):
    code, con, loc, seq = c
    return "%d|%d|%s" % (code, con, place(loc, seq))


def compact(view):
    """what the deciding player sees, in a form both engines give alike (replay.js compact): the piles' sizes,
    the field (no zone numbers: both engines may pick other free zones), the extra decks, the graveyards in order
    (돗테오키 존: the oldest go first), its own hand and village"""
    out = {"players": [], "field": [], "extra": [], "grave": [[], []], "hand": [], "removed": []}
    for p in view["players"]:
        out["players"].append([p.get("hand", 0), p.get("deck", 0), p.get("grave", 0), p.get("removed", 0),
                               p.get("extra", 0), p.get("summoner_def", 0), p.get("sanctuary_level", 0)])
    for c in sorted(view["cards"], key=lambda c: (c["rel"], c["loc"], c["seq"])):
        counters = ",".join("%d:%d" % kv for kv in sorted(c["counters"].items()) if kv[1])
        if c["loc"] in (LOCATION_MZONE, LOCATION_SZONE):
            out["field"].append("%d|%s|%d|%d|%d|%d|%d|%s" % (c["rel"], place(c["loc"], c["seq"]), c["code"], c["pos"],
                                                            c["atk"], c["def"], c["overlay"], counters))
        elif c["loc"] == LOCATION_EXTRA:
            out["extra"].append("%d|%d|%d" % (c["rel"], c["code"], c["pos"]))
        elif c["loc"] == LOCATION_GRAVE:
            out["grave"][c["rel"]].append(c["code"])
        elif c["loc"] == LOCATION_HAND and c["rel"] == 0:
            out["hand"].append(c["code"])
        elif c["loc"] == LOCATION_REMOVED and c["rel"] == 0:
            out["removed"].append(c["code"])
    for k in ("field", "extra", "hand", "removed"):
        out[k].sort()
    return out


def creation_order(decks, seed):
    """the order sim.duel.Duel makes the cards in (its rng: 4 core seeds, then each main deck shuffled) - the web
    makes them alike, so its groups list cards in the same order (ocgcore sorts them by cardid)"""
    r = random.Random(seed)
    for _ in range(4):
        r.getrandbits(64)
    out = []
    for deck in decks:
        main = list(deck.main)
        r.shuffle(main)
        out.append(main)
    return out


DUMP = b"""local t={}
for p=0,1 do
  for c in aux.Next(Duel.GetFieldGroup(p,0x7e,0)) do
    t[#t+1]=c:GetCardID()..","..p..","..c:GetLocation()..","..c:GetSequence()..",0,"..c:GetOriginalCode()
    if c:IsLocation(LOCATION_MZONE) then
      for o in aux.Next(c:GetOverlayGroup()) do
        t[#t+1]=o:GetCardID()..","..p..","..(c:GetLocation()|LOCATION_OVERLAY)..","..c:GetSequence()..","..o:GetSequence()..","..o:GetOriginalCode()
      end
    end
  end
end
Debug.Message("DUMP "..table.concat(t,";"))"""


class Recording(Duel):
    """which card (ocgcore's cardid: the order cards were made in, 1 the first) each card that left the deck / each
    random pick was: right after the step that moved it, a script lists where every card is (OCG_DuelProcess
    stops at the first message, the cards have not moved again yet) and the move's destination tells it"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ids = {}   # id(raw message) -> cardids of the cards it moved (MSG_MOVE: 1, MSG_DRAW: n)

    def where(self, codes=None):
        """(controller, location, sequence, under-card index) -> cardid; codes: and cardid -> its code"""
        n = len(self.script_logs)
        self.dll.OCG_LoadScript(self.ptr, DUMP, len(DUMP), b"dump.lua")
        line = next((s for s in self.script_logs[n:] if s.startswith("DUMP ")), "DUMP ")
        out = {}
        for part in line[5:].split(";"):
            if part:
                cid, con, loc, seq, ov, code = map(int, part.split(","))
                out[(con, loc, seq, ov if loc & LOCATION_OVERLAY else 0)] = cid
                if codes is not None:
                    codes[cid] = code
        return out

    def card_id(self, card):
        """the cardid of a card a decision names ((code, controller, location, sequence); one under a card: any of
        that code under it)"""
        code, con, loc, seq = card
        codes = {}
        at = self.where(codes)
        if not loc & LOCATION_OVERLAY:
            return at.get((con, loc, seq, 0))
        return next((cid for k, cid in sorted(at.items()) if k[:3] == (con, loc, seq) and codes.get(cid) == code), None)

    def _messages(self):
        msgs = super()._messages()
        wanted = [raw for raw in msgs if raw[0] == MSG_DRAW or raw[0] == MSG_MOVE]
        if wanted:
            at = self.where()
            hand = [sorted((k[2], v) for k, v in at.items() if k[0] == p and k[1] == LOCATION_HAND) for p in (0, 1)]
            for raw in wanted:
                if raw[0] == MSG_DRAW:
                    n = struct.unpack_from("<I", raw, 2)[0]
                    self.ids[id(raw)] = [v for _, v in hand[raw[1]][len(hand[raw[1]]) - n:]] if n else []
                else:
                    loc = raw[16]
                    key = (raw[15], loc, struct.unpack_from("<I", raw, 17)[0],
                           struct.unpack_from("<I", raw, 21)[0] if loc & LOCATION_OVERLAY else 0)
                    self.ids[id(raw)] = [at.get(key)]
        return msgs


def play(db, decks, seed, rng):
    order = creation_order(decks, seed)
    duel = Recording(db, decks, seed=seed, rng=random.Random(seed))
    duel.keep_messages = True
    entries = []
    selecting = None   # (the card choice being answered pick by pick, its entry)
    seen = 0           # (messages already given to an entry's log)
    d = duel.advance()
    while d is not None:
        common = {"p": d.player, "msg": d.msg, "hint": d.hint, "turn": duel.turn, "phase": duel.phase,
                  "chain": len(duel.chain_targets)}
        if d.selection is not None:
            if selecting is None or selecting[0] is not d:
                entry = dict(common, cards=[card_key(c) for c in d.cards], min=d.min, max=d.max, picks=[],
                             state=compact(duel.view(d.player)), log=events(duel.message_log[seen:]))
                seen = len(duel.message_log)
                entries.append(entry)
                selecting = (d, entry)
        else:
            selecting = None
            entry = dict(common, forced=bool(d.meta.get("forced")), options=[option_key(o) for o in d.options],
                         state=compact(duel.view(d.player)), log=events(duel.message_log[seen:]))
            seen = len(duel.message_log)
            entries.append(entry)
        real = [i for i, o in enumerate(d.options) if not o.noop] or list(range(len(d.options)))
        if d.selection is not None:
            picks = [i for i in real if d.options[i].kind == K_CARD_PICK]
            stop = [i for i in real if d.options[i].kind in (K_CARD_FINISH, K_CARD_CANCEL)]
            real = picks if picks and (not stop or rng.random() < 0.6) else (stop or real)
        i = rng.choice(real)
        o = d.options[i]
        if d.selection is not None:
            if o.kind == K_CARD_PICK:
                entry["picks"].append(card_key(o.card))
                entry.setdefault("pickIds", []).append(duel.card_id(o.card))
            elif o.kind == K_CARD_CANCEL:
                entry["cancel"] = True
        else:
            entry["chosen"] = option_key(o)
            if o.card:
                entry["chosenId"] = duel.card_id(o.card)
        d = duel.step(i)
    deck_exits, random_picks = [[], []], []
    waiting, current = 0, []
    for raw in duel.message_log:
        m = raw[0]
        ids = duel.ids.get(id(raw), [])
        if m == MSG_DRAW:
            n = struct.unpack_from("<I", raw, 2)[0]
            for k in range(n):
                deck_exits[raw[1]].append([struct.unpack_from("<I", raw, 6 + 8 * k)[0] & 0x7fffffff,
                                           ids[k] if k < len(ids) else None])
        elif m == MSG_MOVE:
            code = struct.unpack_from("<I", raw, 1)[0] & 0x7fffffff
            cid = ids[0] if ids else None
            if raw[6] == LOCATION_DECK and raw[16] != LOCATION_DECK:
                deck_exits[raw[5]].append([code, cid])
            if waiting and raw[6] & LOCATION_OVERLAY:
                current.append([code, cid])
                waiting -= 1
                if not waiting:
                    random_picks.append(current)
                    current = []
        elif m == MSG_RANDOM_SELECTED:
            waiting = struct.unpack_from("<I", raw, 2)[0]
            current = []
    result = {"entries": entries, "order": order, "deckExits": deck_exits, "randomPicks": random_picks, "winner": duel.winner,
              "turn": duel.turn, "errors": list(duel.errors)[:3]}
    duel.close()
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    db = get_db()
    with open(os.path.join(WEB, "data", "ai_decks.json"), encoding="utf-8") as f:
        pool = [Deck(d["main"], d["summoner"], d["name"]) for d in json.load(f)["decks"]]
    rng = random.Random(args.seed)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as out:
        for g in range(args.games):
            decks = deck_pair(pool, g)
            game = play(db, decks, rng.getrandbits(32), rng)
            n = len(pool)
            game.update(game=g, decks=[g % n, (g // n + g) % n])
            out.write(json.dumps(game, ensure_ascii=False) + "\n")
            if (g + 1) % 50 == 0:
                print("%d판" % (g + 1))
    print("EDOPro %d판 기록" % args.games)


if __name__ == "__main__":
    main()
