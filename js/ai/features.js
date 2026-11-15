/* kirafan_ai.model.features: (view, decision) -> the network's inputs. A line-for-line port (js/ai/parity.js checks
 * it against the Python's output on training's simulator states). Options: { kind, card: [code, controller,
 * location, sequence] | null, desc, extra, noop }; decision: { msg, min, max, hint, picked: [..] | null,
 * context: [kind, card, desc] | null, options }. */
import {
  LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_EXTRA, LOCATION_REMOVED, LOCATION_DECK,
  POS_FACEUP, POS_DEFENSE, PHASES, PHASE_DRAW, PHASE_STANDBY, PHASE_MAIN1, PHASE_BATTLE_START, PHASE_BATTLE_STEP,
  PHASE_DAMAGE, PHASE_DAMAGE_CAL, PHASE_BATTLE, MSG_TYPES, MSG_SELECT_CARD, TRACKED_COUNTERS, STATUS_COUNTERS,
  COUNTER_ATTACKS, COUNTER_WEAK, COUNTER_BIND, COUNTER_SLEEP, COUNTER_HUNGER, ACTIVATE_KINDS, K_BATTLE_ATTACK,
  K_CARD_PICK, K_IDLE_TO_BP, K_IDLE_TO_EP, K_BATTLE_TO_EP, K_BATTLE_TO_M2, K_CHAIN_PASS, NOOP_DESCS, CLASS_RACES,
  CLASS_NAMES, ATTRIBUTES, ATTRIBUTE_NAMES, sid, descCode, descIndex, textOf,
} from "./data.js";
import * as derived from "./derived.js";
import { counter } from "./derived.js";
import { Plan, Defense, OPP_HEALS_MAX, key, minBy, maxBy } from "./tactical.js";

const CARD_LOCS = [[LOCATION_HAND, false], [LOCATION_MZONE, false], [LOCATION_MZONE, true], [LOCATION_SZONE, false],
  [LOCATION_GRAVE, false], [LOCATION_EXTRA, false], [LOCATION_REMOVED, false], [LOCATION_DECK, false]];
const TOKEN_LOCS = [LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_EXTRA];
const MAX_CARD_TOKENS = 64;
export const PLAYER_FEATS = 27;
const GLOBAL_EXTRA_DIM = 8;
export const GLOBAL_DIM = PHASES.length + 1 + 2 + MSG_TYPES.length + 3 + 2 * PLAYER_FEATS + 5 + GLOBAL_EXTRA_DIM;
export const CARD_DIM = 2 + CARD_LOCS.length + 1 + 2 + 5 + (CLASS_RACES.length + 1) + (ATTRIBUTES.length + 1) + 2
  + TRACKED_COUNTERS.length + 4;
export const OPTION_BASE_DIM = 2 + CARD_LOCS.length + 1 + 5;
const OPTION_EXTRA_DIM = 48;
export const OPTION_DIM = OPTION_BASE_DIM + OPTION_EXTRA_DIM;

export const SINGLE_HEAL_DESC = sid(10050113, 0);
export const ALL_HEAL_DESC = sid(10050113, 1);
const COMMON_HEAL_DESCS = [SINGLE_HEAL_DESC, ALL_HEAL_DESC, 0];
const DOTTE_DESCS = [sid(10050113, 4), sid(10050113, 5), sid(10050111, 5)];
const DAMAGE_DESCS = [...DOTTE_DESCS, sid(10050113, 2), sid(10050113, 3)];
const PROFESSOR = 10051332;
const SHINOBU = 10051521;
const COUNTER_NO_HEAL = 0xb02;
const CLEANSE_DESC_TEXT = "상태이상 해제";
const COUNTER_ALL_ATTACK = 0xc04;
const THREAT_PHASES = [PHASE_DRAW, PHASE_STANDBY, PHASE_MAIN1, PHASE_BATTLE_START, PHASE_BATTLE_STEP, PHASE_DAMAGE,
  PHASE_DAMAGE_CAL, PHASE_BATTLE];
