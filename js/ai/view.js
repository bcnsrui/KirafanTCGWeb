/* What one player sees of the web engine's duel, as the learning AI's view (kirafan_ai.core.view): the same
 * schema and the same conventions as the states ocgcore showed it in training - the positions its queries give
 * (a hand card 10, the graveyard and the village 5, a fallen creamate 4), the phase as its messages tell it (the
 * whole battle phase is 8: no message comes for the battle step, the damage step or the battle's end), the
 * opponent's hand, village and face-down extra deck hidden. */
import {
  LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_REMOVED, LOCATION_EXTRA, LOCATION_OVERLAY,
  POS_FACEUP, PHASE_BATTLE_START, PHASE_BATTLE,
} from "./data.js";

const VIEW_LOCATIONS = [LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_REMOVED, LOCATION_EXTRA];
const FIXED_POS = { [LOCATION_HAND]: 10, [LOCATION_GRAVE]: 5, [LOCATION_REMOVED]: 5 };

export function viewPhase(phase) {
  return phase >= PHASE_BATTLE_START && phase <= PHASE_BATTLE ? PHASE_BATTLE_START : phase;
}

function list(z, loc) {
  return { [LOCATION_HAND]: z.hand, [LOCATION_MZONE]: z.mzone, [LOCATION_SZONE]: z.szone, [LOCATION_GRAVE]: z.grave,
    [LOCATION_REMOVED]: z.removed, [LOCATION_EXTRA]: z.extra }[loc];
}

/** the card as an option names it: (code, controller, location, sequence); hidden cards have code 0 */
export function cardTuple(duel, card, me) {
  if (card.holder) {
    const h = card.holder;
    return [card.code, h.controller, h.location | LOCATION_OVERLAY, h.sequence];
  }
  const hidden = card.controller !== me && (card.location === LOCATION_HAND || card.location === 0x1
    || ((card.location === LOCATION_MZONE || card.location === LOCATION_SZONE) && !(card.position & POS_FACEUP)));
  return [hidden ? 0 : card.code, card.controller, card.location, card.sequence];
}

function summarize(view) {
  for (const rel of [0, 1]) {
    const p = view.players[rel];
    let lvl = 0, fieldLevel = 0, summoner = null;
    for (const c of view.cards) {
      if (c.rel !== rel) continue;
      if (c.loc === LOCATION_EXTRA && c.pos & POS_FACEUP) lvl += c.level;
      else if (c.loc === LOCATION_MZONE && c.seq >= 5) summoner = c;
      else if ((c.loc === LOCATION_MZONE || c.loc === LOCATION_SZONE) && c.pos & POS_FACEUP) {
        fieldLevel += c.level;
        if (c.loc === LOCATION_MZONE && c.code) c.def = c.overlay;
      }
    }
    if (summoner) {
      summoner.atk = fieldLevel;
      summoner.def = summoner.base_def + (p.extra || 0) + summoner.overlay;
      p.summoner_atk = summoner.atk;
      p.summoner_def = summoner.def;
      p.summoner_overlay = summoner.overlay;
      p.summoner_code = summoner.code;
    }
    p.sanctuary_level = lvl;
    p.summoner_atk ??= 0;
    p.summoner_def ??= 0;
    p.summoner_overlay ??= 0;
    p.summoner_code ??= 0;
  }
  return view;
}

/** attack: whether the attack declared is still to deal its damage (ocgcore: from MSG_ATTACK to MSG_BATTLE) */
export function viewOf(duel, me, { attack = true } = {}) {
  const view = { me, turn: duel.turn, turn_player: duel.turnPlayer === me ? 0 : 1, phase: viewPhase(duel.phase),
    players: [], cards: [], chain: [], attack: null };
  for (const rel of [0, 1]) {
    const abs = rel === 0 ? me : 1 - me;
    const z = duel.p[abs];
    view.players.push({ lp: z.lp, deck: z.deck.length, hand: z.hand.length, grave: z.grave.length,
      removed: z.removed.length, extra: z.extra.length });
    let facedownExtra = 0;
    for (const loc of VIEW_LOCATIONS) {
      list(z, loc).forEach((card, seq) => {
        if (!card) return;
        const pos = FIXED_POS[loc] ?? card.position;
        if (loc === LOCATION_EXTRA && !(pos & POS_FACEUP)) {
          facedownExtra += 1;
          if (rel === 1) return;
        }
        if (rel === 1 && (loc === LOCATION_HAND || loc === LOCATION_REMOVED)) return;
        const onField = loc === LOCATION_MZONE || loc === LOCATION_SZONE;
        const code = rel === 1 && onField && !(pos & POS_FACEUP) ? 0 : card.code;
        const d = card.data;
        view.cards.push({
          code, rel, loc, seq, pos,
          atk: loc === LOCATION_MZONE ? duel.atkOf(card) : d.atk,
          def: loc === LOCATION_MZONE ? duel.defOf(card) : d.def,
          base_def: d.def,
          level: loc === LOCATION_HAND || onField ? duel.levelOf(card) : d.level,
          overlay: card.overlay.length,
          counters: Object.fromEntries([...card.counters].filter(([, n]) => n > 0)),
          public: loc === LOCATION_HAND ? 0 : 1,
        });
      });
    }
    view.players[rel].extra_facedown = facedownExtra;
  }
  for (const link of duel.chain) {
    view.chain.push({ code: link.card.code, rel: link.player === me ? 0 : 1,
      targets: link.targets.map((t) => [t.card.controller === me ? 0 : 1, t.card.location, t.card.sequence]) });
  }
  const a = duel.attacker, t = duel.attackTarget;
  if (attack && a && t && a.location === LOCATION_MZONE && t.location === LOCATION_MZONE) {
    view.attack = { attacker: [a.controller === me ? 0 : 1, a.sequence], target: [t.controller === me ? 0 : 1, t.sequence] };
  }
  return summarize(view);
}
