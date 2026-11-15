/* kirafan_ai.model.derived: game-knowledge numbers worked out from a view (sanctuary levels, attack power left,
 * which battle creamates can be defeated). Per-card numbers are keyed by the view's card object (Python: id(c)). */
import {
  LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, POS_FACEUP, POS_DEFENSE, PHASE_MAIN1, PHASE_BATTLE_START,
  PHASE_BATTLE_STEP, PHASE_DAMAGE, PHASE_DAMAGE_CAL, PHASE_BATTLE, COUNTER_ATTACKS, COUNTER_WEAK, COUNTER_BIND,
} from "./data.js";

export const REALIST_LEVEL = 10;
export const MID_GAME_STARLIGHT = 8;
export const HAND_CAP = 5;
export const DOTTE_CAP = 10;

export const counter = (c, k) => c.counters[k] || 0;

export function lethalHp(c) {
  const hp = c.def;
  return counter(c, COUNTER_WEAK) > 0 ? Math.max(0, hp - 1) : hp;
}

export function compute(view, db) {
  const out = { players: [], cards: new Map() };
  const battleByRel = [[], []];
  for (const c of view.cards) {
    const card = c.code ? db.get(c.code) : null;
    if (c.loc === LOCATION_MZONE && c.seq < 5 && card && card.is_battle) battleByRel[c.rel].push(c);
  }
  for (const rel of [0, 1]) {
    const p = view.players[rel];
    let fieldLevel = 0;
    const handBattleLevels = [];
    let handAlchemists = 0;
    for (const c of view.cards) {
      if (c.rel !== rel) continue;
      const card = c.code ? db.get(c.code) : null;
      if ((c.loc === LOCATION_MZONE || c.loc === LOCATION_SZONE) && c.pos & POS_FACEUP) fieldLevel += c.level;
      if (c.loc === LOCATION_HAND && card) {
        if (card.is_battle) handBattleLevels.push(card.level);
        if (card.class_index === 4) handAlchemists += 1;
      }
    }
    const starlight = p.summoner_def || 0;
    const margin = starlight - fieldLevel;
    const battle = battleByRel[rel];
    const canFieldBattle = battle.length > 0 || handBattleLevels.some((lv) => lv <= margin);
    const attackers = battle.filter((c) => counter(c, COUNTER_ATTACKS) > 0 || [0, 1, 2, PHASE_MAIN1].includes(view.phase));
    out.players.push({
      sanctuary: p.sanctuary_level || 0,
      to_realist: Math.max(0, REALIST_LEVEL - (p.sanctuary_level || 0)),
      starlight,
      field_level: fieldLevel,
      margin,
      battle_count: battle.length,
      hand_battle: handBattleLevels.length,
      hand_alchemists: handAlchemists,
      can_field_battle: canFieldBattle,
      max_atk: attackers.length ? Math.max(...attackers.map((c) => c.atk)) : 0,
      sum_atk: attackers.reduce((n, c) => n + c.atk, 0),
      attack_counters: battle.reduce((n, c) => n + counter(c, COUNTER_ATTACKS), 0),
      dotte: Math.min(p.grave || 0, DOTTE_CAP),
      hand: p.hand || 0,
      hand_over: Math.max(0, (p.hand || 0) - HAND_CAP),
    });
  }
  const [me, opp] = out.players;
  out.advantage = opp.sanctuary - me.sanctuary;
  out.realist = Math.max(me.sanctuary, opp.sanctuary) >= REALIST_LEVEL;
  out.mid = me.starlight >= MID_GAME_STARLIGHT;
  out.my_turn = view.turn_player === 0;
  out.in_battle = [PHASE_BATTLE_START, PHASE_BATTLE_STEP, PHASE_DAMAGE, PHASE_DAMAGE_CAL, PHASE_BATTLE].includes(view.phase);
  for (const rel of [0, 1]) {
    const foe = out.players[1 - rel];
    for (const c of battleByRel[rel]) {
      const need = lethalHp(c);
      out.cards.set(c, {
        killable_single: (foe.max_atk >= need && need > 0) || need === 0,
        killable_total: foe.sum_atk >= need,
        lethal_hp: need,
        stiff: !!(c.pos & POS_DEFENSE),
        bound: counter(c, COUNTER_BIND) > 0,
      });
    }
  }
  me.killable_levels = battleByRel[0].filter((c) => out.cards.get(c).killable_total).reduce((n, c) => n + c.level, 0);
  opp.killable_levels = battleByRel[1].filter((c) => out.cards.get(c).killable_total).reduce((n, c) => n + c.level, 0);
  return out;
}
