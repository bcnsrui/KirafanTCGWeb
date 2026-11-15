/* kirafan_ai.model.tactical: the look-ahead over the rest of our turn (Plan) and of the opponent's attacks
 * (Defense). A line-for-line port: states are arrays used as Python's tuples (compared and remembered by value,
 * key()), the order actions and answers come in is Python's, so the search budget cuts it at the same place. */
import { POS_DEFENSE, COUNTER_BIND, COUNTER_SLEEP, COUNTER_WEAK, textOf } from "./data.js";
import { counter } from "./derived.js";

const COUNTER_ALL_ATTACK = 0xc04;

export const OPP_HEAL = 4;
const OPP_ALL_HEAL = 2;
const OPP_OVER_HEAL = 3;
const OPP_OVER_ALL = 2;
export const OPP_HEALS_MAX = 2;
const OPP_HEAL_LEVEL = 1;
const OPP_OVER_ALL_LEVEL = 2;
const OPP_SLEEP_LEVEL = 1;
const OPP_SLEEP_ALL_LEVEL = 2;
const OPP_KISARAGI_GAUGE = 2;
const OPP_CLEANSE_LEVEL = 1;
const KILL = 1000;
const CARD = 15;
const GAUGE = 3;
const CHIP = 3;
const DRAW = 3;
const DRAW_HAND = 6;
const MAX_STATES = 1500;
const PLAN_STATES = 600;

export const key = (x) => JSON.stringify(x);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const replaceAt = (t, i, v) => t.map((x, j) => (j === i ? v : x));

/** Python's tuple comparison of two equal-length lists of numbers */
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

/** min(items, key=f) / max(...): the first of the smallest / largest */
export function minBy(items, f) {
  let best = null, bk = null;
  for (const it of items) {
    const k = f(it);
    if (best === null || lexLess([].concat(k), [].concat(bk))) {
      best = it;
      bk = k;
    }
  }
  return best;
}

export function maxBy(items, f) {
  let best = null, bk = null;
  for (const it of items) {
    const k = f(it);
    if (best === null || lexLess([].concat(bk), [].concat(k))) {
      best = it;
      bk = k;
    }
  }
  return best;
}

/** itertools.combinations(items, n) */
function combinations(items, n) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

const SLEEP_RANK = { null: 0, one: 1, all: 2 };

export class Plan {
  constructor(tac) {
    this.tac = tac;
    this.mine = [...tac.battle[0].values()];
    this.foes = [...tac.battle[1].values()];
    this.taunt = this.foes.map((f) => tac.is_taunt(f));
    this.untouchable = this.foes.map((f) => textOf(tac.db, f.code).not_attackable);
    const texts = this.mine.map((a) => textOf(tac.db, a.code));
    const powers = this.mine.map((a) => tac.attack_of(a));
    this.atk0 = powers.map((p) => p[0]);
    this.once0 = powers.map((p) => p[1]);
    this.half = texts.map((t) => t.half_all);
    this.unstiff = texts.map((t) => t.unstiff_after_attack);
    this.attack_gauge = texts.map((t) => t.attack_gauge);
    this.attack_weak = texts.map((t) => t.attack_weak);
    this.vs = this.mine.map((a) => this.foes.map((f) => tac.hit_of(a, f, 0)));
    this.dottes = [];
    this.mine.forEach((b, i) => {
      const t = texts[i];
      if (t.dotte_hits) {
        const v = t.dotte_var && t.dotte_var[1] === "opp_battle" ? this.foes.length : 0;
        const dmg = this.foes.map((f) => tac.dotte_damage(t, b, f));
        let opt = null;
        if (t.dotte_options.length) {
          const extraG = sum(t.dotte_options.filter(([name]) => name === "opt_gauge").map(([, v]) => Number(v[0])));
          let extraS = sum(t.dotte_options.filter(([name]) => name === "opt_stiff").map(([, v]) => Number(v[0])));
          if (t.dotte_options.some(([name]) => name === "opt_stiff_each")) {
            extraS = this.mine.filter((c) => c !== b && !(c.pos & POS_DEFENSE)).length;
          }
          const dmgOpt = this.foes.map((f) => tac.dotte_damage(t, b, f, true));
          opt = key(dmgOpt) !== key(dmg) ? [extraG, extraS, dmgOpt] : null;
        }
        this.dottes.push([t.dotte, t.dotte_to_all, dmg, tac.db.get(b.code) ? tac.db.get(b.code).draws : 0, t.dotte_weak,
          [t.dotte_self_atk, t.dotte_self_atk_opp], t.dotte_more_attacks, t.dotte_stiff, v, opt]);
      } else this.dottes.push(null);
    });
    this.buffs = tac.hand_buffs();
    this.tools = tac.hand_tools();
    this.bound = this.mine.map((b) => counter(b, COUNTER_BIND) > 0);
    this.draw_value = DRAW * Math.max(0, DRAW_HAND - (tac.view.players[0].hand || 0));
    this.base_hp = this.foes.map((f) => f.def);
    this.weak0 = this.foes.map((f) => counter(f, COUNTER_WEAK) > 0);
    this.max_hp = this.foes.map((f) => f.base_def);
    this.no_heal = this.foes.map((f) => counter(f, 0xb02) > 0);
    this.levels = this.foes.map((f) => f.level);
    const p1 = tac.der.players[1];
    this.opp_over_all = p1.dotte >= 1 && this.foes.some((f) => !(f.pos & POS_DEFENSE));
    this.opp_room = tac.view.players[1].summoner_code === 10050110 ? 99 : p1.margin;
    this.opp_slots = tac.support_free[1];
    this.memo = new Map();
    this.values = new Map();
    this.root = null;
    this.states = 0;
  }

