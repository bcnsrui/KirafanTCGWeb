"""Build what the web version's AI (js/ai) reads: the learning AI's model and what it knows of the cards.

    KirafanAI\\.venv\\Scripts\\python.exe KirafanWeb\\tools\\build_ai.py [--model 15100]

- data/ai/model.bin: the network's weights (float32, little endian, one tensor after the other), widened to the
  current feature sizes as kirafan_ai.bridge.npmodel.NumpyPolicy does
- data/ai/model.json: {update, config, vocab: the card codes in embedding order, tensors: {name: [offset, shape]}}
- data/ai/cards.json: every card of the card database with what kirafan_ai.model.features reads of it - its
  stats, its text and effect strings, and the numbers kirafan_ai.cardtext reads from the text (computed here, so
  the page reads the text exactly as training did) - and the card pool's attack buff / gauge / extra attack
  supports (features.buff_table / tool_table)
"""
import argparse
import json
import os
import re
import sys

import numpy as np

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(GAME, "KirafanAI"))

from kirafan_ai.bridge.npmodel import META, NumpyPolicy  # noqa: E402
from kirafan_ai.cardtext import CardText  # noqa: E402
from kirafan_ai.cards import get_db  # noqa: E402
from kirafan_ai.model import features  # noqa: E402
from kirafan_ai.model.tactical import dotte_draws  # noqa: E402

MODELS = os.path.join(GAME, "WindBot", "KirafanAI", "models")


def newest_model():
    found = [int(m.group(1)) for f in os.listdir(MODELS) for m in [re.match(r"(\d+)\.npz$", f)] if m]
    return max(found)


def export_model(path, out_dir):
    net = NumpyPolicy(path)   # (widened to the current GLOBAL_DIM / OPTION_DIM)
    tensors, chunks, offset = {}, [], 0
    for name in sorted(net.w):
        a = np.ascontiguousarray(net.w[name], dtype="<f4")
        tensors[name] = [offset, list(a.shape)]
        chunks.append(a.tobytes())
        offset += a.size
    with open(os.path.join(out_dir, "model.bin"), "wb") as f:
        for c in chunks:
            f.write(c)
    meta = {"update": net.update, "config": net.config, "vocab": net.vocab, "tensors": tensors,
            "dims": {"global": features.GLOBAL_DIM, "card": features.CARD_DIM, "option": features.OPTION_DIM}}
    with open(os.path.join(out_dir, "model.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    return net, offset


def text_fields(t):
    return {k: getattr(t, k) for k in CardText.__slots__}


def buff_in(card, want):
    """features._Tactics._buff_of: (attack +N, all allies?) of the first "아군 ... 공격력+N" line of the text section
    whose header starts with `want`."""
    for head, body in features._sections(card.desc):
        if not head.startswith(want):
            continue
        for line in body.splitlines():
            m = features._BUFF_LINE.search(line)
            if m and "아군" in line:
                return [int(m.group(1)), "아군 전체" in line]
    return [0, False]


def hand_buff(card):
    """features._Tactics.hand_buffs' entry of one copy: (attack +N, all allies?, one attack only?, gauge cost,
    stiff cost) of its biggest buff, or None."""
    best = None
    for head, body in features._sections(card.desc):
        cost = features._GAUGE_COST.match(head)
        if not (head.startswith("스킬") or cost):
            continue
        for line in body.splitlines():
            m = features._BUFF_LINE.search(line)
            if m and "아군" in line:
                entry = [int(m.group(1)), "아군 전체" in line, "1번만" in line, int(cost.group(1)) if cost else 0,
                         features.stiff_cost(head)]
                if best is None or entry[0] > best[0]:
                    best = entry
                break
    return best


def export_cards(db, out_dir):
    cards = {}
    for code, card in db.cards.items():
        cards[code] = {
            "type": card.type, "level": card.level, "race": card.race, "attribute": card.attribute,
            "atk": card.attack, "def": card.defense, "name": card.name, "desc": card.desc, "strings": card.strings,
            "cls": card.class_index, "att": card.attribute_index, "battle": card.is_battle,
            "support": card.is_support, "creamate": card.is_creamate,
            "text": text_fields(CardText(card.desc)),
            "draws": dotte_draws(db, code),
            "taunt": features.TAUNT_TEXT in card.desc,
            "cleanse": card.is_support and features.CLEANSE_TEXT in card.desc,
            "cleanseDotte": features.CLEANSE_TEXT in card.desc.split("[돗테오키", 1)[-1],
            "buffDotte": buff_in(card, "돗테오키 게이지"),
            "buffSkill": buff_in(card, "스킬"),
            "handBuff": hand_buff(card),
        }
    out = {"cards": cards, "pool": db.creamate_pool(),
           "buffTable": features.buff_table(db), "toolTable": features.tool_table(db)}
    with open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return len(cards)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=int, default=0, help="WindBot/KirafanAI/models/<model>.npz (default: the newest)")
    args = ap.parse_args()
    model = args.model or newest_model()
    out_dir = os.path.join(WEB, "data", "ai")
    os.makedirs(out_dir, exist_ok=True)
    net, floats = export_model(os.path.join(MODELS, "%d.npz" % model), out_dir)
    db = get_db()
    db.set_vocab_order(net.vocab)
    n = export_cards(db, out_dir)
    print("모델 %d (업데이트 %d): 가중치 %d개 (%.1f MB), 카드 %d장" % (model, net.update, floats, floats * 4 / 1e6, n))


if __name__ == "__main__":
    main()
