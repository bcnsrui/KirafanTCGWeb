/* The game's flow: events and the effects they start, chains, the windows where players may act, the turn
 * (draw, standby, main, battle, end) and the battle. The order follows ocgcore's, so the questions the
 * players get (`ask`) come as they do in EDOPro. */
import { Duel, START_HAND } from "./duel.js";

/** option kinds: the numbers of the learning AI's kirafan_ai.core.messages (K_*) */
export const K = {
  SPSUMMON: 1, ACTIVATE: 5, TO_BP: 6, TO_EP: 7, BATTLE_ACTIVATE: 9, ATTACK: 10, BATTLE_TO_EP: 12,
  EFFECTYN_YES: 13, EFFECTYN_NO: 14, YES: 15, NO: 16, OPTION: 17, CARD_PICK: 18, CARD_FINISH: 19, CARD_CANCEL: 20,
  CHAIN_ACTIVATE: 21, CHAIN_PASS: 22, NUMBER: 23,
};

/** options that only exist so an EDOPro player can undo a click (the AI marks them "changes nothing") */
const sid = (code, i) => code * 0x100000 + i;
export const NOOP_DESCS = new Set([sid(10050111, 1), sid(10050111, 6), sid(10050111, 8)]);

export class DuelEnd extends Error {}

const NO_EVENT = [null, 0, 0, null, 0, 0];   // eg, ep, ev, re, r, rp of an action no event started
const eventArgs = (ev) => (ev ? [ev.cards, ev.ep, ev.ev, ev.re, ev.r, ev.rp] : NO_EVENT);

/** ask 답이 options 밖이면 (락스텝 어긋남 등) undefined.kind 대신 넘기기/종료 쪽으로 */
function pickOption(options, index, fallbackKinds = [K.CHAIN_PASS, K.TO_BP, K.BATTLE_TO_EP]) {
  const i = Number(index);
  if (Number.isInteger(i) && i >= 0 && i < options.length && options[i]) return options[i];
  for (const kind of fallbackKinds) {
    const o = options.find((x) => x.kind === kind);
    if (o) return o;
  }
  return options[0];
}

