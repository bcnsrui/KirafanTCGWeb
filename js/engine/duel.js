/* The rules engine: the part of EDOPro's core (ocgcore) the Kirafan card scripts use.
 *
 * The card scripts themselves (data/scripts.json, the Lua EDOPro runs) run unchanged in a Lua VM
 * (runtime.js); this file is the game they act on: cards and zones, effects and their values, events,
 * chains, the turn and the battle. Choices go to the players through `ask` (decisions.js shapes them
 * like ocgcore's messages, so the learning AI sees the same questions it trained on).
 *
 * Constants (C) are read from EDOPro's constant.lua once the Lua VM has loaded it. */

export const EMZONE = 0x1000;           // (CS_init.lua) the extra monster zones: the summoner's place
const START_LP = 8000;
const START_HAND = 5;
const MZONE_ORDER = [5, 6, 2, 1, 3, 0, 4];      // where ocgcore puts a monster when the player does not choose
const SZONE_ORDER = [2, 1, 3, 0, 4];

export class Card {
  constructor(duel, uid, code, owner) {
    this.duel = duel;
    this.uid = uid;
    this.code = code;
    this.data = duel.db[code] || { type: 0, atk: 0, def: 0, level: 0, race: 0, attribute: 0, setcode: 0, name: String(code), strings: [] };
    this.owner = owner;
    this.controller = owner;
    this.location = 0;
    this.sequence = 0;
    this.position = 0;
    this.overlay = [];          // the cards under this one (a battle creamate's HP cards, the summoner's 성채석)
    this.holder = null;         // the card this one is under
    this.counters = new Map();
    this.effects = [];
    this.flags = [];            // [{ code, reset, count, turn }]
    this.previous = { controller: owner, location: 0, sequence: 0, position: 0 };
    this.reason = 0;
    this.reasonPlayer = 0;
    this.fieldId = 0;           // a new one each time it moves (what "the same card" means for targets)
    this.summonTurn = 0;
    this.token = false;
  }

  get name() { return this.data.name; }
  isType(t) { return (this.data.type & t) !== 0; }
  get faceup() { return (this.position & 0x5) !== 0; }
}

export class Effect {
  constructor(duel, id, owner) {
    this.duel = duel;
    this.id = id;
    this.owner = owner;         // the card that created it
    this.handler = owner;       // the card it is registered to
    this.type = 0;
    this.code = 0;
    this.property = 0;
    this.range = 0;
    this.targetRange = [0, 0];
    this.countLimit = null;     // { max, code, used }
    this.description = 0;
    this.category = 0;
    this.hintTiming = [0, 0];
    this.condition = null;      // Lua function refs (runtime.js)
    this.cost = null;
    this.target = null;
    this.operation = null;
    this.value = null;          // a number, or a function ref in valueFn
    this.valueFn = null;
    this.reset = null;          // { flags, count }
    this.registered = false;
    this.label = 0;
  }

  clone(id) {
    const e = new Effect(this.duel, id, this.owner);
    for (const k of ["type", "code", "property", "range", "description", "category", "condition", "cost", "target",
      "operation", "value", "valueFn", "label"]) e[k] = this[k];
    e.targetRange = [...this.targetRange];
    e.hintTiming = [...this.hintTiming];
    e.countLimit = this.countLimit ? { ...this.countLimit, used: 0 } : null;
    e.reset = this.reset ? { ...this.reset } : null;
    return e;
  }
}

/** a pending event: code, the cards it is about (eg), the player / value / reason / reason effect / reason player */
/** once: the effects that already ran for this event (a phase's event raised again, flow.enterPhase) */
function event(code, cards = [], { ep = 0, ev = 0, r = 0, re = null, rp = 0, once = null } = {}) {
  return { code, cards, ep, ev, r, re, rp, once };
}

export class Duel {
  /** db: data/engine.json cards; C: the constants; rt: the Lua runtime; players: [{ ask(decision) }] */
  constructor({ db, C, rt, rng, players }) {
    this.db = db;
    this.C = C;
    this.rt = rt;
    this.rng = rng || Math.random;
    this.controllers = players;
    this.cards = [];
    this.effectCount = 0;
    this.p = [0, 1].map(() => ({ lp: START_LP, deck: [], hand: [], mzone: Array(7).fill(null), szone: Array(5).fill(null),
      grave: [], removed: [], extra: [] }));
    this.turn = 0;
    this.turnPlayer = 0;
    this.phase = 0;
    this.chain = [];            // the links being built or resolved: { effect, player, card, targets, location, limit, ... }
    this.solving = null;        // the link resolving now
    this.events = [];           // raised, not handled yet
    this.triggers = [];         // trigger effects waiting for the next chain
    this.attacker = null;
    this.attackTarget = null;
    this.hints = [0, 0];
    this.winner = null;         // 0 / 1 / 2 (draw) once over
    this.winReason = "";
    this.log = [];              // what happened, for the page: { type, ... }
    this.listeners = [];
  }