const BEFORE_BATTLE = [PHASE_DRAW, PHASE_STANDBY, PHASE_MAIN1];
const PLAN_PHASES = [PHASE_MAIN1, PHASE_BATTLE_START, PHASE_BATTLE_STEP, PHASE_BATTLE];
const PLAN_BUFFS = 2;
const PLAN_TOOLS = 2;
const PLANS = new Map();   // the look-ahead results by board (features._PLANS), carried from decision to decision
const OPP_HEAL_GUESS = 4;
const SUPPORT_ZONES = { true: [0, 2, 4], false: [1, 3] };
const ATTR_LIGHT = 0x10, ATTR_DARK = 0x20;
const ATTRIBUTE_ENABLERS = {
  10051521: [ATTR_LIGHT | ATTR_DARK, (oppAttrs) => 1 + (oppAttrs & (ATTR_LIGHT | ATTR_DARK) ? 2 : 0)],
  10051622: [ATTR_DARK, () => 2],
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const b2f = (x) => (x ? 1.0 : 0.0);
const has = (list, x) => list.includes(x);

export function supportFree(view, rel) {
  const taken = new Set(view.cards.filter((c) => c.rel === rel && c.loc === LOCATION_SZONE).map((c) => c.seq));
  return SUPPORT_ZONES[view.turn_player === rel].filter((s) => !taken.has(s)).length;
}

function upright(cards) {
  return cards.filter((c) => !(c.pos & POS_DEFENSE)).length;
}

function locOnehot(loc, seq) {
  const v = Array(CARD_LOCS.length).fill(0.0);
  const emz = loc === LOCATION_MZONE && seq >= 5;
  for (let i = 0; i < CARD_LOCS.length; i++) {
    const [l, e] = CARD_LOCS[i];
    if (l === loc && (l !== LOCATION_MZONE || e === emz)) {
      v[i] = 1.0;
      break;
    }
  }
  return v;
}

function playerFeats(p, d, removedClasses) {
  return [
    1.0,
    (p.deck || 0) / 60.0,
    (p.hand || 0) / 10.0,
    d.dotte / 10.0,
    (p.removed || 0) / 60.0,
    (p.extra || 0) / 20.0,
    (p.extra_facedown || 0) / 20.0,
    (p.summoner_overlay || 0) / 20.0,
    d.sanctuary / 10.0,
    d.to_realist / 10.0,
    d.starlight / 20.0,
    d.field_level / 20.0,
    Math.max(-10, Math.min(20, d.margin)) / 10.0,
    d.battle_count / 3.0,
    d.hand_battle / 10.0,
    b2f(d.can_field_battle),
    d.max_atk / 10.0,
    d.sum_atk / 20.0,
    d.attack_counters / 5.0,
    d.hand_over / 5.0,
    b2f(d.hand > derived.HAND_CAP),
    d.killable_levels / 10.0,
    ...removedClasses.map((n) => n / 20.0),
  ];
}

function cardStatic(db, code) {
  const card = code ? db.get(code) : null;
  const cls = Array(CLASS_RACES.length + 1).fill(0.0);
  const att = Array(ATTRIBUTES.length + 1).fill(0.0);
  if (!card) {
    cls[cls.length - 1] = 1.0;
    att[att.length - 1] = 1.0;
    return [...cls, ...att, 0.0, 0.0];
  }
  cls[card.class_index] = 1.0;
  att[card.attribute_index] = 1.0;
  return [...cls, ...att, card.attack / 5.0, card.defense / 10.0];
}

const sortedCounters = (c) => Object.entries(c.counters).map(([k, n]) => [Number(k), n]).sort((a, b) => a[0] - b[0]);

class Tactics {
  constructor(view, decision, db, der) {
    this.view = view;
    this.db = db;
    this.der = der;
    this.me = view.me;
    this.battle = [new Map(), new Map()];
    for (const c of view.cards) {
      if (c.loc === LOCATION_MZONE && c.seq < 5 && c.code && db.get(c.code) && db.get(c.code).is_battle) {
        this.battle[c.rel].set(c.seq, c);
      }
    }
    this.ctx = decision.context;
    this.decision = decision;
    this.can_heal = [0, 1].map((rel) => this._can_heal(rel));
    this.incoming = null;
    const att = view.attack;
    if (att && att.attacker[0] === 1 && att.target[0] === 0) {
      const a = this.battle[1].get(att.attacker[1]), t = this.battle[0].get(att.target[1]);
      if (a && t) this.incoming = [a, t];
    }
    this.incoming_dotte = null;
    const chain = view.chain || [];
    if (view.turn_player === 1 && chain.length && chain[chain.length - 1].rel === 1 && this.incoming === null) {
      const top = chain[chain.length - 1];
      const b = [...this.battle[1].values()].find((c) => c.code === top.code) || null;
      const t = b ? textOf(db, top.code) : null;
      if (t && t.dotte_hits) {
        const hit = (top.targets || []).filter(([rel, loc]) => rel === 0 && loc === LOCATION_MZONE)
          .map(([, , seq]) => this.battle[0].get(seq)).filter((c) => c);
        if (hit.length || t.dotte_to_all) this.incoming_dotte = [b, hit.length ? hit[0] : null];
      }
    }
    this.threat_turn = view.turn_player === 1 && has(THREAT_PHASES, view.phase);
    this.opp_gauge = der.players[1].dotte;
    this.taunts = [...this.battle[0].values()].filter((c) => c.pos & POS_FACEUP && db.get(c.code) && db.get(c.code).taunt);
    const hand = view.cards.filter((c) => c.rel === 0 && c.loc === LOCATION_HAND).map((c) => c.code);
    this.hand_cleanses = hand.filter((h) => this._is_cleanse_card(h));
    this.hand_heals = hand.filter((h) => db.get(h) && db.get(h).is_support && (textOf(db, h).heal_single || textOf(db, h).heal_all));
    this.slots_used = [0, 1].map((rel) => view.cards.filter((c) => c.rel === rel && c.loc === LOCATION_SZONE && c.seq < 5).length);
    this.support_free = [0, 1].map((rel) => supportFree(view, rel));
    this.opp_buff = this._opp_buff_potential();
    this._threats = new Map();
  }

  _room(rel) {
    return this.view.players[rel].summoner_code === 10050110 ? 99 : this.der.players[rel].margin;
  }

  _opp_buff_potential() {
    const p = this.view.players[1];
    if ((p.hand || 0) <= 0 || this.support_free[1] <= 0) return [0, 0];
    const room = this._room(1);
    const gauge = this._future_gauge(1);
    const stand = upright([...this.battle[1].values()]);
    const ok = this.db.buffTable.filter(([level, , , cost, stiff]) => level <= room && cost <= gauge && stiff <= stand)
      .map(([, n, toAll]) => [n, toAll]);
    return [ok.length ? Math.max(...ok.map(([n]) => n)) : 0,
      ok.some(([, a]) => a) ? Math.max(...ok.filter(([, a]) => a).map(([n]) => n)) : 0];
  }

  _opp_tool_potential() {
    const p = this.view.players[1];
    if ((p.hand || 0) <= 0 || this.support_free[1] <= 0) return [0, false, false];
    const room = this._room(1);
    const gauge = this._future_gauge(1);
    const stand = upright([...this.battle[1].values()]);
    const ours = this._field_cards(0).length;
    let g = 0, one = false, every = false;
    for (const [level, kind, n, who, cost, stiff] of this.db.toolTable) {
      if (level > room || cost > gauge || stiff > stand) continue;
      if (kind === "gauge") g = Math.max(g, n > 0 ? n : ours - n);
      else if (who === "all") every = true;
      else one = true;
    }
    return [g, one, every];
  }

  _class_name(c) {
    const card = this.db.get(c.code);
    return card && card.class_index < CLASS_RACES.length ? CLASS_NAMES[CLASS_RACES[card.class_index]] : null;
  }

  _attr_name(c) {
    const card = this.db.get(c.code);
    return card ? (ATTRIBUTE_NAMES[card.attribute] ?? null) : null;
  }

  start_bonus(rel) {
    this._start_bonus = this._start_bonus || new Map();
    if (this._start_bonus.has(rel)) return this._start_bonus.get(rel);
    const out = new Map();
    if (rel === this.view.turn_player && this._counters_pending(rel)) {
      const battle = [...this.battle[rel].values()];
      const hunger = [0, 1].reduce((n, side) => n + [...this.battle[side].values()].filter((c) => counter(c, COUNTER_HUNGER) > 0).length, 0);
      for (const c of battle) {
        for (const rule of textOf(this.db, c.code).start) {
          if (rule[0] === "allies") {
            for (const a of battle) {
              if (has(rule[1], this._class_name(a))) {
                const [turn, once] = out.get(a.seq) || [0, 0];
                out.set(a.seq, rule[2] ? [turn, once + rule[3]] : [turn + rule[3], once]);
              }
            }
            continue;
          }
          let n;
          if (rule[0] === "self_cond") n = c.def >= rule[1] || c.atk >= rule[2] ? rule[3] : 0;
          else if (rule[0] === "self_hand_diff") n = Math.max(0, (this.view.players[1 - rel].hand || 0) - (this.view.players[rel].hand || 0));
          else n = hunger;
          const [turn, once] = out.get(c.seq) || [0, 0];
          out.set(c.seq, [turn + n, once]);
        }
      }
    }
    this._start_bonus.set(rel, out);
    return out;
  }

  attack_of(c) {
    const [turn, once] = this.start_bonus(c.rel).get(c.seq) || [0, 0];
    return [c.atk + turn, once];
  }

  hit_of(c, target, atk) {
    const vs = textOf(this.db, c.code).vs_attr_atk;
    return Math.max(0, atk + (vs && this._attr_name(target) === vs[0] ? vs[1] : 0));
  }

  attackable(target, alive = null) {
    const side = alive === null ? [...this.battle[target.rel].values()] : alive;
    const taunts = side.filter((c) => this.is_taunt(c));
    if (taunts.length && !taunts.some((c) => c === target)) return false;
    return !(textOf(this.db, target.code).not_attackable && side.some((c) => c !== target));
  }

  dotte_damage(t, attacker, target, opt = false, atkBonus = 0) {
    const rel = attacker.rel;
    let single = t.dotte_single, toAll = t.dotte_all;
    if (t.dotte_var) {
      const [allPart, kind, attr, plus] = t.dotte_var;
      const n = kind === "attr" ? this._field_cards(rel).filter((c) => this._attr_name(c) === attr).length + plus
        : this.battle[1 - rel].size;
      if (allPart) toAll += n;
      else single += n;
    }
    const bonus = this._bonus(t, attacker, target, opt, atkBonus);
    return Math.max(0, toAll + (single ? Math.max(0, single + bonus) : bonus));
  }

  _is_cleanse_card(code) {
    const card = this.db.get(code);
    return !!card && card.cleanse;
  }

  _is_cleanse_option(code, desc) {
    if (has(DOTTE_DESCS, desc)) return this.db.get(code) ? this.db.get(code).cleanseDotte : false;
    return !!desc && this.db.describe(desc).includes(CLEANSE_DESC_TEXT);
  }

  _supports_room(n) {
    const p = this.view.players[0];
    return n <= this.support_free[0] && (p.summoner_code === 10050110 || this.der.players[0].margin >= n);
  }

  _counters_pending(rel) {
    const phase = this.view.phase;
    return has(BEFORE_BATTLE, phase) || (phase === PHASE_BATTLE_START
      && ![...this.battle[rel].values()].some((c) => counter(c, COUNTER_ATTACKS)));
  }

  _attacks_left(b) {
    let n = counter(b, COUNTER_ATTACKS) + (this._counters_pending(b.rel) ? 1 : 0);
    if (this.incoming !== null && b === this.incoming[0]) n -= 1;
    return Math.max(0, n);
  }

  _future_gauge(rel) {
    const pending = this._counters_pending(rel);
    return this.der.players[rel].dotte + this.pending_attack_gauge(rel) + sum([...this.battle[rel].values()]
      .filter((b) => counter(b, COUNTER_ATTACKS) + (pending ? 1 : 0) > 0).map((b) => textOf(this.db, b.code).attack_gauge));
  }

  pending_attack_gauge(rel) {
    const att = this.view.attack;
    if (!att || att.attacker[0] !== rel || !has([PHASE_DAMAGE, PHASE_DAMAGE_CAL], this.view.phase)) return 0;
    const b = this.battle[rel].get(att.attacker[1]);
    if (!b || counter(b, COUNTER_ATTACKS) > 0) return 0;
    return textOf(this.db, b.code).attack_gauge;
  }

  chain_damage(target, opt = false) {
    const rel = 1 - target.rel;
    let total = 0;
    for (const ch of this.view.chain || []) {
      if (ch.rel !== rel) continue;
      const b = [...this.battle[rel].values()].find((c) => c.code === ch.code) || null;
      const t = b ? textOf(this.db, ch.code) : null;
      if (!t || !t.dotte_hits) continue;
      const hit = (ch.targets || []).filter(([r, loc]) => r === target.rel && loc === LOCATION_MZONE).map(([, , seq]) => seq);
      if (t.dotte_to_all || hit.includes(target.seq)) total += this.dotte_damage(t, b, target, opt);
    }
    return total;
  }

  _can_dotte(b) {
    return !(b.pos & POS_DEFENSE) && counter(b, COUNTER_BIND) === 0;
  }

  _normal_hits(b, target, cut = 0, plus = 0, opened = false) {
    const t = textOf(this.db, b.code);
    let [atk, once] = this.attack_of(b);
    atk += plus - cut;
    if (t.half_all) return [Math.floor(Math.max(0, atk + once) / 2), Math.floor(Math.max(0, atk) / 2)];
    if (opened || counter(b, COUNTER_ALL_ATTACK) > 0 || this.attackable(target)) {
      const weak = t.attack_weak && !counter(target, COUNTER_WEAK) ? 1 : 0;
      return [this.hit_of(b, target, atk + once) + weak, this.hit_of(b, target, atk)];
    }
    return [0, 0];
  }

  _taunts_fall(target) {
    const taunts = [...this.battle[target.rel].values()].filter((c) => this.is_taunt(c) && c !== target);
    return taunts.length > 0 && taunts.every((c) => this.threat(c)[0] >= derived.lethalHp(c));
  }

  _dotte_max(target, buff = 0, gaugePlus = 0) {
    let entries = [];
    const standing = [...this.battle[1].values()].filter((f) => !(f.pos & POS_DEFENSE));
    const weakGain = counter(target, COUNTER_WEAK) ? 0 : 1;
    for (const b of this.battle[1].values()) {
      const t = textOf(this.db, b.code);
      if (!t.dotte_hits || !this._can_dotte(b)) continue;
      const others = standing.filter((f) => f !== b).length;
      if (t.dotte_stiff > others) continue;
      const base = this.dotte_damage(t, b, target, true, buff) + (t.dotte_weak ? weakGain : 0);
      let value = base;
      const n = this._attacks_left(b);
      const [first, later] = this._normal_hits(b, target);
      const up = t.dotte_self_atk + (t.dotte_self_atk_opp ? this.battle[0].size : 0);
      if (up && n) {
        const [first2, later2] = this._normal_hits(b, target, 0, up);
        value += (first2 - first) + (n - 1) * (later2 - later);
      }
      const more = t.dotte_more_attacks;
      if (more && more[0] + t.dotte_stiff <= others) {
        const per = [...this.battle[1].values()].map((f) => this._normal_hits(f, target)[this._attacks_left(f) ? 1 : 0]);
        const own = n ? later : first;
        value += more[2] * (more[1] === "self" ? own : more[1] === "one" ? (per.length ? Math.max(...per) : 0) : sum(per));
      }
      entries.push([t.dotte, value]);
      if (t.unstiff_after_attack) {
        const times = n + (more && more[1] === "self" ? more[2] : 0);
        for (let i = 0; i < times; i++) entries.push([t.dotte, base]);
      }
    }
    entries = entries.map((e, i) => [e, i]).sort((x, y) => -x[0][1] - -y[0][1] || x[1] - y[1]).map(([e]) => e).slice(0, 10);
    const gauge = this._future_gauge(1) + gaugePlus;
    let best = 0;
    for (let mask = 0; mask < 1 << entries.length; mask++) {
      let cost = 0, val = 0;
      entries.forEach((d, i) => {
        if (mask >> i & 1) {
          cost += d[0];
          val += d[1];
        }
      });
      if (cost <= gauge) best = Math.max(best, val);
    }
    return best;
  }

  threat(target, sleepAll = false, sleepAttacker = false, buff = false) {
    if (!this.threat_turn) return [0, 0, 0];
    let memo = this._threats.get(target);
    if (!memo) this._threats.set(target, (memo = new Map()));
    const k = `${sleepAll}|${sleepAttacker}|${buff}`;
    if (!memo.has(k)) memo.set(k, this._threat(target, sleepAll, sleepAttacker, buff));
    return memo.get(k);
  }

  _threat(target, sleepAll, sleepAttacker, buff) {
    if (buff) {
      const [total, rest, dotte] = this.threat(target, sleepAll, sleepAttacker);
      const [single, toAll] = this.opp_buff;
      const hitters = [...this.battle[1].values()].filter((b) => this._attacks_left(b) && this._normal_hits(b, target)[0]).length;
      let extra = hitters ? Math.max(single, toAll * hitters) : 0;
      let gain = this._dotte_max(target, single) - dotte;
      const [g, one, every] = this._opp_tool_potential();
      if (g) gain = Math.max(gain, this._dotte_max(target, 0, g) - dotte);
      const per = [...this.battle[1].values()].map((b) => this._normal_hits(b, target)[this._attacks_left(b) ? 1 : 0]);
      if (one) extra = Math.max(extra, per.length ? Math.max(...per) : 0);
      if (every) extra = Math.max(extra, sum(per));
      if (gain > extra) return [total + gain, rest, dotte + gain];
      return [total + extra, rest + extra, dotte];
    }
    let cur = null;
    let now = 0;
    if (this.incoming !== null) {
      cur = this.incoming[0];
      const asleep = counter(cur, COUNTER_SLEEP) > 0;
      const cut = (sleepAll || sleepAttacker) && !asleep ? 1 : 0;
      if (textOf(this.db, cur.code).half_all) now = Math.floor(Math.max(0, cur.atk - cut) / 2);
      else if (this.incoming[1] === target) now = this.hit_of(cur, target, cur.atk - cut);
    }
    let rest = 0;
    const opened = !this.attackable(target) && this._taunts_fall(target);
    for (const b of this.battle[1].values()) {
      const n = this._attacks_left(b);
      if (!n) continue;
      const asleep = counter(b, COUNTER_SLEEP) > 0;
      const cut = (sleepAll || (sleepAttacker && b === cur)) && !asleep ? 1 : 0;
      const [first, later] = this._normal_hits(b, target, cut, 0, opened);
      rest += first + (n - 1) * later;
    }
    const dotte = this._dotte_max(target) + this.chain_damage(target, true);
    return [now + rest + dotte, rest, dotte];
  }

  lethal_this_turn(c) {
    return this.threat_turn && this.threat(c)[0] >= derived.lethalHp(c);
  }

  _turn_target(o) {
    if (this.incoming !== null) return this.incoming[1];
    const eff = this._effect_of(o);
    if (eff && eff[2] && eff[2].rel === 0 && this._heal_of(eff[0], eff[1])[0]) return eff[2];
    return null;
  }

  _turn_feats(o, target) {
    const [total] = this.threat(target);
    const [totalB] = this.threat(target, false, false, true);
    const lethal = derived.lethalHp(target);
    const dies = total >= lethal, diesB = totalB >= lethal;
    const out = [total / 10.0, b2f(dies), 0.0, 0.0];
    const outB = [totalB / 10.0, b2f(diesB), 0.0, 0.0];
    const eff = this._effect_of(o);
    if (eff === null) return [out, outB];
    const [code, desc, picked] = eff;
    let hp = target.def, acts = false;
    const [amount, , overheal] = this._heal_of(code, desc);
    if (amount && (picked === null || picked === target)) {
      hp += this._heal_on(target, amount, overheal);
      acts = true;
    }
    const status = textOf(this.db, code).enemy_status;
    let sleepAll = false, sleepAtt = false;
    if (status && status[0] === COUNTER_SLEEP && !has(COMMON_HEAL_DESCS, desc)) {
      acts = true;
      sleepAll = status[1];
      sleepAtt = !status[1] && (picked === null || (this.incoming !== null && picked === this.incoming[0]));
    }
    if (!acts) return [out, outB];
    const lethalAfter = derived.lethalHp({ ...target, def: hp });
    const after = this.threat(target, sleepAll, sleepAtt)[0] >= lethalAfter;
    const afterB = this.threat(target, sleepAll, sleepAtt, true)[0] >= lethalAfter;
    out[2] = b2f(dies && !after);
    out[3] = b2f(dies && after);
    outB[2] = b2f(diesB && !afterB);
    outB[3] = b2f(!after && afterB);
    return [out, outB];
  }

  _buff_of(code, desc) {
    const card = this.db.get(code);
    if (!card || !card.is_support || has(COMMON_HEAL_DESCS, desc)) return [0, false];
    if (has(DOTTE_DESCS, desc)) return card.buffDotte;
    if (desc && this.db.describe(desc).includes("공격력")) return card.buffSkill;
    return [0, false];
  }

  is_taunt(c) {
    return !!(c.pos & POS_FACEUP) && !!this.db.get(c.code) && this.db.get(c.code).taunt;
  }

  hand_buffs() {
    if (this._hand_buffs) return this._hand_buffs;
    const out = [];
    for (const c of this.view.cards) {
      if (c.rel !== 0 || c.loc !== LOCATION_HAND) continue;
      const card = this.db.get(c.code);
      if (!card || !card.is_support || !card.handBuff) continue;
      const [n, toAll, once, cost, stiff] = card.handBuff;
      out.push([c.code, n, toAll, once, card.level, cost, stiff]);
    }
    const sorted = out.map((b, i) => [b, i]).sort((x, y) => (y[0][1] - x[0][1]) || (x[0][5] - y[0][5]) || (x[0][4] - y[0][4]) || (x[1] - y[1]))
      .map(([b]) => b);
    return (this._hand_buffs = sorted.slice(0, PLAN_BUFFS));
  }

  hand_tools() {
    if (this._hand_tools) return this._hand_tools;
    const oppField = this._field_cards(1).length;
    const taken = new Map();
    for (const b of this.hand_buffs()) taken.set(b[0], (taken.get(b[0]) || 0) + 1);
    const gauge = [], attack = [];
    for (const c of this.view.cards) {
      if (c.rel !== 0 || c.loc !== LOCATION_HAND) continue;
      const card = this.db.get(c.code);
      if (!card || !card.is_support) continue;
      if (taken.get(c.code)) {
        taken.set(c.code, taken.get(c.code) - 1);
        continue;
      }
      const t = textOf(this.db, c.code);
      if (t.gauge_gain.length) {
        const [n, cost, stiff] = maxBy(t.gauge_gain, (g) => (g[0] > 0 ? g[0] : oppField - g[0]));
        gauge.push([c.code, "gauge", n > 0 ? n : oppField - n, null, card.level, cost, stiff]);
      } else if (t.more_attacks.length) {
        const [who, n, cost, stiff] = t.more_attacks[0];
        attack.push([c.code, "attack", n, who, card.level, cost, stiff]);
      }
    }
    const stable = (list, cmp) => list.map((x, i) => [x, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(([x]) => x);
    const g2 = stable(gauge, (a, b) => (b[2] - a[2]) || (a[5] - b[5]) || (a[4] - b[4]));
    const a2 = stable(attack, (a, b) => ((a[3] !== "all") - (b[3] !== "all")) || (a[5] - b[5]) || (a[4] - b[4]));
    return (this._hand_tools = [...g2.slice(0, PLAN_TOOLS), ...a2.slice(0, PLAN_TOOLS)]);
  }

  defense_cards() {
    const out = [];
    const cards = this.view.cards.filter((c) => c.rel === 0 && c.loc === LOCATION_HAND);
    cards.forEach((c, h) => {
      const card = this.db.get(c.code);
      if (!card || !card.is_support) return;
      const t = textOf(this.db, c.code);
      const status = t.enemy_status;
      const sleep = status && status[0] === COUNTER_SLEEP ? (status[1] ? "all" : "one") : null;
      const code = c.code;
      if (t.heal_single) out.push([h, "heal", t.heal_single, false, t.overheal, card.level, 0, null, code]);
      if (t.heal_all) out.push([h, "heal", t.heal_all, true, t.overheal, card.level, 0, null, code]);
      if (t.dotte_heal_single || t.dotte_heal_all) {
        out.push([h, "heal", t.dotte_heal_all || t.dotte_heal_single, !!t.dotte_heal_all, t.overheal, card.level, t.dotte, sleep, code]);
      } else if (sleep) out.push([h, "sleep", 0, sleep === "all", false, card.level, 0, null, code]);
    });
    return out;
  }

  _my_kill_dotte() {
    const gauge = this.der.players[0].dotte;
    for (const b of this.battle[0].values()) {
      const t = textOf(this.db, b.code);
      if (!t.dotte_hits || t.dotte > gauge || !this._can_dotte(b)) continue;
      for (const e of this.battle[1].values()) {
        const dmg = this.dotte_damage(t, b, e);
        if (dmg >= derived.lethalHp(e) - (t.dotte_weak && !counter(e, COUNTER_WEAK) ? 1 : 0)) return true;
      }
    }
    return false;
  }

  _buff_feats(o) {
    const eff = this._effect_of(o);
    if (eff === null || this.view.turn_player !== 0) return [0.0, 0.0, 0.0, 0.0];
    const [code, desc, picked] = eff;
    const [amount] = this._buff_of(code, desc);
    if (!amount) return [0.0, 0.0, 0.0, 0.0];
    const allies = [...this.battle[0].values()];
    const targets = picked !== null && picked.rel === 0 ? [picked] : allies;
    const ready = targets.filter((a) => this._attacks_left(a) > 0);
    const foes = [...this.battle[1].values()];
    const enemyTaunts = foes.filter((f) => f.pos & POS_FACEUP && this.db.get(f.code) && this.db.get(f.code).taunt);
    const hittable = enemyTaunts.length ? enemyTaunts : foes;
    const kill = ready.some((a) => hittable.some((f) => a.atk < derived.lethalHp(f) && derived.lethalHp(f) <= a.atk + amount));
    return [amount / 3.0, ready.length ? 0.0 : 1.0, b2f(kill), b2f(this._my_kill_dotte())];
  }

  _opp_heals() {
    const p = this.view.players[1];
    return Math.min(OPP_HEALS_MAX, p.hand || 0, this.support_free[1]);
  }

  plan() {
    if (this._plan !== undefined) return this._plan;
    this._plan = null;
    if (this.view.turn_player !== 0 || !has(PLAN_PHASES, this.view.phase) || !this.battle[0].size || !this.battle[1].size) return null;
    const p0 = this.der.players[0];
    const k = key([[0, 1].flatMap((side) => [...this.battle[side].values()].map((c) => [c.seq, c.code, c.atk, c.def,
      this._attacks_left(c), sortedCounters(c)])),
    p0.dotte, p0.margin, this.support_free[0], this.hand_buffs(), this.hand_tools(), this._opp_heals(),
    this._counters_pending(0), this.view.players[1].hand || 0, this.view.players[0].hand || 0]);
    let hit = PLANS.get(k);
    if (hit === undefined) {
      const p = new Plan(this);
      const s = p.start(this._opp_heals());
      hit = [p, s, p.best(s), p.best(p.start(0))];
      if (PLANS.size >= 64) PLANS.clear();
      PLANS.set(k, hit);
    }
    this._plan = hit;
    return hit;
  }

  _plan_action_value(o) {
    const pl = this.plan();
    if (pl === null || (o.card === null && !has([K_IDLE_TO_BP, K_IDLE_TO_EP, K_BATTLE_TO_EP, K_BATTLE_TO_M2], o.kind))) return null;
    const [p, s, best] = pl;
    if (o.kind === K_IDLE_TO_BP) return best;
    if (has([K_IDLE_TO_EP, K_BATTLE_TO_EP, K_BATTLE_TO_M2], o.kind)) return [0, 0];
    const mine = new Map(p.mine.map((c, i) => [c.seq, i]));
    const foes = new Map(p.foes.map((c, i) => [c.seq, i]));
    const [code, con, loc, seq] = o.card;
    const rel = con === this.me ? 0 : 1;
    const top = (match) => {
      const vals = p.actions(s).filter(match).map((a) => p.value(s, a));
      return vals.length ? maxBy(vals, (v) => v) : null;
    };
    const buffIndex = (cardCode) => {
      const k = p.buffs.findIndex((b) => b[0] === cardCode);
      return k < 0 ? null : k;
    };
    if (o.kind === K_BATTLE_ATTACK && rel === 0 && loc === LOCATION_MZONE && mine.has(seq)) {
      const a = mine.get(seq);
      return top((act) => act[0] === "attack" && act[1] === a && act[3] === null);
    }
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0 && loc === LOCATION_MZONE && mine.has(seq) && has(DAMAGE_DESCS, o.desc)) {
      const b = mine.get(seq);
      return top((act) => act[0] === "dotte" && act[1] === b);
    }
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0 && loc === LOCATION_HAND && this._buff_of(code, o.desc)[0]) {
      const k = buffIndex(code);
      return k === null ? null : top((act) => act[0] === "attack" && act[3] === k);
    }
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0 && loc === LOCATION_HAND && !has(COMMON_HEAL_DESCS, o.desc)
      && p.tools.some((t) => t[0] === code)) {
      return top((act) => act[0] === "tool" && p.tools[act[1]][0] === code);
    }
    if (o.kind === K_CARD_PICK && this.ctx && this.ctx[1] && loc === LOCATION_MZONE) {
      const [kind, ccard, cdesc] = this.ctx;
      if (kind === K_BATTLE_ATTACK && rel === 1 && foes.has(seq) && mine.has(ccard[3])) {
        const a = mine.get(ccard[3]), e = p.same_as(s, foes.get(seq));
        const anyone = p.half[a] || s[14][a];
        return top((act) => act[0] === "attack" && act[1] === a && (anyone || act[2] === e) && act[3] === null);
      }
      if (ACTIVATE_KINDS.has(kind) && rel === 1 && foes.has(seq) && ccard[2] === LOCATION_MZONE && mine.has(ccard[3])
        && has(DAMAGE_DESCS, cdesc)) {
        const b = mine.get(ccard[3]), e = p.same_as(s, foes.get(seq));
        return top((act) => act[0] === "dotte" && act[1] === b && act[2] === e);
      }
      if (ACTIVATE_KINDS.has(kind) && rel === 0 && mine.has(seq) && this._buff_of(ccard[0], cdesc)[0]) {
        const k = buffIndex(ccard[0]), a = mine.get(seq);
        return k === null ? null : top((act) => act[0] === "attack" && act[1] === a && act[3] === k);
      }
    }
    return null;
  }

  _plan_may_use(o) {
    if (o.card === null) return has([K_IDLE_TO_BP, K_IDLE_TO_EP, K_BATTLE_TO_EP, K_BATTLE_TO_M2], o.kind);
    const [code, con, loc] = o.card;
    const rel = con === this.me ? 0 : 1;
    if (o.kind === K_BATTLE_ATTACK) return rel === 0 && loc === LOCATION_MZONE;
    if (ACTIVATE_KINDS.has(o.kind)) {
      if (rel !== 0) return false;
      if (loc === LOCATION_MZONE) return has(DAMAGE_DESCS, o.desc);
      return loc === LOCATION_HAND && (!!this._buff_of(code, o.desc)[0]
        || (!has(COMMON_HEAL_DESCS, o.desc) && this.hand_tools().some((t) => t[0] === code)));
    }
    if (o.kind === K_CARD_PICK) return !!(this.ctx && this.ctx[1]) && loc === LOCATION_MZONE;
    return false;
  }

  _plan_needed() {
    if (this._plan_need === undefined) this._plan_need = this.decision.options.some((o) => this._plan_may_use(o));
    return this._plan_need;
  }

  _plan_feats(o) {
    if (!this._plan_needed()) return Array(6).fill(0.0);
    const pl = this.plan();
    const v = pl !== null ? this._plan_action_value(o) : null;
    if (v === null) return Array(6).fill(0.0);
    const [, , best, free] = pl;
    return [b2f(v[0] >= best[0] - 1e-6), best[1] / 3.0, free[1] / 3.0, v[1] / 3.0, Math.max(0, best[1] - v[1]) / 3.0, 1.0];
  }

  defense() {
    if (this._defense !== undefined) return this._defense;
    this._defense = null;
    const what = this.incoming || this.incoming_dotte;
    if (what === null || !this.threat_turn) return null;
    const k = key(["def", [0, 1].flatMap((side) => [...this.battle[side].values()].map((c) => [side, c.seq, c.code, c.atk,
      c.def, this._attacks_left(c), c.pos, sortedCounters(c)])),
    this.der.players[0].dotte, this.der.players[1].dotte, this.der.players[0].margin, this.support_free[0],
    this.view.cards.filter((c) => c.rel === 0 && c.loc === LOCATION_HAND).map((c) => c.code).sort((a, b) => a - b),
    this.opp_buff, this.incoming !== null, what[0].seq, what[1] ? what[1].seq : null]);
    let hit = PLANS.get(k);
    if (hit === undefined) {
      const out = [];
      for (const hidden of [false, true]) {
        const d = new Defense(this, hidden, this.incoming ? null : what[0]);
        let s = d.start();
        const b = d.foes.findIndex((c) => c === what[0]);
        const ti = d.mine.findIndex((c) => c === what[1]);
        const t = ti < 0 ? null : ti;
        let move;
        if (this.incoming !== null) {
          s = [...s.slice(0, 7), s[7].map((x, i) => (i === b ? x + 1 : x)), s[8].map((x, i) => (i === b ? true : x)), ...s.slice(9)];
          move = ["attack", b, t, false];
        } else {
          s = [...s.slice(0, 10), s[10] + d.dottes[b][0], ...s.slice(11)];
          move = ["dotte", b, t, null];
        }
        out.push([d, s, move, d.exchange(s, move, [[], new Map(), false, null])]);
      }
      hit = out;
      if (PLANS.size >= 64) PLANS.clear();
      PLANS.set(k, hit);
    }
    this._defense = hit;
    return hit;
  }

  _defense_value(o, d, s, move) {
    if (o.kind === K_CHAIN_PASS) return d.exchange(s, move, [[], new Map(), false, null]);
    const eff = this._effect_of(o);
    if (eff === null) return null;
    const [code, desc, picked] = eff;
    const cleanse = this._is_cleanse_option(code, desc);
    const heal = this._heal_of(code, desc)[0] > 0;
    const status = textOf(this.db, code).enemy_status;
    const sleep = !!status && status[0] === COUNTER_SLEEP && !has(COMMON_HEAL_DESCS, desc);
    let target = null;
    if (picked !== null && picked.rel === 0) {
      const i = d.mine.findIndex((c) => c.seq === picked.seq);
      target = i < 0 ? null : i;
    }
    const vals = [];
    for (const a of d.answers(s, move)) {
      const used = a[0];
      if (cleanse) {
        if (used.includes("cleanse")) vals.push(d.exchange(s, move, a));
        continue;
      }
      if (!used.length || used[0] === "cleanse" || d.cards[used[0]][8] !== code) continue;
      const kind = d.cards[used[0]][1];
      if ((heal && kind !== "heal") || (sleep && !heal && kind !== "sleep")) continue;
      if (target !== null && !a[1].has(target)) continue;
      vals.push(d.exchange(s, move, a));
    }
    return vals.length ? minBy(vals, (v) => v[0]) : null;
  }

  _defense_feats(o) {
    const dd = this.defense();
    if (dd === null) return Array(6).fill(0.0);
    const [[d, s, move, passed], [dB, sB, mB]] = dd;
    const v = this._defense_value(o, d, s, move);
    if (v === null) return Array(6).fill(0.0);
    const best = minBy(d.answers(s, move).map((a) => d.exchange(s, move, a)), (x) => x[0]);
    const vb = this._defense_value(o, dB, sB, mB) || v;
    return [b2f(v[0] <= best[0] + 1e-6), v[1] / 3.0, passed[1] / 3.0, best[1] / 3.0, vb[1] / 3.0, 1.0];
  }

  _combo_feats(o) {
    const eff = this._effect_of(o);
    if (eff === null) return [0.0, 0.0];
    const [code, desc, picked] = eff;
    const allies = [...this.battle[0].values()];
    const unhappy = allies.filter((c) => counter(c, COUNTER_NO_HEAL) > 0);
    if (!unhappy.length) return [0.0, 0.0];
    const [amount] = this._heal_of(code, desc);
    if (amount && (picked === null || (picked.rel === 0 && unhappy.some((c) => c === picked)))) {
      const cleanses = [...this.hand_cleanses];
      const fromHand = ACTIVATE_KINDS.has(o.kind) && o.card && o.card[2] === LOCATION_HAND;
      if (fromHand && cleanses.includes(code)) cleanses.splice(cleanses.indexOf(code), 1);
      if (cleanses.length && this._supports_room(fromHand ? 2 : 1)) return [1.0, 0.0];
      return [0.0, 0.0];
    }
    if (this._is_cleanse_option(code, desc)) {
      const onChain = (this.view.chain || []).some((ch) => ch.rel === 0 && this.db.get(ch.code) && this.db.get(ch.code).is_support
        && (textOf(this.db, ch.code).heal_single || textOf(this.db, ch.code).heal_all));
      const heals = this.hand_heals.filter((h) => h !== code);
      return [0.0, onChain ? 1.0 : (heals.length && this._supports_room(2) ? 0.5 : 0.0)];
    }
    return [0.0, 0.0];
  }

  _can_heal(rel) {
    const p = this.view.players[rel];
    if ((p.hand || 0) <= 0) return false;
    if (supportFree(this.view, rel) <= 0) return false;
    return p.summoner_code === 10050110 || this.der.players[rel].margin >= 1;
  }

  _missing(c) {
    return Math.max(0, c.base_def - c.def);
  }

  _heal_on(c, amount, overheal) {
    if (counter(c, COUNTER_NO_HEAL) > 0) return 0;
    return overheal ? amount : Math.min(amount, this._missing(c));
  }

  _heal_of(code, desc) {
    const t = textOf(this.db, code);
    if (desc === ALL_HEAL_DESC) return [t.heal_all, true, t.overheal];
    if (desc === SINGLE_HEAL_DESC || desc === 0) return [t.heal_single, false, t.overheal];
    if (has(DOTTE_DESCS, desc)) {
      if (t.dotte_heal_all) return [t.dotte_heal_all, true, t.overheal];
      return [t.dotte_heal_single, false, t.overheal];
    }
    return [0, false, false];
  }

  _opp_heal_after(target, hpAfter, killed) {
    if (killed || !this.can_heal[target.rel] || counter(target, COUNTER_NO_HEAL) > 0) return 0;
    return Math.min(OPP_HEAL_GUESS, Math.max(0, target.base_def - hpAfter));
  }

  _hit(atk, target) {
    const hp = target.def;
    const killed = atk >= derived.lethalHp(target);
    const hpAfter = killed ? 0 : Math.max(0, hp - atk);
    return [Math.min(atk, hp), hpAfter, killed, Math.max(0, atk - hp), this._opp_heal_after(target, hpAfter, killed)];
  }

  _field_attrs(rel, skip = null) {
    let out = 0;
    for (const c of this.view.cards) {
      if (c === skip || c.rel !== rel || !(c.pos & POS_FACEUP) || !c.code) continue;
      if ((c.loc === LOCATION_MZONE && c.seq < 5) || c.loc === LOCATION_SZONE) {
        const card = this.db.get(c.code);
        out |= card ? card.attribute : 0;
      }
    }
    return out;
  }

  enables_kill(code) {
    const card = this.db.get(code);
    if (!card || this.view.turn_player !== 0 || this.der.players[0].dotte < 2) return false;
    const hand = this.view.cards.filter((c) => c.rel === 0 && c.loc === LOCATION_HAND).map((c) => c.code);
    if (hand.includes(code)) hand.splice(hand.indexOf(code), 1);
    const oppAttrs = this._field_attrs(1);
    for (const b of this.battle[0].values()) {
      const rule = ATTRIBUTE_ENABLERS[b.code];
      if (!rule || !(card.attribute & rule[0]) || b.pos & POS_DEFENSE) continue;
      if (this._field_attrs(0, b) & rule[0]) continue;
      if (hand.some((h) => this.db.get(h) && this.db.get(h).attribute & rule[0])) continue;
      const base = rule[1](oppAttrs);
      if ([...this.battle[1].values()].some((t) => base < derived.lethalHp(t) && derived.lethalHp(t) <= base + 1)) return true;
    }
    return false;
  }

  useless_heals(options, extras) {
    const out = Array(options.length).fill(false);
    const ctxCommon = !!this.ctx && has(COMMON_HEAL_DESCS, this.ctx[2]);
    const picks = options.map((o, i) => [o, extras[i]]).filter(([o, e]) => o.kind === K_CARD_PICK && e[0]).map(([, e]) => e[1]);
    const bestTarget = picks.length ? Math.max(...picks) : 0.0;
    options.forEach((o, i) => {
      const e = extras[i];
      if (!e[0] || e[1] > 0 || e[24] > 0) return;
      if (ACTIVATE_KINDS.has(o.kind) && has(COMMON_HEAL_DESCS, o.desc)) out[i] = !this.enables_kill(o.card[0]);
      else if (o.kind === K_CARD_PICK && ctxCommon) out[i] = bestTarget > 0;
    });
    return out;
  }

  option(o) {
    const out = this._option_core(o);
    if (this.incoming !== null) {
      const [attacker, target] = this.incoming;
      const lethal = attacker.atk >= derived.lethalHp(target);
      out[8] = b2f(lethal);
      out[9] = attacker.atk / 5.0;
      const still = this._incoming_after(o);
      if (still !== null) {
        out[10] = b2f(lethal && !still);
        out[11] = lethal ? 0.0 : 1.0;
        out[12] = b2f(lethal && still);
      }
    }
    out[13] = this._status_dup(o);
    out.splice(14, 6, ...this._dotte_damage_feats(o));
    const target = this.threat_turn ? this._turn_target(o) : null;
    if (target !== null) {
      const [a, b] = this._turn_feats(o, target);
      out.splice(20, 4, ...a);
      out.splice(32, 4, ...b);
      const [, rest, dotte] = this.threat(target);
      out[26] = rest / 10.0;
      out[27] = dotte / 10.0;
    }
    out.splice(24, 2, ...this._combo_feats(o));
    out.splice(28, 4, ...this._buff_feats(o));
    out.splice(36, 6, ...this._plan_feats(o));
    out.splice(42, 6, ...this._defense_feats(o));
    return out;
  }

  _field_cards(rel) {
    return this.view.cards.filter((c) => c.rel === rel && c.pos & POS_FACEUP && c.code
      && ((c.loc === LOCATION_MZONE && c.seq < 5) || c.loc === LOCATION_SZONE));
  }

  _bonus(t, attacker, target, opt, atkBonus = 0) {
    let extra = 0;
    const rel = attacker.rel;
    const mine = this._field_cards(rel);
    const battle = [...this.battle[rel].values()];
    for (const [name, g] of t.dotte_rules) {
      const v = g.map((x) => (/^\d+$/.test(x) ? Number(x) : x));
      if (name === "my_battle_ge" && battle.length >= v[0]) extra += v[1];
      else if (name === "my_field_ge" && mine.length >= v[0]) extra += v[1];
      else if (name === "target_status" && counter(target, STATUS_COUNTERS[v[0]]) > 0) extra += v[1];
      else if (name === "target_class") {
        const card = this.db.get(target.code);
        if (card && card.class_index < CLASS_RACES.length && CLASS_NAMES[CLASS_RACES[card.class_index]] === v[0]) extra += v[1];
      } else if (name === "target_attr") {
        const card = this.db.get(target.code);
        if (card && ATTRIBUTE_NAMES[card.attribute] === v[0]) extra += v[1];
      } else if (name === "opp_hand_ge" && (this.view.players[1 - rel].hand || 0) >= v[0]) extra += v[1];
      else if (name === "no_mage" && !battle.some((c) => this.db.get(c.code) && this.db.get(c.code).class_index === 1)) extra += v[0];
      else if (name === "no_support" && !mine.some((c) => c.loc === LOCATION_SZONE)) extra += v[0];
      else if (name === "other_attr" && mine.some((c) => c !== attacker && this.db.get(c.code)
        && ATTRIBUTE_NAMES[this.db.get(c.code).attribute] === v[0])) extra += v[1];
      else if (name === "self_hp_le_minus" && attacker.def <= v[0]) extra -= v[1];
      else if (name === "self_hp_ge" && attacker.def >= v[0]) extra += v[1];
      else if (name === "self_hp_or_atk" && (attacker.def >= v[0] || attacker.atk + atkBonus >= v[1])) extra += v[2];
      else if (name === "sanct_higher" && this.der.players[rel].sanctuary > this.der.players[1 - rel].sanctuary) extra += v[0];
    }
    const code = attacker.code;
    if (code === PROFESSOR) {
      const attrs = new Set(mine.filter((c) => this.db.get(c.code)).map((c) => this.db.get(c.code).attribute));
      extra += this._field_cards(1 - rel).filter((f) => attrs.has(this.db.get(f.code).attribute)).length;
    } else if (ATTRIBUTE_ENABLERS[code]) {
      const rule = ATTRIBUTE_ENABLERS[code];
      if (code === SHINOBU) {
        extra += rule[1](this._field_attrs(1 - rel)) - 1;
        if (this._field_attrs(rel, attacker) & rule[0]) extra += 1;
      }
    }
    if (opt) {
      const free = battle.filter((c) => c !== attacker && !(c.pos & POS_DEFENSE));
      for (const [name, g] of t.dotte_options) {
        const v = g.map(Number);
        if (name === "opt_stiff" && free.length >= v[0]) {
          extra += v[1];
          break;
        }
        if (name === "opt_stiff_each") extra += v[0] * free.length;
        else if (name === "opt_gauge" && this.der.players[rel].dotte >= t.dotte + v[0]) extra += v[1];
      }
    }
    return extra;
  }

  _dotte_damage_feats(o) {
    const zero = Array(6).fill(0.0);
    if (o.card === null || o.noop || NOOP_DESCS.has(o.desc)) return zero;
    const [, con, loc, seq] = o.card;
    const rel = con === this.me ? 0 : 1;
    let attacker, picked;
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0 && loc === LOCATION_MZONE && has(DAMAGE_DESCS, o.desc)) {
      attacker = this.battle[0].get(seq) || null;
      picked = null;
    } else if (o.kind === K_CARD_PICK && this.ctx && ACTIVATE_KINDS.has(this.ctx[0]) && this.ctx[1]
      && has(DAMAGE_DESCS, this.ctx[2]) && this.ctx[1][2] === LOCATION_MZONE && loc === LOCATION_MZONE && rel === 1) {
      attacker = this.battle[0].get(this.ctx[1][3]) || null;
      picked = this.battle[1].get(seq) || null;
      if (picked === null) return zero;
    } else return zero;
    if (attacker === null) return zero;
    const t = textOf(this.db, attacker.code);
    if (!t.dotte_hits) return zero;
    const foes = [...this.battle[1].values()];
    if (!foes.length) return zero;
    const hits = (opt) => foes.map((f) => [f, this.dotte_damage(t, attacker, f, opt)]);
    const base = hits(false), full = hits(true);
    const hasOpt = t.dotte_options.length > 0;
    if (picked !== null || !t.dotte_to_all) {
      const best = (hs) => {
        if (picked !== null) return hs.find((h) => h[0] === picked);
        return maxBy(hs, (h) => [h[1] >= derived.lethalHp(h[0]) ? 1 : 0, -Math.abs(h[1] - derived.lethalHp(h[0]))]);
      };
      const [f, dmg] = best(base);
      const kill = dmg >= derived.lethalHp(f);
      const [f2, dmg2] = best(full);
      const removed = t.dotte_to_all ? sum(base.map(([h, d]) => Math.min(d, h.def))) : Math.min(dmg, f.def);
      return [dmg / 5.0, b2f(kill), kill ? Math.max(0, dmg - f.def) / 5.0 : 0.0, hasOpt ? dmg2 / 5.0 : 0.0,
        b2f(hasOpt && dmg2 >= derived.lethalHp(f2)), removed / 10.0];
    }
    const kills = base.filter(([h, d]) => d >= derived.lethalHp(h)).length;
    const kills2 = full.filter(([h, d]) => d >= derived.lethalHp(h)).length;
    const dmg = Math.max(...base.map(([, d]) => d));
    return [dmg / 5.0, kills / 3.0, 0.0, hasOpt ? Math.max(...full.map(([, d]) => d)) / 5.0 : 0.0,
      hasOpt ? kills2 / 3.0 : 0.0, sum(base.map(([h, d]) => Math.min(d, h.def))) / 10.0];
  }

  _effect_of(o) {
    if (o.card === null || o.noop || NOOP_DESCS.has(o.desc)) return null;
    const [code, con, loc, seq] = o.card;
    const rel = con === this.me ? 0 : 1;
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0) return [code, o.desc, null];
    if (o.kind === K_CARD_PICK && this.ctx && ACTIVATE_KINDS.has(this.ctx[0]) && this.ctx[1] && loc === LOCATION_MZONE) {
      return [this.ctx[1][0], this.ctx[2], this.battle[rel].get(seq) || null];
    }
    return null;
  }

  _incoming_after(o) {
    const eff = this._effect_of(o);
    if (eff === null) return null;
    const [code, desc, picked] = eff;
    const [attacker, target] = this.incoming;
    let hp = target.def, atk = attacker.atk, acts = false;
    const [amount, , overheal] = this._heal_of(code, desc);
    if (amount && (picked === null || picked === target)) {
      hp += this._heal_on(target, amount, overheal);
      acts = true;
    }
    const status = textOf(this.db, code).enemy_status;
    if (status && status[0] === COUNTER_SLEEP && !has(COMMON_HEAL_DESCS, desc) && (picked === null || picked === attacker)) {
      acts = true;
      if (counter(attacker, COUNTER_SLEEP) === 0) atk = Math.max(0, atk - 1);
    }
    if (!acts) return null;
    return atk >= derived.lethalHp({ ...target, def: hp });
  }

  _status_dup(o) {
    const eff = this._effect_of(o);
    if (eff === null) return 0.0;
    const [code, desc, picked] = eff;
    const status = textOf(this.db, code).enemy_status;
    if (!status || has(COMMON_HEAL_DESCS, desc)) return 0.0;
    const [cnt, , turns] = status;
    if (picked !== null) return b2f(picked.rel === 1 && counter(picked, cnt) >= turns);
    const foes = [...this.battle[1].values()];
    if (!foes.length) return 0.0;
    return foes.filter((f) => counter(f, cnt) >= turns).length / foes.length;
  }

  _option_core(o) {
    const out = Array(OPTION_EXTRA_DIM).fill(0.0);
    if (o.card === null) return out;
    const [code, con, loc, seq] = o.card;
    const rel = con === this.me ? 0 : 1;
    const allies = [...this.battle[0].values()];
    if (ACTIVATE_KINDS.has(o.kind) && rel === 0) {
      const [amount, toAll, overheal] = this._heal_of(code, o.desc);
      if (amount && allies.length) {
        const gains = allies.map((c) => this._heal_on(c, amount, overheal));
        const gain = toAll ? sum(gains) : Math.max(...gains);
        out.splice(0, 3, 1.0, gain / 5.0, b2f(gain === 0));
      }
    } else if (o.kind === K_CARD_PICK && this.ctx && loc === LOCATION_MZONE) {
      const [kind, ccard, cdesc] = this.ctx;
      const target = this.battle[rel].get(seq) || null;
      if (target === null || !ccard) return out;
      if (ACTIVATE_KINDS.has(kind) && rel === 0) {
        const [amount, toAll, overheal] = this._heal_of(ccard[0], cdesc);
        if (amount && !toAll) {
          const gain = this._heal_on(target, amount, overheal);
          out.splice(0, 3, 1.0, gain / 5.0, b2f(gain === 0));
        }
      } else if (kind === K_BATTLE_ATTACK && rel === 1) {
        const attacker = ccard[2] === LOCATION_MZONE ? this.battle[0].get(ccard[3]) || null : null;
        if (attacker !== null) {
          const [dmg, left, killed, over, back] = this._hit(attacker.atk, target);
          out.splice(3, 5, dmg / 5.0, left / 10.0, b2f(killed), over / 5.0, back / 5.0);
        }
      }
    } else if (o.kind === K_BATTLE_ATTACK && rel === 0 && loc === LOCATION_MZONE) {
      const attacker = this.battle[0].get(seq) || null;
      const foes = [...this.battle[1].values()];
      if (attacker !== null && foes.length) {
        const hits = foes.map((f) => this._hit(attacker.atk, f));
        const survivors = hits.filter((h) => !h[2]);
        out[3] = attacker.atk / 5.0;
        out[5] = b2f(hits.some((h) => h[2]));
        out[7] = survivors.length ? Math.min(...survivors.map((h) => h[4])) / 5.0 : 0.0;
      }
    }
    return out;
  }
}

