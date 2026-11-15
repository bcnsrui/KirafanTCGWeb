"""Reference samples for the web AI (js/ai): what training's simulator showed the model, decision by decision.

    KirafanAI\\py32\\python.exe KirafanWeb\\tools\\ai_samples.py [--games 4] [--seed 1]
    KirafanAI\\.venv\\Scripts\\python.exe KirafanWeb\\tools\\ai_samples.py --logits

The first (the 32-bit interpreter: ocgcore.dll) plays duels between rule-based players on the real engine and
writes every decision of both players, in order, to data/ai/test/samples.jsonl: the view, the decision (its options
before features.sanctuary_rule) and features.encode's output. The second adds the network's logits and value
(kirafan_ai.bridge.npmodel) for each. js/ai/parity.js checks the page's port against them (in the same order:
the look-ahead's board cache, features._PLANS, carries over from decision to decision).
"""
import argparse
import json
import os
import random
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(GAME, "KirafanAI"))

OUT = os.path.join(WEB, "data", "ai", "test", "samples.jsonl")


def card_json(c):
    return list(c) if c is not None else None


def view_json(v):
    out = dict(v)
    out["cards"] = [dict(c, counters={str(k): n for k, n in c["counters"].items()}) for c in v["cards"]]
    out["chain"] = [dict(ch, targets=[list(t) for t in ch.get("targets", ())]) for ch in v.get("chain", ())]
    att = v.get("attack")
    out["attack"] = {"attacker": list(att["attacker"]), "target": list(att["target"])} if att else None
    return out


def decision_json(d):
    ctx = d.context
    return {
        "msg": d.msg, "player": d.player, "min": d.min, "max": d.max, "cancelable": d.cancelable, "hint": d.hint,
        "picked": list(d.selection.picked) if d.selection is not None else None,
        "context": [ctx[0], card_json(ctx[1]), ctx[2]] if ctx else None,
        "options": [{"kind": o.kind, "card": card_json(o.card), "desc": o.desc, "extra": o.extra, "noop": o.noop}
                    for o in d.options],
    }


def play(games, seed):
    from kirafan_ai.agents.heuristic import HeuristicAgent, meaningful_indices
    from kirafan_ai.cards import get_db
    from kirafan_ai.model.features import encode
    from kirafan_ai.sim.decks import load_existing_decks
    from kirafan_ai.sim.duel import Duel
    db = get_db()
    with open(os.path.join(WEB, "data", "ai", "model.json"), encoding="utf-8") as f:
        db.set_vocab_order(json.load(f)["vocab"])
    decks = load_existing_decks(db)
    rng = random.Random(seed)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    n = 0
    with open(OUT, "w", encoding="utf-8") as out:
        for g in range(games):
            agents = [HeuristicAgent(db, seed=rng.getrandbits(32), noise=0.4) for _ in range(2)]
            duel = Duel(db, (rng.choice(decks), rng.choice(decks)), seed=rng.getrandbits(32))
            d = duel.advance()
            while d is not None:
                view = duel.view(d.player)
                before = decision_json(d)
                options = list(d.options)
                enc = encode(view, d, db)
                kept = [options.index(o) for o in d.options]
                out.write(json.dumps({"game": g, "view": view_json(view), "decision": before, "kept": kept,
                                      "enc": enc}, ensure_ascii=False) + "\n")
                n += 1
                if rng.random() < 0.15:
                    idx = rng.choice(meaningful_indices(d))
                else:
                    idx = agents[d.player].choose(view, d)
                d = duel.step(idx)
            print("대전 %d: 승자 %s, %d턴, 누적 결정 %d" % (g + 1, duel.winner, duel.turn, n))
            duel.close()


def add_logits():
    from kirafan_ai.bridge.npmodel import NumpyPolicy
    from kirafan_ai.model.features import pack
    from kirafan_ai.bridge.npmodel import to_arrays
    models = os.path.join(GAME, "WindBot", "KirafanAI", "models")
    with open(os.path.join(WEB, "data", "ai", "model.json"), encoding="utf-8") as f:
        update = json.load(f)["update"]
    net = NumpyPolicy(os.path.join(models, "%d.npz" % update))
    lines = open(OUT, encoding="utf-8").read().splitlines()
    with open(OUT, "w", encoding="utf-8") as out:
        for line in lines:
            s = json.loads(line)
            logits, value = net.forward(to_arrays(pack(s["enc"])))
            s["logits"] = [float(x) for x in logits]
            s["value"] = float(value)
            out.write(json.dumps(s, ensure_ascii=False) + "\n")
    print("확률 계산 %d개" % len(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--logits", action="store_true")
    args = ap.parse_args()
    if args.logits:
        add_logits()
    else:
        play(args.games, args.seed)


if __name__ == "__main__":
    main()