  // ---- what happened ---------------------------------------------------------------
  emit(type, data = {}) {
    const entry = { type, turn: this.turn, ...data };
    this.log.push(entry);
    for (const f of this.listeners) f(entry);
  }

  // ---- cards and zones -------------------------------------------------------------
  newCard(code, owner) {
    const card = new Card(this, this.cards.length + 1, code, owner);
    // TYPE_TOKEN (비운의 인물? …): 성전/마을로 가면 소멸, 돗테오키는 허용
    card.token = card.isType(this.C.TYPE_TOKEN);
    this.cards.push(card);
    this.making = true;
    try {
      this.rt.initCard(card);
    } finally {
      this.making = false;
    }
    for (const e of card.effects) e.builtin = true;   // (its script's own: a puzzle may replace one, puzzle.js)
    return card;
  }

  zoneList(p, loc) {
    const z = this.p[p];
    return { 0x1: z.deck, 0x2: z.hand, 0x10: z.grave, 0x20: z.removed, 0x40: z.extra }[loc];
  }

  /** the cards of player p in the locations of `mask` (EMZONE: the extra monster zones only) */
  cardsIn(p, mask) {
    const C = this.C;
    const out = [];
    const z = this.p[p];
    if (mask & C.LOCATION_DECK) out.push(...z.deck);
    if (mask & C.LOCATION_HAND) out.push(...z.hand);
    if (mask & C.LOCATION_MZONE) out.push(...z.mzone.filter(Boolean));
    else if (mask & EMZONE) out.push(...z.mzone.slice(5).filter(Boolean));
    if (mask & C.LOCATION_SZONE) out.push(...z.szone.filter(Boolean));
    if (mask & C.LOCATION_GRAVE) out.push(...z.grave);
    if (mask & C.LOCATION_REMOVED) out.push(...z.removed);
    if (mask & C.LOCATION_EXTRA) out.push(...z.extra);
    return out;
  }

  /** both sides from player p's view: s = p's own locations, o = the opponent's */
  fieldCards(p, s, o) {
    return [...(s ? this.cardsIn(p, s) : []), ...(o ? this.cardsIn(1 - p, o) : [])];
  }

  inLocation(card, mask) {
    if (mask & card.location) return true;
    return !!(mask & EMZONE) && card.location === this.C.LOCATION_MZONE && card.sequence >= 5;
  }

  /** the zones of p disabled now (EFFECT_DISABLE_FIELD: bits 0-4 monster zones, 8-12 spell/trap zones) */
  disabledZones(p) {
    let mask = 0;
    for (const e of this.activeFieldEffects(this.C.EFFECT_DISABLE_FIELD)) {
      const tp = e.handler.controller;
      const v = e.operation ? this.rt.call(e.operation, [e, tp], 1)[0] >>> 0 : (e.value >>> 0);
      mask |= tp === p ? v & 0xffff : (v >>> 16) & 0xffff;
    }
    return mask;
  }

  freeZones(p, loc) {
    const disabled = this.disabledZones(p);
    const z = this.p[p];
    if (loc === this.C.LOCATION_MZONE) {
      const emzTaken = z.mzone[5] || z.mzone[6];
      return MZONE_ORDER.filter((s) => !z.mzone[s] && (s >= 5 ? !emzTaken : !(disabled >> s & 1)));
    }
    return SZONE_ORDER.filter((s) => !z.szone[s] && !(disabled >> (8 + s) & 1));
  }

  /** free usable zones (Duel.GetLocationCount): the main monster zones only, as ocgcore counts them */
  locationCount(p, loc) {
    return this.freeZones(p, loc).filter((s) => loc !== this.C.LOCATION_MZONE || s < 5).length;
  }