Object.assign(Duel.prototype, {
  /** people use the trimmed counter timings; the learning AI keeps the wider windows it trained on */
  isHuman(p) {
    return !!this.controllers[p]?.human;
  },

  aiSeats() {
    return [0, 1].filter((p) => !this.isHuman(p));
  },

  /** free-chain / post-effect windows only for AI seats (humans: battleStart/End, attack, 돗테오키 respond) */
  async openAiWindow(opts = {}) {
    const players = this.aiSeats();
    if (!players.length) return false;
    const alwaysAsk = (opts.alwaysAsk || []).filter((p) => players.includes(p));
    return this.openWindow({ skipHumanTurnPlayer: true, ...opts, players, alwaysAsk });
  },

  async ask(p, decision) {
    if (this.over) throw new DuelEnd();
    decision.player = p;
    decision.window = this.windowReason || "";   // ("battleEnd": the battle would end)
    decision.chainLength = this.chain.length;
    this.pending = decision;
    this.emit("ask", { decision });
    const answer = await this.controllers[p].ask(this, decision);
    this.pending = null;
    if (this.over) throw new DuelEnd();
    return answer;
  },

  /** runs a Lua function that may ask the players (a cost, target or operation) as `effect` of `player` */
  async runLua(ref, args, effect = null, player = 0) {
    const before = this.current;
    this.current = { effect, player };
    try {
      await this.rt.run(ref, args);
    } finally {
      this.current = before;
    }
  },

  check(ref, args, effect, player) {
    const before = this.current;
    this.current = { effect, player, checking: true };
    try {
      return !!this.rt.call(ref, args, 1)[0];
    } finally {
      this.current = before;
    }
  },

  // ---- count limits ----------------------------------------------------------------
  countOk(e) {
    const lim = e.countLimit;
    if (!lim) return true;
    if (lim.code) return (this.sharedCounts.get(`${e.handler.controller}:${lim.code}`) || 0) < lim.max;
    return lim.used < lim.max;
  },

  consumeCount(e) {
    const lim = e.countLimit;
    if (!lim) return;
    if (lim.code) {
      const key = `${e.handler.controller}:${lim.code}`;
      this.sharedCounts.set(key, (this.sharedCounts.get(key) || 0) + 1);
    } else lim.used++;
  },

  /** a new turn: count limits start over, but for EFFECT_FLAG_NO_TURN_RESET ones (once per duel) */
  resetCounts() {
    const C = this.C;
    const keep = new Set();
    for (const card of this.cards) {
      for (const e of card.effects) {
        if (!e.countLimit) continue;
        const once = e.property & C.EFFECT_FLAG_NO_TURN_RESET;
        if (once && e.countLimit.code) keep.add(`${card.controller}:${e.countLimit.code}`);
        if (!once) e.countLimit.used = 0;
      }
    }
    for (const key of [...this.sharedCounts.keys()]) if (!keep.has(key)) this.sharedCounts.delete(key);
  },

  // ---- the choices the scripts ask for -----------------------------------------------
  /** min..max of `cards` (all of them without asking when that is the only choice); null when cancelled */
  async chooseCards(p, cards, min, max, { cancelable = false, hint = this.hints[p] } = {}) {
    if (!cards.length) return [];
    max = Math.min(max, cards.length);
    if (min >= cards.length && !cancelable) return [...cards];
    const picked = await this.ask(p, { type: "cards", cards, min, max, cancelable, hint });
    return picked ? picked.map((i) => cards[i]) : null;
  },

  async chooseYesNo(p, desc) {
    const options = [{ kind: K.YES, desc }, { kind: K.NO, desc }];
    return (await this.ask(p, { type: "yesno", desc, options })) === 0;
  },

  async chooseNumber(p, numbers) {
    const options = numbers.map((n) => ({ kind: K.NUMBER, desc: n }));
    return numbers[await this.ask(p, { type: "number", numbers, options })];
  },

  // ---- events ----------------------------------------------------------------------
  /** the effects an event starts: continuous ones run now (turn player's first), triggers wait for a chain */
  async handleEvent(ev) {
    const C = this.C;
    const conts = [];
    const trigs = [];
    for (const card of this.cards) {
      for (const e of card.effects) {
        if (e.code !== ev.code) continue;
        const cont = e.type & C.EFFECT_TYPE_CONTINUOUS;
        const trig = e.type & (C.EFFECT_TYPE_TRIGGER_F | C.EFFECT_TYPE_TRIGGER_O);
        if (!cont && !trig) continue;
        if (e.type & C.EFFECT_TYPE_SINGLE) {
          if (!ev.cards.includes(card)) continue;
          if (e.property & C.EFFECT_FLAG_SINGLE_RANGE && !this.inRange(e)) continue;
        } else if (!this.inRange(e)) continue;
        (cont ? conts : trigs).push(e);
      }
    }
    const first = (e) => (e.handler.controller === this.turnPlayer ? 0 : 1);
    conts.sort((a, b) => first(a) - first(b));
    // (a phase's continuous effects wait with its triggers: as ocgcore, each player orders all its phase effects
    // together - processTriggers)
    const phase = (ev.code & 0xf000) === C.EVENT_PHASE;
    for (const e of conts) {
      if (!e.registered || !this.countOk(e) || ev.once?.has(e)) continue;
      const tp = e.handler.controller;
      const args = [tp, ...eventArgs(ev)];
      if (e.condition && !this.check(e.condition, [e, ...args], e, tp)) continue;
      ev.once?.add(e);
      if (phase) {
        this.triggers.push({ effect: e, player: tp, event: ev, continuous: true });
        continue;
      }
      this.consumeCount(e);
      if (e.operation) await this.runLua(e.operation, [e, ...args], e, tp);
      if (this.over) return;
    }
    for (const e of trigs) {
      const tp = e.handler.controller;
      if (ev.once?.has(e)) continue;
      if (!this.countOk(e) || (e.condition && !this.check(e.condition, [e, tp, ...eventArgs(ev)], e, tp))) continue;
      ev.once?.add(e);
      this.triggers.push({ effect: e, player: tp, event: ev });
    }
  },

  /** after one action of a script, before the script goes on (ocgcore's process_instant_event + adjust_instant): the
   *  events it raised handled (their continuous effects run, triggers wait), then the self-destroying cards
   *  destroyed - a creamate whose HP cards are all gone - and so on with that destruction's events */
  async handleRaised(events) {
    const C = this.C;
    for (let guard = 0; guard < 20 && !this.over; guard++) {
      for (const ev of events) {
        if (this.over) return;
        await this.handleEvent(ev);
      }
      const doomed = this.selfDestroying();
      if (!doomed.length) return;
      const mark = this.events.length;
      this.destroy(doomed, C.REASON_EFFECT | C.REASON_RULE);
      events = this.events.splice(mark);
    }
  },

  selfDestroying() {
    const out = [];
    for (const p of [0, 1]) {
      for (const c of this.p[p].mzone) if (c && this.effectsOn(c, this.C.EFFECT_SELF_DESTROY).length) out.push(c);
    }
    return out;
  },

  /** EVENT_ADJUST and the self-destroying cards, once; whether anything changed */
  async adjustOnce() {
    const C = this.C;
    const before = this.log.length;
    await this.handleEvent({ code: C.EVENT_ADJUST, cards: [], ep: 0, ev: 0, re: null, r: 0, rp: 0 });
    const doomed = this.selfDestroying();
    if (doomed.length) this.destroy(doomed, C.REASON_EFFECT | C.REASON_RULE);
    return this.log.length !== before || this.events.length > 0;
  },

  /** every raised event handled and the adjust checks done, until nothing changes */
  async settle() {
    for (let guard = 0; guard < 500; guard++) {
      if (this.over) return;
      if (this.events.length) {
        await this.handleEvent(this.events.shift());
        continue;
      }
      if (await this.adjustOnce()) continue;
      return;
    }
    this.emit("error", { message: "처리가 끝나지 않아 멈췄습니다 (settle)" });
  },

  // ---- activating ------------------------------------------------------------------
  /** whether player p may activate e now. mode: "idle" (the main phase's own turn), "battle", "chain" */
  canActivate(e, p, mode) {
    const C = this.C;
    const card = e.handler;
    if (!e.registered || card.controller !== p || card.holder) return false;
    const quick = e.type & C.EFFECT_TYPE_QUICK_O && e.code === C.EVENT_FREE_CHAIN;
    const ignition = e.type & C.EFFECT_TYPE_IGNITION;
    if (!quick && !ignition) return false;
    if (ignition && (mode !== "idle" || this.chain.length || this.turnPlayer !== p)) return false;
    if (!this.inLocation(card, e.range)) return false;
    if (this.phase === C.PHASE_DAMAGE && !(e.property & C.EFFECT_FLAG_DAMAGE_STEP)) return false;
    if (this.phase === C.PHASE_DAMAGE_CAL && !(e.property & C.EFFECT_FLAG_DAMAGE_CAL)) return false;
    if (!this.countOk(e)) return false;
    if (this.effectsOn(card, C.EFFECT_CANNOT_TRIGGER).length) return false;
    const top = this.chain[this.chain.length - 1];
    if (top && top.limit && !this.check(top.limit, [e, p, top.player], e, p)) return false;
    const args = [p, ...NO_EVENT];
    if (e.condition && !this.check(e.condition, [e, ...args], e, p)) return false;
    if (e.cost && !this.check(e.cost, [e, ...args, 0], e, p)) return false;
    if (e.target && !this.check(e.target, [e, ...args, 0, null], e, p)) return false;
    return true;
  },

  activateOptions(p, mode) {
    const kind = { idle: K.ACTIVATE, battle: K.BATTLE_ACTIVATE, chain: K.CHAIN_ACTIVATE }[mode];
    const out = [];
    for (const card of this.cards) {
      if (card.controller !== p || !card.location) continue;
      for (const e of card.effects) {
        if (this.canActivate(e, p, mode)) out.push({ kind, card, effect: e, desc: e.description, noop: NOOP_DESCS.has(e.description) });
      }
    }
    return out;
  },

  /** puts e on the chain: costs paid and targets chosen (both may ask); returns the link */
  async activate(e, p, { event = null } = {}) {
    const card = e.handler;
    const link = { effect: e, player: p, card, targets: [], location: card.location, sequence: card.sequence,
      limit: null, event, fieldId: card.fieldId };
    this.consumeCount(e);
    this.building = link;
    this.emit("activate", { card, player: p, desc: e.description });
    if (this.onActivate) await this.onActivate(link);   // (the page may show what is activated before its targets)
    const args = [e, p, ...eventArgs(event)];
    try {
      if (e.cost) await this.runLua(e.cost, [...args, 1], e, p);
      if (e.target) await this.runLua(e.target, [...args, 1, null], e, p);
    } finally {
      this.building = null;
    }
    this.chain.push(link);
    link.index = this.chain.length;
    this.emit("chaining", { card, player: p, desc: e.description, index: link.index, targets: link.targets.map((t) => t.card),
      from: link.location });
    this.lastActivator = p;
    await this.settle();
    return link;
  },

  /** the other players' answers to the chain: alternate until both pass. A player does not chain onto its own
   *  link (Kirafan: two supports in a row resolve one after the other - continueSupports - not in reverse).
   *  Humans: only onto an opponent's 돗테오키 (MZONE). AI: also onto supports / in-battle free responds (as trained). */
  async respond() {
    let p = 1 - this.lastActivator;
    let passes = 0;
    let answered = false;
    while (passes < 2 && !this.over) {
      const C = this.C;
      const top = this.chain[this.chain.length - 1];
      const inBattle = this.phase >= C.PHASE_BATTLE_START && this.phase <= C.PHASE_BATTLE;
      let opts, always;
      if (this.isHuman(p)) {
        const mayRespond = top && top.player !== p && top.location === C.LOCATION_MZONE;
        opts = mayRespond ? this.activateOptions(p, "chain") : [];
        always = mayRespond && p !== this.turnPlayer;
      } else {
        opts = top && top.player === p ? [] : this.activateOptions(p, "chain");
        always = top && top.player !== p && p !== this.turnPlayer && (inBattle || top.location === C.LOCATION_MZONE);
      }
      if (!opts.length && !always) {
        passes++;
        p = 1 - p;
        continue;
      }
      const options = [...opts, { kind: K.CHAIN_PASS }];
      const before = this.windowReason;
      this.windowReason = "respond";
      let o;
      try {
        o = pickOption(options, await this.ask(p, { type: "chain", options }));
      } finally {
        this.windowReason = before;
      }
      // (the other player's first answer to the link on top - a 돗테오키's: its attack motion goes on)
      if (!answered && top && top.player !== p) {
        answered = true;
        this.emit("answer", { player: p, pass: o.kind === K.CHAIN_PASS, index: top.index });
      }
      if (o.kind === K.CHAIN_PASS) passes++;
      else {
        await this.activate(o.effect, p);
        passes = 0;
      }
      p = 1 - p;
    }
  },

  async resolveChain() {
    while (this.chain.length && !this.over) {
      const link = this.chain[this.chain.length - 1];
      this.solving = link;
      this.emit("solving", { card: link.card, player: link.player, index: link.index, desc: link.effect.description,
        targets: link.targets.map((t) => t.card) });
      const e = link.effect;
      if (e.operation) await this.runLua(e.operation, [e, link.player, ...eventArgs(link.event)], e, link.player);
      this.chain.pop();
      this.solving = null;
      this.emit("solved", { card: link.card, index: link.index });
      await this.settle();
    }
    this.chain = [];
    this.resetChain();
    this.emit("chainEnd");
    await this.settle();
  },

  /** the chain started by `activate`: answers, then resolution, then the triggers it set off */
  async runChain() {
    await this.respond();
    await this.resolveChain();
    await this.processTriggers();
  },

  isSupportFromHand(o) {
    return o.card && o.card.location === this.C.LOCATION_HAND && !(o.card.data.race & 7) && !o.noop;
  },

  /** after the other player's (not the turn player's) support resolved: "이어서 서포트 크리에메이트를
   *  사용하시겠습니까?" while it can use another one now (each resolves before the next); whether it used any */
  async continueSupports(p) {
    let used = false;
    while (!this.over) {
      const opts = this.activateOptions(p, "chain").filter((o) => this.isSupportFromHand(o));
      if (!opts.length) break;
      const before = this.windowReason;
      this.windowReason = "continue";
      const options = [...opts, { kind: K.CHAIN_PASS }];
      let o;
      try {
        o = pickOption(options, await this.ask(p, { type: "chain", options }));
      } finally {
        this.windowReason = before;
      }
      if (o.kind === K.CHAIN_PASS) break;
      await this.activate(o.effect, p);
      await this.runChain();
      used = true;
    }
    return used;
  },

  /** "which first?" among effects of player p that happen at once (ocgcore's chain question without a pass):
   *  the index of the one to resolve first */
  async askOrder(p, effects) {
    const before = this.windowReason;
    this.windowReason = "order";
    try {
      return await this.ask(p, { type: "chain", options: effects.map((e) => ({ kind: K.CHAIN_ACTIVATE, card: e.handler,
        effect: e, desc: e.description, noop: false })) });
    } finally {
      this.windowReason = before;
    }
  },

  /** summoner card (TYPE_EXTRA): simultaneous triggers of these always resolve before creamates */
  isSummonerCard(card) {
    return !!(card && card.isType(this.C.TYPE_EXTRA));
  },

  /** Battle-end rule / summoner maintenance (incl. global holder code 0, EMZONE): before creamate text effects */
  isPhasePriorityEffect(t) {
    const card = t.effect?.handler;
    if (!card) return true;
    if (t.effect.global || !card.code) return true;
    if (this.isSummonerCard(card)) return true;
    const C = this.C;
    if (card.location === C.LOCATION_MZONE && card.sequence >= 5) return true;
    return false;
  },

  /** the waiting trigger effects as new chains (the turn player's first). Summoner / battle-end rule
   *  effects go first with no ask; askOrder only when two or more creamate non-continuous triggers overlap.
   *  Continuous creamate phase effects keep registration order (no order dialog). */
  async processTriggers() {
    const C = this.C;
    while (this.triggers.length && !this.over) {
      const pending = this.triggers.splice(0);
      const usable = (t) => t.effect.registered && this.countOk(t.effect) && (t.continuous
        ? !t.effect.condition || this.check(t.effect.condition, [t.effect, t.player, ...eventArgs(t.event)], t.effect, t.player)
        : !t.effect.target || this.check(t.effect.target, [t.effect, t.player, ...eventArgs(t.event), 0, null], t.effect, t.player));
      for (const p of [this.turnPlayer, 1 - this.turnPlayer]) {
        let mine = pending.filter((t) => t.player === p);
        while (mine.length && !this.over) {
          const ok = mine.filter(usable);
          if (!ok.length) break;
          const priority = ok.filter((x) => this.isPhasePriorityEffect(x))
            .sort((a, b) => a.effect.id - b.effect.id);
          const rest = ok.filter((x) => !this.isPhasePriorityEffect(x));
          let t;
          if (priority.length) t = priority[0];
          else {
            const continuous = rest.filter((x) => x.continuous).sort((a, b) => a.effect.id - b.effect.id);
            const triggers = rest.filter((x) => !x.continuous);
            if (continuous.length) t = continuous[0];
            else if (triggers.length > 1) {
              const oi = Number(await this.askOrder(p, triggers.map((x) => x.effect)));
              t = triggers[Number.isInteger(oi) && oi >= 0 && oi < triggers.length ? oi : 0];
            } else t = triggers[0] || ok[0];
          }
          mine = mine.filter((x) => x !== t);
          await this.processTrigger(t);
          // (as ocgcore's PhaseEvent: once a phase's continuous effect has run the players may start a chain
          // before the next one - the attack counters are there, the next effect's attack up not yet. After the
          // last one the phase's own window comes at once: not asked twice)
          const more = mine.some(usable) || (p === this.turnPlayer && pending.some((x) => x.player !== p && usable(x)));
          if (t.continuous && more && this.phaseWindow && !this.over) {
            if (this.phaseWindow.aiOnly) await this.openAiWindow({ reason: this.phaseWindow.reason });
            else await this.openWindow({ reason: this.phaseWindow.reason });
            this.windowReason = this.phaseWindow.reason;
          }
        }
      }
    }
  },

  /** one waiting trigger effect: asked if optional, then on a chain of its own, resolved before the next one
   *  (nothing resolves in reverse). An alchemist's effect as it is sent to the dotte zone gives no one a chance
   *  to answer */
  async processTrigger(t) {
    const C = this.C;
    const e = t.effect;
    if (t.continuous) {   // (a phase's continuous effect: it runs, no chain)
      this.consumeCount(e);
      if (e.operation) await this.runLua(e.operation, [e, t.player, ...eventArgs(t.event)], e, t.player);
      await this.settle();
      return;
    }
    if (e.type & C.EFFECT_TYPE_TRIGGER_O) {
      const yes = await this.ask(t.player, { type: "effectyn", card: e.handler, desc: e.description,
        options: [{ kind: K.EFFECTYN_YES, card: e.handler, desc: e.description }, { kind: K.EFFECTYN_NO, card: e.handler, desc: e.description }] });
      if (yes !== 0) return;
    }
    const link = await this.activate(e, t.player, { event: t.event });
    if (link.location !== C.LOCATION_GRAVE) await this.respond();
    await this.resolveChain();
  },

  /** a window where the players may start a chain (from `first`); a resolved chain opens it again.
   *  players: who may (by default both, but in the battle step only the turn player: the other's supports
   *  come at the battle's start and as it ends). Returns whether a chain was started. */
  async openWindow({ first = this.turnPlayer, skipHumanTurnPlayer = false, players = null, reason = "", declined = null,
    alwaysAsk = [] } = {}) {
    const C = this.C;
    const battleStep = [C.PHASE_BATTLE_STEP, C.PHASE_DAMAGE, C.PHASE_DAMAGE_CAL].includes(this.phase);
    const allowed = players || (battleStep ? [this.turnPlayer] : [0, 1]);
    // (a person whose main / battle phase menu comes next acts there: not asked here as well)
    if (battleStep || this.phase === C.PHASE_MAIN1) skipHumanTurnPlayer = true;
    let any = false;
    const askedAlways = new Set();
    this.windowReason = reason;
    for (let round = 0; round < 100 && !this.over; round++) {
      let p = first;
      let passes = 0;
      let started = false;
      // (a player who just said no to "이어서 서포트를...?" is not asked again until the other one acts)
      const skipOnce = declined;
      declined = null;
      while (passes < 2 && !this.over) {
        const skip = !allowed.includes(p) || p === skipOnce
          || (skipHumanTurnPlayer && p === this.turnPlayer && this.controllers[p].human);
        const opts = skip ? [] : this.activateOptions(p, "chain");
        // (alwaysAsk: asked once even with nothing to activate, so the game going on at once tells no one that
        // this player holds no support)
        const always = !skip && alwaysAsk.includes(p) && !askedAlways.has(p);
        if (!opts.length && !always) {
          passes++;
          p = 1 - p;
          continue;
        }
        askedAlways.add(p);
        const options = [...opts, { kind: K.CHAIN_PASS }];
        const o = pickOption(options, await this.ask(p, { type: "chain", options }));
        // (the attacked player's first answer to an attack, a support or none: the attack goes on - its motion)
        if (reason === "attack" && !any && round === 0) this.emit("answer", { player: p, pass: o.kind === K.CHAIN_PASS, attack: true });
        if (o.kind === K.CHAIN_PASS) {
          passes++;
          p = 1 - p;
          continue;
        }
        // (the other player is asked whether to use another support; the turn player has the priority anyway)
        const support = this.isSupportFromHand(o) && p !== this.turnPlayer;
        await this.activate(o.effect, p);
        await this.runChain();
        if (support) {
          await this.continueSupports(p);
          declined = p;
        }
        started = any = true;
        break;
      }
      if (!started) break;
    }
    this.windowReason = "";
    return any;
  },

  /** an activation from the main / battle phase menu. Humans get no free-chain after; AI still does (as trained) */
  async activateFromMenu(e, p) {
    await this.activate(e, p);
    await this.runChain();
    await this.openAiWindow();
  },

  // ---- summoning -------------------------------------------------------------------
  /** battle creamates in p's hand its summon procedure (EFFECT_SPSUMMON_PROC) allows now */
  summonOptions(p) {
    const C = this.C;
    const out = [];
    for (const card of this.p[p].hand) {
      const proc = card.effects.find((e) => e.code === C.EFFECT_SPSUMMON_PROC && this.inLocation(card, e.range));
      if (!proc || (proc.condition && !this.check(proc.condition, [proc, card], proc, p))) continue;
      if (!this.uniqueOk(card, p)) continue;
      out.push({ kind: K.SPSUMMON, card });
    }
    return out;
  },

  /** Card.SetUniqueOnField: one of these on the field (a 나이트: one knight in the battle zone) */
  uniqueOk(card, p) {
    const u = card.unique;
    if (!u) return true;
    const matches = (c) => (u.filter ? this.check(u.filter, [c], null, p) : c.code === card.code);
    if (!matches(card)) return true;
    return !this.fieldCards(p, u.s ? u.loc : 0, u.o ? u.loc : 0).some((c) => c !== card && c.faceup && matches(c));
  },

  async summon(card, p) {
    this.specialSummon([card], p, p, this.C.POS_FACEUP_ATTACK, null, true);
    await this.settle();
    await this.processTriggers();
    await this.openAiWindow();
  },

  // ---- the battle ------------------------------------------------------------------
  battleZone(p) {
    return this.p[p].mzone.slice(0, 5).filter(Boolean);
  },

  canAttack(card) {
    const C = this.C;
    if (!card.faceup) return false;
    return !this.effectsOn(card, C.EFFECT_CANNOT_ATTACK).length && !this.effectsOn(card, C.EFFECT_CANNOT_ATTACK_ANNOUNCE).length;
  },

  attackTargets(attacker) {
    const C = this.C;
    const foe = 1 - attacker.controller;
    const blocks = this.activeFieldEffects(C.EFFECT_CANNOT_SELECT_BATTLE_TARGET).filter((e) => this.fieldEffectCovers(e, attacker));
    return this.p[foe].mzone.filter((c) => c && !this.effectsOn(c, C.EFFECT_IGNORE_BATTLE_TARGET).length
      && !blocks.some((e) => this.value(e, [c])));
  },

  /** a normal attack that hits every enemy: an all-attack creamate (setcode 0xa02), or one whose next attack
   *  does (COUNTER_HIRO 0xc04, Kirafan2.battleop2) */
  hitsAll(card) {
    return this.isSetCard(card, 0xa02) || (card.counters.get(0xc04) || 0) > 0;
  },

  async attack(card) {
    const C = this.C;
    const p = card.controller;
    const targets = this.attackTargets(card);
    const all = this.hitsAll(card);
    if (targets.length) this.hints[p] = 549;   // (as ocgcore's HINT_SELECTMSG before the attack target, kept after it)
    let target = null;
    // (nothing to choose; a replay takes the target EDOPro was asked for even so - js/engine/replay.js)
    if (targets.length === 1 || (all && targets.length)) target = this.autoAttackTarget?.(card, targets) || targets[0];
    else if (targets.length) {
      const picked = await this.ask(p, { type: "cards", cards: targets, min: 1, max: 1, cancelable: true, hint: 549 });
      if (!picked || !picked.length) return;
      target = targets[picked[0]];
    } else if (this.battleZone(1 - p).length) return;
    this.attacker = card;
    this.attackTarget = target;
    this.emit("attack", { attacker: card, target, all });
    this.raise(C.EVENT_ATTACK_ANNOUNCE, [card], { ep: p, rp: p });
    await this.settle();
    await this.processTriggers();
    // (the attack and its target known, the other player may answer with a support)
    await this.openWindow({ first: 1 - p, players: [1 - p], reason: "attack", alwaysAsk: [1 - p] });
    if (this.attacker === card && card.location === C.LOCATION_MZONE) {
      this.phase = C.PHASE_DAMAGE;
      await this.openAiWindow();
      this.phase = C.PHASE_DAMAGE_CAL;
      await this.openAiWindow();
      const both = [card, ...(target && target.location === C.LOCATION_MZONE ? [target] : [])];
      this.raise(C.EVENT_PRE_DAMAGE_CALCULATE, both, { rp: p });
      await this.settle();
      this.emit("battle", { attacker: card, target });
      this.raise(C.EVENT_DAMAGE_STEP_END, both.filter((c) => c.location === C.LOCATION_MZONE), { rp: p });
      await this.settle();
    }
    this.phase = C.PHASE_BATTLE_STEP;
    this.attacker = null;
    this.attackTarget = null;
    // (then the battle menu at once, as ocgcore: no window of its own once the attack is over)
    await this.processTriggers();
  },

  // ---- phases ----------------------------------------------------------------------
  /** a phase starts: its EVENT_PHASE effects, then a window (the main phase's is its own menu).
   *  window: true = everyone, false = none, "ai" = learning AI seats only (humans skip "지금 페이즈") */
  async enterPhase(phase, { window = true, reason = "", alwaysAsk = [] } = {}) {
    this.phase = phase;
    this.emit("phase", { phase });
    this.raise(this.C.EVENT_PHASE_START + phase, []);
    await this.settle();
    await this.processTriggers();
    // (then, as ocgcore's PhaseEvent, the phase's EVENT_PHASE effects - "배틀 페이즈 개시시", "배틀 페이즈 종료시", the
    // end phase's -, looked at again once they have run: one whose condition another one fulfilled runs too, the
    // other summoner's 진실의 손의 시간. Each runs once. The window comes after them)
    const once = new Set();
    this.phaseWindow = window ? { reason, aiOnly: window === "ai" } : null;
    try {
      for (let pass = 0; pass < 8 && !this.over; pass++) {
        const ran = once.size;
        this.raise(this.C.EVENT_PHASE + phase, [], { once });
        await this.settle();
        await this.processTriggers();
        if (once.size === ran) break;
      }
    } finally {
      this.phaseWindow = null;
    }
    if (window === "ai") await this.openAiWindow({ reason, alwaysAsk });
    else if (window) await this.openWindow({ reason, alwaysAsk });
  },

  async drawPhase() {
    const C = this.C;
    this.phase = C.PHASE_DRAW;
    this.raise(C.EVENT_PREDRAW, [], { ep: this.turnPlayer });
    await this.settle();
    await this.processTriggers();
    const count = this.playerAffected(this.turnPlayer, C.EFFECT_DRAW_COUNT);
    const n = count.length ? Number(this.value(count[0], [])) : this.turn > 1 ? 1 : 0;
    if (n > 0) this.draw(this.turnPlayer, n, C.REASON_RULE);
    await this.enterPhase(C.PHASE_DRAW, { window: "ai" });
    this.resetPhase(C.PHASE_DRAW);
  },

  async mainPhase() {
    const C = this.C;
    await this.enterPhase(C.PHASE_MAIN1, { window: false });
    const p = this.turnPlayer;
    while (!this.over) {
      const options = [...this.summonOptions(p), ...this.activateOptions(p, "idle"), { kind: K.TO_BP }];
      const o = pickOption(options, await this.ask(p, { type: "idle", options }), [K.TO_BP]);
      if (o.kind === K.TO_BP) break;
      if (o.kind === K.SPSUMMON) await this.summon(o.card, p);
      else await this.activateFromMenu(o.effect, p);
    }
    this.resetPhase(C.PHASE_MAIN1);
  },

  async battlePhase() {
    const C = this.C;
    const p = this.turnPlayer;
    await this.enterPhase(C.PHASE_BATTLE_START, { reason: "battleStart", alwaysAsk: [1 - p] });
    this.phase = C.PHASE_BATTLE_STEP;
    this.emit("phase", { phase: C.PHASE_BATTLE_STEP });
    while (!this.over) {
      const attacks = this.battleZone(p).filter((c) => this.canAttack(c)).map((card) => ({ kind: K.ATTACK, card }));
      // (EFFECT_MUST_ATTACK: the battle does not end while such a card can still attack, as ocgcore's to_ep)
      const must = attacks.some((a) => this.effectsOn(a.card, C.EFFECT_MUST_ATTACK).length && this.attackTargets(a.card).length);
      const options = [...this.activateOptions(p, "battle"), ...attacks, ...(must ? [] : [{ kind: K.BATTLE_TO_EP }])];
      const o = pickOption(options, await this.ask(p, { type: "battle", options }), [K.BATTLE_TO_EP]);
      if (o.kind === K.BATTLE_TO_EP) {
        // (the other player's supports as the battle would end; one used, the battle goes on until ended again)
        if (await this.openWindow({ first: 1 - p, players: [1 - p], reason: "battleEnd", alwaysAsk: [1 - p] })) {
          this.emit("battleContinues", { player: p });
          continue;
        }
        break;
      }
      if (o.kind === K.ATTACK) await this.attack(o.card);
      else await this.activateFromMenu(o.effect, p);
    }
    await this.enterPhase(C.PHASE_BATTLE, { window: "ai" });
    this.resetPhase(C.PHASE_BATTLE);
  },

  async endPhase() {
    const C = this.C;
    await this.enterPhase(C.PHASE_END, { window: "ai" });
    this.resetPhase(C.PHASE_END);
  },

  // ---- the duel --------------------------------------------------------------------
  /** decks: [{ main: [codes], summoner }] of player 0 (moves first) and player 1 */
  async play(decks) {
    const C = this.C;
    this.sharedCounts = new Map();
    try {
      decks.forEach((deck, p) => {
        for (const code of deck.main) {
          const card = this.newCard(code, p);
          card.location = C.LOCATION_DECK;
          card.position = C.POS_FACEDOWN_DEFENSE;
          this.p[p].deck.push(card);
        }
        const summoner = this.newCard(deck.summoner, p);
        summoner.location = C.LOCATION_EXTRA;
        summoner.position = C.POS_FACEDOWN_DEFENSE;
        this.p[p].extra.push(summoner);
        this.shuffleDeck(p);
      });
      for (const p of [0, 1]) this.draw(p, START_HAND, C.REASON_RULE);
      this.events = [];
      await this.runTurns();
    } catch (err) {
      if (!(err instanceof DuelEnd)) throw err;
    }
    return this.winner;
  },

  /** the turns until the duel is over; the phases the scripts skip left out (Duel.SkipPhase, EFFECT_SKIP_DP /
   *  SP: the puzzles), and EVENT_TURN_END at each turn's end */
  async runTurns() {
    const C = this.C;
    for (let t = 0; t < 500 && !this.over; t++) {
      this.turn++;
      if (this.turn > 1) this.turnPlayer = 1 - this.turnPlayer;
      this.resetCounts();
      this.skipped = [];
      this.emit("turn", { player: this.turnPlayer });
      if (!this.skips(C.PHASE_DRAW)) await this.drawPhase();
      if (!this.skips(C.PHASE_STANDBY)) {
        await this.enterPhase(C.PHASE_STANDBY, { window: "ai" });
        this.resetPhase(C.PHASE_STANDBY);
      }
      if (!this.skips(C.PHASE_MAIN1)) await this.mainPhase();
      if (!this.skips(C.PHASE_BATTLE)) await this.battlePhase();
      if (!this.skips(C.PHASE_END)) await this.endPhase();
      this.raise(C.EVENT_TURN_END, [], { ep: this.turnPlayer });
      await this.settle();
      await this.processTriggers();
    }
    if (!this.over) {
      this.winner = 2;
      this.winReason = "turns";
      this.emit("win", { winner: 2, reason: "turns" });
    }
  },

  /** whether the turn player skips this phase of this turn */
  skips(phase) {
    const C = this.C;
    const p = this.turnPlayer;
    if ((this.skipped || []).some((s) => s.player === p && s.phase === phase)) return true;
    const code = { [C.PHASE_DRAW]: C.EFFECT_SKIP_DP, [C.PHASE_STANDBY]: C.EFFECT_SKIP_SP, [C.PHASE_BATTLE]: C.EFFECT_SKIP_BP,
      [C.PHASE_END]: C.EFFECT_SKIP_EP }[phase];
    return code !== undefined && this.playerAffected(p, code).length > 0;
  },
});