export const SANCTUARY_HINT = sid(10050112, 5);
const SANCTUARY_RULE_HAND_OPP = 5;
const SANCTUARY_RULE_HAND_OWN = 8;
const SANCTUARY_RULE_LIMIT = 10;
const SANCTUARY_KEEP_BATTLE = 2;

/** features.sanctuary_rule: changes decision.options in place */
export function sanctuaryRule(view, decision, db) {
  if (decision.hint !== SANCTUARY_HINT || decision.msg !== MSG_SELECT_CARD || view.phase !== PHASE_DRAW) return;
  if ((view.players[0].summoner_def || 0) >= SANCTUARY_RULE_LIMIT) return;
  const own = view.turn_player === 0;
  const codes = view.cards.filter((c) => c.rel === 0 && c.loc === LOCATION_HAND).map((c) => c.code);
  const hand = sum(codes.map((c) => (!own && textOf(db, c).draw >= 2 ? 2 : 1)));
  let picks = decision.options.filter((o) => o.kind === K_CARD_PICK);
  if (hand < (own ? SANCTUARY_RULE_HAND_OWN : SANCTUARY_RULE_HAND_OPP) || !picks.length) return;
  const battle = (o) => {
    const card = o.card ? db.get(o.card[0]) : null;
    return !!card && card.is_battle;
  };
  if (codes.filter((c) => db.get(c) && db.get(c).is_battle).length <= SANCTUARY_KEEP_BATTLE) {
    const p = picks.filter((o) => !battle(o));
    picks = p.length ? p : picks;
  }
  decision.options = picks;
}