  start(oppCards) {
    const tac = this.tac;
    const attacks = this.mine.map((a) => tac._attacks_left(a));
    const first = attacks.map((n) => n > 0);
    const p0 = tac.der.players[0];
    const room = tac.view.players[0].summoner_code === 10050110 ? 99 : p0.margin;
    const slots = tac.support_free[0];
    const stand = this.mine.map((a) => !(a.pos & POS_DEFENSE));
    const allNext = this.mine.map((a) => counter(a, COUNTER_ALL_ATTACK) > 0);
    const asleep = this.mine.map((a) => counter(a, COUNTER_SLEEP) > 0);
    const n = this.mine.length;
    let hp = this.base_hp;
    let opp = [oppCards, this.opp_slots, this.opp_room, tac.der.players[1].dotte];
    const waiting = new Map();
    this.foes.forEach((f, e) => {
      const d = tac.chain_damage(f);
      if (d) waiting.set(e, d);
    });
    if (waiting.size) {
      const landed = this._answers(hp, opp, () => waiting, this.weak0, null, asleep).map(([h, o]) => this._land(h, o, waiting, this.weak0));
      const best = minBy(landed, (r) => [r[0].filter((x) => x <= 0).length, -sum(r[0])]);
      [hp, opp] = best;
    }
    this.pending_kills = hp.filter((x) => x <= 0).length;
    return [hp, attacks, first, Array(n).fill(false), this.once0, p0.dotte + tac.pending_attack_gauge(0),
      Array(this.buffs.length).fill(true), slots, room, opp, stand, Array(n).fill(0), this.weak0,
      Array(this.tools.length).fill(true), allNext, asleep];
  }

  _falls(hp, e, dmg, weak) {
    return hp[e] > 0 && hp[e] - dmg <= (weak[e] ? 1 : 0);
  }

  _healed(hp, e, n, over = false, cleanse = false) {
    if (hp[e] <= 0 || (this.no_heal[e] && !cleanse)) return hp[e];
    return over ? hp[e] + n : Math.max(hp[e], Math.min(hp[e] + n, this.max_hp[e]));
  }