  removeFromPlace(card) {
    const C = this.C;
    if (card.holder) {
      const h = card.holder;
      h.overlay.splice(h.overlay.indexOf(card), 1);
      h.overlay.forEach((c, i) => (c.sequence = i));
      card.holder = null;
      return;
    }
    const z = this.p[card.controller];
    if (card.location === C.LOCATION_MZONE) z.mzone[card.sequence] = null;
    else if (card.location === C.LOCATION_SZONE) z.szone[card.sequence] = null;
    else {
      const list = this.zoneList(card.controller, card.location);
      if (list) {
        const i = list.indexOf(card);
        if (i >= 0) list.splice(i, 1);
      }
    }
  }

  renumber(p) {
    for (const loc of [0x1, 0x2, 0x10, 0x20, 0x40]) this.zoneList(p, loc).forEach((c, i) => (c.sequence = i));
  }

  /** moves `card` (the engine's one move: every Duel.Send / Remove / Overlay / summon goes through here) */
  move(card, to, { player = card.owner, seq = null, pos = null, reason = 0, rp = 0, re = null, holder = null } = {}) {
    const C = this.C;
    const host = card.holder;
    const from = { controller: card.controller, location: host ? C.LOCATION_OVERLAY : card.location,
      sequence: card.sequence, position: card.position };
    const leavesField = !host && (card.location & C.LOCATION_ONFIELD);
    // Battle creamate HP → village: emit before detach so UI can tell lethal vs chip damage
    const hpHit = !!(host && to === C.LOCATION_REMOVED && host.location === C.LOCATION_MZONE
      && !host.isType(C.TYPE_EXTRA));
    // (a pendulum monster leaving the field for the graveyard goes face-up to its extra deck: 쓰러진 크리에메이트 → 성전)
    if (leavesField && to === C.LOCATION_GRAVE && card.isType(C.TYPE_PENDULUM)) to = C.LOCATION_EXTRA;
    // Token (비운의 인물? …): 돗테오키(GRAVE)는 허용. 성전(EXTRA)·마을(REMOVED)이면 소멸.
    if (card.token && !holder && (to === C.LOCATION_EXTRA || to === C.LOCATION_REMOVED)) to = 0;
    this.removeFromPlace(card);
    if (hpHit) {
      const left = host.overlay.length;
      // Standby Dotteeop (and other REASON_RULE chip dumps) are not combat damage/fall
      if (!(reason & C.REASON_RULE)) {
        this.emit("hpDamage", { card: host, left, lethal: left === 0 });
      }
    }
    if (leavesField && card.overlay.length && !holder && to !== C.LOCATION_EXTRA) {
      // (the cards under a card leaving the field go to the graveyard; to the extra deck they stay under it,
      // Kirafan2.hpleftop sends them to the village)
      for (const o of [...card.overlay]) this.move(o, C.LOCATION_GRAVE, { reason: C.REASON_RULE });
    }
    card.previous = from;
    card.reason = reason;
    card.reasonPlayer = rp;
    card.reasonEffect = re;
    card.fieldId = ++this.effectCount;
    this.resetOnMove(card, from.location, to);
    if (holder) {
      card.holder = holder;
      card.controller = holder.controller;
      card.location = C.LOCATION_OVERLAY;
      card.position = C.POS_FACEUP;
      card.sequence = holder.overlay.length;
      holder.overlay.push(card);
    } else if (to === C.LOCATION_MZONE || to === C.LOCATION_SZONE) {
      card.controller = player;
      card.location = to;
      card.sequence = seq;
      card.position = pos ?? C.POS_FACEUP_ATTACK;
      (to === C.LOCATION_MZONE ? this.p[player].mzone : this.p[player].szone)[seq] = card;
    } else if (!to) {
      card.controller = card.owner;
      card.location = 0;
      card.sequence = 0;
    } else {
      card.controller = card.owner;
      card.location = to;
      const list = this.zoneList(card.owner, to);
      if (to === C.LOCATION_DECK) {
        // seq: 0 the top (the end of the list), 1 the bottom, 2 shuffled in
        if (seq === 1) list.unshift(card);
        else list.push(card);
        card.position = C.POS_FACEDOWN_DEFENSE;
      } else {
        list.push(card);
        card.position = to === C.LOCATION_EXTRA ? (pos ?? C.POS_FACEUP_DEFENSE)
          : to === C.LOCATION_HAND ? C.POS_FACEDOWN_DEFENSE : (pos ?? C.POS_FACEUP);
      }
      this.renumber(card.owner);
    }
    if (from.location & (C.LOCATION_DECK | C.LOCATION_HAND | C.LOCATION_GRAVE | C.LOCATION_REMOVED | C.LOCATION_EXTRA)) this.renumber(from.controller);
    this.emit("move", { card, from, to: { controller: card.controller, location: card.location, sequence: card.sequence, position: card.position }, reason });
    return card;
  }