/** features.encode (after sanctuaryRule on decision.options): { g, cards, card_codes, opts, opt_ids, noop, hint } */
export function encode(view, decision, db) {
  sanctuaryRule(view, decision, db);
  const der = derived.compute(view, db);
  const vocab = db.vocab, cardIds = db.cardVocab;
  let tokens = view.cards.filter((c) => TOKEN_LOCS.includes(c.loc) && !(c.loc === LOCATION_EXTRA && !(c.pos & POS_FACEUP)));
  const rank = (c) => [!(c.loc === LOCATION_MZONE || c.loc === LOCATION_SZONE) ? 1 : 0, c.loc === LOCATION_GRAVE ? 1 : 0];
  tokens = tokens.map((c, i) => [c, i]).sort((x, y) => {
    const a = rank(x[0]), b = rank(y[0]);
    return a[0] - b[0] || a[1] - b[1] || x[1] - y[1];
  }).map(([c]) => c).slice(0, MAX_CARD_TOKENS);
  const index = new Map();
  const cards = [], codes = [];
  tokens.forEach((c, i) => {
    index.set(`${c.rel},${c.loc},${c.seq}`, i);
    const dc = der.cards.get(c);
    const f = [b2f(c.rel === 0), b2f(c.rel === 1), ...locOnehot(c.loc, c.seq), c.seq / 7.0,
      b2f(c.pos & POS_FACEUP), b2f(c.pos & POS_DEFENSE),
      c.atk / 10.0, c.def / 10.0, c.base_def / 10.0, c.level / 3.0, c.overlay / 10.0,
      ...cardStatic(db, c.code), ...TRACKED_COUNTERS.map((k) => Math.min(counter(c, k), 5) / 5.0)];
    if (dc) f.push(b2f(dc.killable_single), b2f(dc.killable_total), dc.lethal_hp / 10.0, b2f(dc.bound));
    else f.push(0.0, 0.0, 0.0, 0.0);
    cards.push(f);
    codes.push(cardIds.get(c.code) || 0);
  });
  const phase = view.phase || 0;
  const g = PHASES.map((ph) => b2f(phase === ph));
  g.push(b2f(!PHASES.includes(phase)));
  g.push(b2f(view.turn_player === 0), Math.min(view.turn || 0, 40) / 20.0);
  g.push(...MSG_TYPES.map((m) => b2f(decision.msg === m)));
  const picked = decision.picked ? decision.picked.length : 0;
  g.push(Math.min(decision.min, 10) / 5.0, Math.min(decision.max, 10) / 5.0, picked / 5.0);
  const removed = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  for (const c of view.cards) {
    if (c.loc === LOCATION_REMOVED && c.code) {
      const card = db.get(c.code);
      if (card && card.class_index < 5) removed[c.rel][card.class_index] += 1;
    }
  }
  for (const rel of [0, 1]) g.push(...playerFeats(view.players[rel], der.players[rel], removed[rel]));
  g.push(der.advantage / 10.0, b2f(der.realist), b2f(der.mid), b2f(der.in_battle), (view.chain || []).length / 5.0);

  const hintCode = descCode(decision.hint);
  const tactics = new Tactics(view, decision, db, der);
  const mine = [...tactics.battle[0].values()];
  const short = tactics.threat_turn && mine.length
    ? Math.max(...mine.map((c) => tactics.threat(c)[0] - derived.lethalHp(c))) : 0;
  g.push(tactics.slots_used[0] / 5.0, tactics.slots_used[1] / 5.0,
    mine.filter((c) => tactics.lethal_this_turn(c)).length / 3.0, Math.max(-10, Math.min(10, short)) / 10.0,
    b2f(tactics.can_heal[0]), b2f(tactics.can_heal[1]), tactics.opp_buff[0] / 3.0, tactics.opp_buff[1] / 3.0);
  const extras = decision.options.map((o) => tactics.option(o));
  const useless = tactics.useless_heals(decision.options, extras);
  let noop = decision.options.map((o, i) => (o.noop || useless[i] ? 1 : 0));
  const opts = [], optIds = [];
  decision.options.forEach((o, i) => {
    let f = [0.0, 0.0];
    let cardVocab = 0, ptr = 0;
    if (o.card !== null) {
      const [code, con, loc, seq] = o.card;
      const rel = con === view.me ? 0 : 1;
      f = [b2f(rel === 0), b2f(rel === 1), ...locOnehot(loc & 0x7f, seq), Math.min(seq, 7) / 7.0];
      cardVocab = cardIds.get(code) || 0;
      ptr = (index.has(`${rel},${loc},${seq}`) ? index.get(`${rel},${loc},${seq}`) : -1) + 1;
    } else f.push(...Array(CARD_LOCS.length).fill(0.0), 0.0);
    const desc = [0, 1, 2, 3, 4].includes(o.kind) ? 0 : o.desc;
    let dcode = descCode(desc), didx = descIndex(desc);
    if (o.kind === 23) {
      f.push(Math.min(desc, 20) / 10.0, 0.0, Number(o.extra), b2f(hintCode));
      dcode = 0;
      didx = 0;
    } else f.push(0.0, b2f(dcode === 0 && desc), Number(o.extra), b2f(hintCode));
    f.push(noop[i]);
    f.push(...extras[i]);
    opts.push(f);
    optIds.push([o.kind, cardVocab, vocab.get(dcode) || 0, dcode ? Math.min(didx, 31) : 0, ptr]);
  });
  if (noop.every((x) => x)) noop = noop.map(() => 0);
  return { g, cards, card_codes: codes, opts, opt_ids: optIds, noop,
    hint: [vocab.get(hintCode) || 0, hintCode ? descIndex(decision.hint) : 0] };
}