  _answers(hp, opp, hitsFor, weak, attacker, asleep) {
    let out = [[hp, opp, null]];
    const fallsAny = [...hitsFor(0)].some(([e, d]) => this._falls(hp, e, d, weak));
    if (!opp[0] || !opp[1] || !fallsAny) return out;
    let frontier = out;
    for (let r = 0; r < OPP_HEALS_MAX; r++) {
      const nxt = [];
      for (const [h, o, slept] of frontier) {
        const cut = slept && attacker !== null && !asleep[attacker] ? 1 : 0;
        const falling = [...hitsFor(cut)].filter(([e, d]) => this._falls(h, e, d, weak)).map(([e]) => e);
        if (falling.length) nxt.push(...this._answer(h, o, falling, attacker, asleep, slept));
      }
      out = out.concat(nxt);
      frontier = nxt;
    }
    const seen = new Set();
    const unique = out.filter((a) => {
      const k = key(a);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return Plan._undominated(unique);
  }

  static _undominated(answers) {
    const keep = [];
    answers.forEach(([h, o, sl], i) => {
      let beaten = false;
      for (let j = 0; j < answers.length; j++) {
        const [h2, o2, sl2] = answers[j];
        if (j === i || SLEEP_RANK[sl2] < SLEEP_RANK[sl] || [0, 1, 2].some((k) => o2[k] < o[k])
          || h2.some((x2, q) => x2 < h[q])) continue;
        if (key([h2, o2.slice(0, 3), sl2]) !== key([h, o.slice(0, 3), sl]) || j < i) {
          beaten = true;
          break;
        }
      }
      if (!beaten) keep.push([h, o, sl]);
    });
    return keep;
  }

  _answer(h, o, falling, attacker, asleep, slept) {
    const [cards, slots, room, gauge] = o;
    const pay = (nCards, level, g = 0) => {
      if (cards < nCards || slots < nCards || room < level || gauge < g) return null;
      return [cards - nCards, slots - nCards, room - level, gauge - g];
    };
    const one = (e, n, over, cleanse) => h.map((x, f) => (f === e ? this._healed(h, f, n, over, cleanse) : x));
    const every = (n, over, cleanse) => h.map((x, f) => this._healed(h, f, n, over, cleanse));
    const out = [];
    const unlucky = falling.some((e) => this.no_heal[e]);
    for (const cleanse of unlucky ? [false, true] : [false]) {
      const extra = cleanse ? [1, OPP_CLEANSE_LEVEL] : [0, 0];
      let o2 = pay(1 + extra[0], OPP_HEAL_LEVEL + extra[1]);
      if (o2) {
        for (const e of falling) {
          if (this.no_heal[e] && !cleanse) continue;
          out.push([one(e, OPP_HEAL, false, cleanse), o2, slept], [one(e, OPP_OVER_HEAL, true, cleanse), o2, slept]);
        }
        out.push([every(OPP_ALL_HEAL, false, cleanse), o2, slept]);
      }
      o2 = pay(1 + extra[0], OPP_OVER_ALL_LEVEL + extra[1], 1);
      if (o2 && this.opp_over_all) out.push([every(OPP_OVER_ALL, true, cleanse), o2, slept]);
    }
    if (!slept) {
      let o2 = pay(1, OPP_SLEEP_LEVEL);
      if (o2 && attacker !== null && !asleep[attacker]) out.push([h, o2, "one"]);
      o2 = pay(1, OPP_SLEEP_ALL_LEVEL);
      if (o2) out.push([h, o2, "all"]);
      o2 = pay(1, OPP_SLEEP_ALL_LEVEL, OPP_KISARAGI_GAUGE);
      if (o2) out.push([every(OPP_ALL_HEAL, false, false), o2, "all"]);
    }
    return out;
  }

  _land(hp, opp, hits, weak) {
    hp = [...hp];
    let [cards, slots, room, gauge] = opp;
    let chip = 0;
    for (const [e, d] of hits) {
      if (hp[e] <= 0) continue;
      if (this._falls(hp, e, d, weak)) {
        hp[e] = 0;
        room += this.levels[e];
      } else {
        chip += d;
        hp[e] -= d;
      }
    }
    return [hp, [cards, slots, room, gauge], chip];
  }

  _stiff_choices(cands, n) {
    if (n <= 0) return [[]];
    if (cands.length < n) return [];
    const free = cands.filter((i) => this.dottes[i] === null || this.bound[i]);
    const rest = cands.filter((i) => !free.includes(i));
    if (free.length >= n) return [free.slice(0, n)];
    return combinations(rest, n - free.length).map((c) => free.concat(c));
  }

  _key(e, hp, weak) {
    return key([hp[e], this.max_hp[e], this.levels[e], this.no_heal[e], weak[e], this.taunt[e], this.untouchable[e],
      this.vs.map((v) => v[e]), this.dottes.map((d) => (d ? d[2][e] : 0)),
      this.dottes.map((d) => (d && d[9] ? d[9][2][e] : 0))]);
  }

  _distinct(foes, hp, weak) {
    const seen = new Set(), out = [];
    for (const e of foes) {
      const k = this._key(e, hp, weak);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }

  same_as(s, e) {
    const hp = s[0], weak = s[12];
    const k = this._key(e, hp, weak);
    const f = range(this.foes.length).find((f) => hp[f] > 0 && this._key(f, hp, weak) === k);
    return f === undefined ? e : f;
  }

  actions(s) {
    const [hp, attacks, , dotted, , gauge, hand, slots, room, , stand, , weak, tools, allNext] = s;
    const out = [];
    const alive = range(this.foes.length).filter((e) => hp[e] > 0);
    if (!alive.length) return out;
    const picks = this._distinct(alive, hp, weak);
    const standing = range(stand.length).filter((i) => stand[i]);
    this.dottes.forEach((d, b) => {
      if (d === null || dotted[b] || d[0] > gauge || !stand[b] || this.bound[b]) return;
      const others = standing.filter((i) => i !== b);
      const more = d[6], opt = d[9];
      for (const useOpt of opt ? [false, true] : [false]) {
        if (useOpt && d[0] + opt[0] > gauge) continue;
        for (const e of d[1] ? [null] : picks) {
          for (const paid of this._stiff_choices(others, d[7] + (useOpt ? opt[1] : 0))) {
            out.push(["dotte", b, e, paid, null, useOpt]);
            if (!more) continue;
            const left = others.filter((i) => !paid.includes(i));
            const whose = more[1] === "self" ? [b] : more[1] === "one" ? range(this.mine.length) : ["all"];
            for (const extra of this._stiff_choices(left, more[0])) {
              for (const r of whose) out.push(["dotte", b, e, paid.concat(extra), r, useOpt]);
            }
          }
        }
      }
    });
    const taunts = alive.filter((e) => this.taunt[e]);
    let targets = taunts.length ? this._distinct(taunts, hp, weak) : picks;
    if (alive.length > 1) {
      const t = targets.filter((e) => !this.untouchable[e]);
      targets = t.length ? t : targets;
    }
    for (let a = 0; a < this.mine.length; a++) {
      if (!attacks[a]) continue;
      for (const e of this.half[a] || allNext[a] ? targets.slice(0, 1) : targets) {
        out.push(["attack", a, e, null, []]);
        this.buffs.forEach(([, , , , level, cost, stiff], k) => {
          if (!(hand[k] && slots > 0 && level <= room && cost <= gauge)) return;
          for (const paid of this._stiff_choices(standing, stiff)) out.push(["attack", a, e, k, paid]);
        });
      }
    }
    this.tools.forEach(([, kind, n, who, level, cost, stiff], k) => {
      if (!(tools[k] && slots > 0 && level <= room && cost <= gauge)) return;
      if (kind === "gauge" && !this.dottes.some((d, b) => {
        if (!(d && !dotted[b] && stand[b] && !this.bound[b])) return false;
        const need = d[0] + (d[9] ? d[9][0] : 0);
        return gauge < need && need <= gauge - cost + n;
      })) return;
      for (const paid of this._stiff_choices(standing, stiff)) {
        for (const r of kind === "gauge" || who === "all" ? [null] : range(this.mine.length)) out.push(["tool", k, r, paid]);
      }
    });
    return out;
  }

  step(s, act) {
    let [hp, attacks, first, dotted, pend, gauge, hand, slots, room, opp, stand, up, weak, tools, allNext, asleep] = s;
    [attacks, first, dotted, pend, stand, up, allNext] = [attacks, first, dotted, pend, stand, up, allNext].map((x) => [...x]);
    let score = 0;
    const alive = range(this.foes.length).filter((f) => hp[f] > 0);
    let attacker = null;
    let hitsFor;
    if (act[0] === "dotte") {
      const [, b, e, paid, moreTo, useOpt] = act;
      let [cost, , dmg, draws, weakKind, selfUp, more, , v, opt] = this.dottes[b];
      if (useOpt) {
        cost = cost + opt[0];
        dmg = opt[2];
      }
      gauge -= cost;
      score += draws * this.draw_value - cost * GAUGE;
      const targets = e === null ? alive : [e];
      up[b] += selfUp[0] + (selfUp[1] ? alive.length : 0);
      if (weakKind) {
        const hitWeak = weakKind === "all" ? alive : targets;
        weak = weak.map((w, f) => w || hitWeak.includes(f));
      }
      const fixed = new Map(targets.map((f) => [f, Math.max(0, dmg[f] - v + alive.length)]));
      hitsFor = () => fixed;
      dotted[b] = true;
      stand[b] = false;
      for (const i of paid) stand[i] = false;
      if (moreTo !== null) {
        for (const i of moreTo === "all" ? range(this.mine.length) : [moreTo]) attacks[i] += more[2];
      }
    } else if (act[0] === "attack") {
      const [, a, e, k, paid] = act;
      attacker = a;
      if (k !== null) {
        const [, n, toAll, once, level, cost] = this.buffs[k];
        hand = replaceAt(hand, k, false);
        slots -= 1;
        room -= level;
        gauge -= cost;
        for (const i of paid) stand[i] = false;
        score -= CARD + cost * GAUGE;
        for (const i of toAll ? range(this.mine.length) : [a]) {
          if (once) pend[i] += n;
          else up[i] += n;
        }
      }
      const atk = this.atk0[a] + up[a] + pend[a];
      if (this.half[a]) hitsFor = (cut) => new Map(alive.map((f) => [f, Math.floor(Math.max(0, atk - cut) / 2)]));
      else if (allNext[a]) {
        hitsFor = (cut) => new Map(alive.map((f) => [f, Math.max(0, atk - cut + this.vs[a][f])]));
        allNext[a] = false;
      } else hitsFor = (cut) => new Map([[e, Math.max(0, atk - cut + this.vs[a][e])]]);
      if (this.attack_weak[a]) {
        const h0 = hitsFor(0);
        weak = weak.map((w, f) => w || h0.has(f));
      }
      pend[a] = 0;
      attacks[a] -= 1;
      if (first[a]) {
        gauge += this.attack_gauge[a];
        first[a] = false;
      }
      if (this.unstiff[a] && !stand[a]) {
        stand[a] = true;
        dotted[a] = false;
      }
    } else {
      const [, k, r, paid] = act;
      const [, kind, n, , level, cost] = this.tools[k];
      tools = replaceAt(tools, k, false);
      slots -= 1;
      room -= level;
      gauge -= cost;
      for (const i of paid) stand[i] = false;
      score -= CARD + cost * GAUGE;
      if (kind === "gauge") gauge += n;
      else for (const i of r === null ? range(this.mine.length) : [r]) attacks[i] += n;
      return [[[hp, attacks, first, dotted, pend, gauge, hand, slots, room, opp, stand, up, weak, tools, allNext, asleep], score]];
    }
    const rest = [attacks, first, dotted, pend, gauge, hand, slots, room];
    const before = hp.filter((h) => h <= 0).length;
    const out = [];
    for (const [h, o, slept] of this._answers(hp, opp, hitsFor, weak, attacker, asleep)) {
      const cut = slept && attacker !== null && !asleep[attacker] ? 1 : 0;
      const [h2, o2, removed] = this._land(h, o, hitsFor(cut), weak);
      let up2 = up, asleep2 = asleep;
      if (slept) {
        const who = slept === "all" ? range(this.mine.length) : [attacker];
        up2 = up.map((x, i) => x - (who.includes(i) && !asleep[i] ? 1 : 0));
        asleep2 = asleep.map((z, i) => z || who.includes(i));
      }
      const kills = range(h2.length).filter((i) => h2[i] <= 0 && hp[i] > 0);
      const sc = score + (h2.filter((x) => x <= 0).length - before) * KILL + sum(kills.map((i) => 100 * this.levels[i]))
        + CHIP * removed;
      out.push([[h2, ...rest, o2, stand, up2, weak, tools, allNext, asleep2], sc]);
    }
    return out;
  }

  _outcome(s, act) {
    let res = null;
    for (const [nxt, sc] of this.step(s, act)) {
      const fut = this._best(nxt);
      const k = range(nxt[0].length).filter((i) => nxt[0][i] <= 0 && s[0][i] > 0).length;
      const cand = [sc + fut[0], k + fut[1]];
      if (res === null || cand[0] < res[0]) res = cand;
    }
    return res;
  }

  best(s) {
    this.states = 0;
    this.root = s;
    return this._best(s);
  }

  _best(s) {
    const sk = key(s);
    const got = this.memo.get(sk);
    if (got !== undefined) return got;
    this.states += 1;
    if (this.states >= PLAN_STATES) return [0, 0];
    let res = [0, 0];
    const root = s === this.root;
    for (const act of this.actions(s)) {
      const cand = this._outcome(s, act);
      if (root) this.values.set(key([s, act]), cand);
      if (cand[0] > res[0]) res = cand;
    }
    this.memo.set(sk, res);
    return res;
  }

  value(s, act) {
    const k = key([s, act]);
    let got = this.values.get(k);
    if (got === undefined) {
      this.states = 0;
      got = this._outcome(s, act);
      this.values.set(k, got);
    }
    return got;
  }
}

// ---- the opponent's turn: what to answer with ---------------------------
const LOSE = 1000;
const DEF_CARD = 20;
const DEF_CARD_SHORT = 15;
const DEF_HAND = 5;
const DEF_HP = 2;

export class Defense {
  constructor(tac, hiddenBuff = false, resolving = null) {
    this.tac = tac;
    this.mine = [...tac.battle[0].values()];
    this.foes = [...tac.battle[1].values()];
    this.taunt = this.mine.map((c, i) => (tac.is_taunt(c) ? i : -1)).filter((i) => i >= 0);
    this.untouchable = this.mine.map((c) => textOf(tac.db, c.code).not_attackable);
    this.max_hp = this.mine.map((c) => c.base_def);
    this.levels = this.mine.map((c) => c.level);
    const texts = this.foes.map((f) => textOf(tac.db, f.code));
    const powers = this.foes.map((f) => tac.attack_of(f));
    this.atk = powers.map((p) => p[0]);
    this.once = powers.map((p) => p[1]);
    this.half = texts.map((t) => t.half_all);
    this.unstiff = texts.map((t) => t.unstiff_after_attack);
    this.attack_gauge = texts.map((t) => t.attack_gauge);
    this.attack_weak = texts.map((t) => t.attack_weak);
    this.vs = this.foes.map((f) => this.mine.map((c) => tac.hit_of(f, c, 0)));
    this.all_attack = this.foes.map((f) => counter(f, COUNTER_ALL_ATTACK) > 0);
    this.dottes = this.foes.map((f, i) => {
      const t = texts[i];
      if (!(t.dotte_hits && (tac._can_dotte(f) || f === resolving))) return null;
      const v = t.dotte_var && t.dotte_var[1] === "opp_battle" ? this.mine.length : 0;
      return [t.dotte, t.dotte_to_all, this.mine.map((c) => tac.dotte_damage(t, f, c, true)), t.dotte_weak,
        [t.dotte_self_atk, t.dotte_self_atk_opp], t.dotte_more_attacks, t.dotte_stiff, v];
    });
    this.buff = hiddenBuff ? Math.max(...tac.opp_buff) : 0;
    this.cards = tac.defense_cards();
    this.n_hand = 1 + (this.cards.length ? Math.max(...this.cards.map((c) => c[0])) : -1);
    this.cleanses = tac.hand_cleanses.length;
    const hand = tac.view.players[0].hand || 0;
    this.card_cost = DEF_CARD + DEF_CARD_SHORT * Math.max(0, DEF_HAND - hand);
    this.memo = new Map();
    this.states = 0;
  }

  start() {
    const tac = this.tac;
    const p0 = tac.der.players[0];
    const room = tac.view.players[0].summoner_code === 10050110 ? 99 : p0.margin;
    const attacks = this.foes.map((f) => tac._attacks_left(f));
    return [this.mine.map((c) => c.def), this.mine.map((c) => counter(c, 0xb02) > 0), room, tac.support_free[0],
      p0.dotte, Array(this.n_hand).fill(true), this.cleanses, attacks, attacks.map((n) => n > 0),
      Array(this.foes.length).fill(false), tac.der.players[1].dotte, this.buff > 0, Array(this.foes.length).fill(0),
      Array(this.foes.length).fill(0), this.foes.map((f) => !(f.pos & POS_DEFENSE)),
      this.mine.map((c) => counter(c, COUNTER_WEAK) > 0)];
  }

  moves(s) {
    const [hp, , , , , , , attacks, , dotted, ogauge, buff, , , fstand] = s;
    const alive = range(hp.length).filter((i) => hp[i] > 0);
    if (!alive.length) return [];
    let targets = this.taunt.filter((i) => hp[i] > 0);
    if (!targets.length) targets = alive;
    if (alive.length > 1) {
      const t = targets.filter((i) => !this.untouchable[i]);
      targets = t.length ? t : targets;
    }
    const out = [];
    for (let b = 0; b < this.foes.length; b++) {
      if (attacks[b]) {
        for (const t of this.all_attack[b] || this.half[b] ? [null] : targets) {
          out.push(["attack", b, t, false]);
          if (buff) out.push(["attack", b, t, true]);
        }
      }
      const d = this.dottes[b];
      if (d && !dotted[b] && d[0] <= ogauge && fstand[b]) {
        const others = range(this.foes.length).filter((j) => fstand[j] && j !== b).length;
        if (d[6] > others) continue;
        const more = d[5];
        const whose = !more || more[0] + d[6] > others ? []
          : more[1] === "self" ? [b] : more[1] === "one" ? range(this.foes.length) : ["all"];
        for (const t of d[1] ? [null] : alive) {
          out.push(["dotte", b, t, null]);
          for (const r of whose) out.push(["dotte", b, t, r]);
        }
      }
    }
    return out;
  }

  hits(s, move, cut) {
    const hp = s[0], first = s[8], up = s[13];
    const [kind, b, t] = move;
    const alive = range(hp.length).filter((i) => hp[i] > 0);
    if (kind === "attack") {
      const atk = this.atk[b] + up[b] + (first[b] ? this.once[b] : 0) + (move[3] ? this.buff : 0) - cut[b];
      if (this.half[b]) return new Map(alive.map((i) => [i, Math.floor(Math.max(0, atk) / 2)]));
      return new Map((t === null ? alive : [t]).map((i) => [i, Math.max(0, atk + this.vs[b][i])]));
    }
    const d = this.dottes[b];
    return new Map((t === null ? alive : [t]).map((i) => [i, Math.max(0, d[2][i] - d[7] + alive.length)]));
  }

  answers(s, move) {
    const [hp, unhappy, room, slots, gauge, hand, cleanses] = s;
    const out = [[[], new Map(), false, null]];
    const hit = [...this.hits(s, move, s[12]).keys()];
    const alive = range(hp.length).filter((i) => hp[i] > 0);
    this.cards.forEach(([h, kind, n, toAll, , level, cost, sleep], k) => {
      if (!hand[h] || slots < 1 || level > room || cost > gauge) return;
      const sl = move[0] === "attack" ? sleep : null;
      if (kind === "heal") {
        for (const heal of toAll ? [new Map(alive.map((i) => [i, n]))] : hit.map((i) => new Map([[i, n]]))) {
          out.push([[k], heal, false, sl]);
          if ([...heal.keys()].some((i) => unhappy[i]) && cleanses && slots >= 2 && room >= level + 1) {
            out.push([[k, "cleanse"], heal, true, sl]);
          }
        }
      } else if (kind === "sleep" && move[0] === "attack") out.push([[k], new Map(), false, toAll ? "all" : "one"]);
    });
    return out;
  }

  step(s, move, ans) {
    let [hp, unhappy, room, slots, gauge, hand, cleanses, attacks, first, dotted, ogauge, buff, cut, up, fstand, weak] = s;
    const [used, heal, throughUnhappy, sleep] = ans;
    let loss = 0;
    let overK = false;
    [hp, unhappy, hand, cut] = [[...hp], [...unhappy], [...hand], [...cut]];
    for (const k of used) {
      if (k === "cleanse") {
        cleanses -= 1;
        slots -= 1;
        room -= 1;
        loss += this.card_cost;
        continue;
      }
      const [h, , , , over, level, cost] = this.cards[k];
      hand[h] = false;
      slots -= 1;
      room -= level;
      gauge -= cost;
      loss += this.card_cost;
      overK = over;
    }
    for (const [i, n] of heal) {
      if (unhappy[i] && !throughUnhappy) continue;
      if (throughUnhappy) unhappy[i] = false;
      const nw = overK ? hp[i] + n : Math.max(hp[i], Math.min(hp[i] + n, this.max_hp[i]));
      loss -= DEF_HP * (nw - hp[i]);
      hp[i] = nw;
    }
    if (sleep) {
      const b = move[1];
      for (const j of sleep === "all" ? range(this.foes.length) : [b]) {
        if (counter(this.foes[j], COUNTER_SLEEP) === 0) cut[j] = 1;
      }
    }
    const b = move[1];
    const hits = this.hits([hp, ...s.slice(1)], move, cut);
    if (move[0] === "dotte" && this.dottes[b][3]) {
      weak = weak.map((w, i) => w || (this.dottes[b][3] === "one" ? hits.has(i) : hp[i] > 0));
    } else if (move[0] === "attack" && this.attack_weak[b]) weak = weak.map((w, i) => w || hits.has(i));
    for (const [i, d] of hits) {
      if (hp[i] <= 0) continue;
      if (hp[i] - d <= (weak[i] ? 1 : 0)) {
        hp[i] = 0;
        room += this.levels[i];
        loss += LOSE + 100 * this.levels[i];
      } else {
        hp[i] -= d;
        loss += DEF_HP * d;
      }
    }
    [attacks, first, dotted, up, fstand] = [[...attacks], [...first], [...dotted], [...up], [...fstand]];
    if (move[0] === "attack") {
      attacks[b] -= 1;
      if (move[3]) buff = false;
      if (first[b]) {
        first[b] = false;
        ogauge += this.attack_gauge[b];
      }
      if (this.unstiff[b] && !fstand[b]) {
        fstand[b] = true;
        dotted[b] = false;
      }
    } else {
      const d = this.dottes[b];
      dotted[b] = true;
      ogauge -= d[0];
      fstand[b] = false;
      up[b] += d[4][0] + (d[4][1] ? s[0].filter((x) => x > 0).length : 0);
      const moreTo = move.length > 3 ? move[3] : null;
      const need = d[6] + (moreTo !== null ? d[5][0] : 0);
      const cands = range(this.foes.length).filter((j) => fstand[j] && j !== b);
      const order = cands.map((j, i) => [j, i]).sort((x, y) => {
        const kx = this.dottes[x[0]] !== null && !dotted[x[0]] ? 1 : 0;
        const ky = this.dottes[y[0]] !== null && !dotted[y[0]] ? 1 : 0;
        return kx - ky || x[1] - y[1];
      }).map(([j]) => j);
      for (const j of order.slice(0, need)) fstand[j] = false;
      if (moreTo !== null) {
        for (const j of moreTo === "all" ? range(this.foes.length) : [moreTo]) attacks[j] += d[5][2];
      }
    }
    return [[hp, unhappy, room, slots, gauge, hand, cleanses, attacks, first, dotted, ogauge, buff, cut, up, fstand, weak], loss];
  }

  exchange(s, move, ans) {
    this.states = 0;
    return this._exchange(s, move, ans);
  }

  _exchange(s, move, ans) {
    const [nxt, loss] = this.step(s, move, ans);
    const lost = range(nxt[0].length).filter((i) => nxt[0][i] <= 0 && s[0][i] > 0).length;
    const fut = this._worst(nxt);
    return [loss + fut[0], lost + fut[1]];
  }

  worst(s) {
    this.states = 0;
    return this._worst(s);
  }

  _worst(s) {
    const sk = key(s);
    const got = this.memo.get(sk);
    if (got !== undefined) return got;
    this.states += 1;
    if (this.states >= MAX_STATES) return [0, 0];
    let res = [0, 0];
    for (const move of this.moves(s)) {
      const v = minBy(this.answers(s, move).map((a) => this._exchange(s, move, a)), (x) => x[0]);
      if (v[0] > res[0]) res = v;
    }
    this.memo.set(sk, res);
    return res;
  }
}