  // ---- effects ---------------------------------------------------------------------
  newEffect(owner) {
    return new Effect(this, ++this.effectCount, owner);
  }

  register(card, e) {
    if (this.puzzleSetup && !this.making) this.puzzleReplaces(card, e);
    e.handler = card;
    e.registered = true;
    card.effects.push(e);
  }

  /** the card becomes another one where it is (the two 앨리스 카터릿, runtime.js PATCHES): a new card to the
   *  rules - none of the old one's effects, flags or counters - with the other one's script */
  transform(card, code) {
    for (const e of [...card.effects]) this.unregister(e);
    card.flags = [];
    card.counters.clear();
    const from = card.code;
    card.code = code;
    card.data = this.db[code] || card.data;
    card.fieldId = ++this.effectCount;
    this.rt.initCard(card);
    this.emit("transform", { card, from, to: code });
  }

  unregister(e) {
    const list = e.handler.effects;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    e.registered = false;
  }

  /** RESET_EVENT + RESETS_STANDARD: the card's granted effects and flags end when it moves */
  resetOnMove(card, fromLoc, toLoc) {
    const C = this.C;
    const standard = C.RESET_EVENT >>> 0;
    const gone = (r) => r && (r.flags & standard) && (r.flags & (C.RESETS_STANDARD >>> 0));
    for (const e of [...card.effects]) if (gone(e.reset)) this.unregister(e);
    card.flags = card.flags.filter((f) => !gone({ flags: f.reset }));
    if (fromLoc !== toLoc && !(toLoc & C.LOCATION_ONFIELD)) card.counters.clear();
  }

  /** RESET_PHASE: effects and flags with this phase in their reset count it down, ending at 0 */
  resetPhase(phase) {
    const C = this.C;
    const bit = C.RESET_PHASE >>> 0;
    const due = (r) => r && (r.flags & bit) && (r.flags & phase);
    for (const card of this.cards) {
      for (const e of [...card.effects]) {
        if (due(e.reset) && --e.reset.count <= 0) this.unregister(e);
      }
      card.flags = card.flags.filter((f) => !(due({ flags: f.reset }) && --f.count <= 0));
    }
  }

  resetChain() {
    const bit = this.C.RESET_CHAIN >>> 0;
    for (const card of this.cards) {
      for (const e of [...card.effects]) if (e.reset && (e.reset.flags & bit)) this.unregister(e);
      card.flags = card.flags.filter((f) => !(f.reset & bit));
    }
  }

  /** whether an effect works where its card is now (its range; SINGLE_RANGE for a single effect) */
  inRange(e) {
    const C = this.C;
    const card = e.handler;
    if (e.global) return true;   // (registered to the duel: puzzle.js registerGlobal)
    if (e.type & C.EFFECT_TYPE_SINGLE && !(e.property & C.EFFECT_FLAG_SINGLE_RANGE)) return true;
    if (card.holder) return false;
    return this.inLocation(card, e.range);
  }

  condition(e, args = []) {
    if (!e.condition) return true;
    return !!this.rt.call(e.condition, [e, ...args], 1)[0];
  }

  /** the field effects with code `code` that work now */
  activeFieldEffects(code) {
    const C = this.C;
    const out = [];
    for (const card of this.cards) {
      for (const e of card.effects) {
        if (e.code === code && e.type & C.EFFECT_TYPE_FIELD && !(e.type & (C.EFFECT_TYPE_CONTINUOUS | C.EFFECT_TYPE_ACTIONS))
          && this.inRange(e) && this.condition(e)) out.push(e);
      }
    }
    return out;
  }

  /** the static effects with `code` that apply to `card`: its own single ones, and field ones over it */
  effectsOn(card, code) {
    const C = this.C;
    const out = [];
    for (const e of card.effects) {
      if (e.code === code && e.type & C.EFFECT_TYPE_SINGLE && !(e.type & (C.EFFECT_TYPE_CONTINUOUS | C.EFFECT_TYPE_ACTIONS))
        && this.inRange(e) && this.condition(e)) out.push(e);
    }
    for (const e of this.activeFieldEffects(code)) {
      if (e.property & C.EFFECT_FLAG_PLAYER_TARGET) continue;
      if (this.fieldEffectCovers(e, card)) out.push(e);
    }
    return out;
  }

  fieldEffectCovers(e, card) {
    const tp = e.handler.controller;
    const [s, o] = e.targetRange;
    const mask = card.controller === tp ? s : o;
    if (!mask || card.holder || !this.inLocation(card, mask)) return false;
    return !e.target || !!this.rt.call(e.target, [e, card], 1)[0];
  }

  /** a player-target field effect (EFFECT_FLAG_PLAYER_TARGET) over player p */
  playerAffected(p, code) {
    return this.activeFieldEffects(code).filter((e) => {
      if (!(e.property & this.C.EFFECT_FLAG_PLAYER_TARGET)) return false;
      const [s, o] = e.targetRange;
      return e.handler.controller === p ? !!s : !!o;
    });
  }

  value(e, args) {
    if (e.valueFn) return this.rt.call(e.valueFn, [e, ...args], 1)[0];
    return e.value;
  }

  // ---- a card's numbers ------------------------------------------------------------
  /** Card.GetLevel: an Xyz or Link monster (the summoner) has none, its number is a rank, as in ocgcore */
  levelOf(card) {
    const C = this.C;
    if (card.isType(C.TYPE_XYZ | C.TYPE_LINK)) return 0;
    const changes = this.effectsOn(card, C.EFFECT_CHANGE_LEVEL);
    return changes.length ? Number(this.value(changes[changes.length - 1], [card])) : card.data.level;
  }

  atkOf(card) {
    const C = this.C;
    let atk = card.data.atk;
    for (const e of this.effectsOn(card, C.EFFECT_SET_ATTACK)) atk = Number(this.value(e, [card]));
    for (const e of this.effectsOn(card, C.EFFECT_UPDATE_ATTACK)) atk += Number(this.value(e, [card]));
    for (const e of this.effectsOn(card, C.EFFECT_SET_ATTACK_FINAL)) atk = Number(this.value(e, [card]));
    return Math.max(0, atk);
  }

  defOf(card) {
    const C = this.C;
    let def = card.data.def;
    for (const e of this.effectsOn(card, C.EFFECT_SET_DEFENSE)) def = Number(this.value(e, [card]));
    for (const e of this.effectsOn(card, C.EFFECT_UPDATE_DEFENSE)) def += Number(this.value(e, [card]));
    return Math.max(0, def);
  }

  setcodes(card) {
    const out = [];
    let v = card.data.setcode;
    for (let i = 0; i < 4 && v; i++) {
      out.push(v % 0x10000);
      v = Math.floor(v / 0x10000);
    }
    for (const e of this.effectsOn(card, this.C.EFFECT_ADD_SETCODE)) out.push(Number(this.value(e, [card])));
    return out;
  }

  isSetCard(card, set) {
    return this.setcodes(card).some((s) => (s & 0xfff) === (set & 0xfff) && (s & set) === set);
  }

  // ---- counters and flags ----------------------------------------------------------
  addCounter(card, type, n) {
    if (n <= 0) return false;
    for (const e of this.effectsOn(card, this.C.EFFECT_CANNOT_PLACE_COUNTER)) {
      const v = e.valueFn || e.value ? this.value(e, [card]) : type;
      if (!v || v === type || v === true) return false;
    }
    card.counters.set(type, (card.counters.get(type) || 0) + n);
    this.emit("counter", { card, counter: type, count: card.counters.get(type) });
    return true;
  }

  removeCounter(card, type, n) {
    const have = card.counters.get(type) || 0;
    if (!have || n <= 0) return;
    const left = Math.max(0, have - n);
    if (left) card.counters.set(type, left);
    else card.counters.delete(type);
    this.emit("counter", { card, counter: type, count: left });
  }

  flagCount(card, code) {
    return card.flags.filter((f) => f.code === code).length;
  }

  // ---- events ----------------------------------------------------------------------
  raise(code, cards, info) {
    this.events.push(event(code, cards, info));
  }

  random(n) {
    return Math.floor(this.rng() * n);
  }

  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.random(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  setLP(p, lp) {
    this.p[p].lp = Math.max(0, Math.trunc(lp));
    this.emit("lp", { player: p, lp: this.p[p].lp });
    if (this.p[p].lp <= 0) this.lose(p, "lp");
  }

  lose(p, reason) {
    if (this.winner !== null) return;
    this.winner = 1 - p;
    this.winReason = reason;
    this.emit("win", { winner: this.winner, reason });
  }

  get over() {
    return this.winner !== null;
  }
}

export { START_HAND };
