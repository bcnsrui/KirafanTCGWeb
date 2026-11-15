/* The learning AI as a player of the web engine (flow.js controllers: ask(duel, decision) -> answer). Each
 * decision goes to the model the way kirafan_ai.bridge.session shows it EDOPro's: the options of the message,
 * a multi-card choice split into one pick at a time, the activation / attack it follows (context), options that
 * changed nothing before marked as such; the level picks among the model's odds (policy.js).
 *
 * One rule on top: the model learned EDOPro's chains, resolved last-in first-out, where a heal on an 불행 ally works
 * if a cleanse is chained after it. Here supports resolve one after the other, so for that heal it plays the
 * cleanse first and the heal right after (the next time it may act). */
import {
  loadAI, LOCATION_HAND, LOCATION_MZONE, MSG_SELECT_BATTLECMD, MSG_SELECT_IDLECMD, MSG_SELECT_EFFECTYN,
  MSG_SELECT_YESNO, MSG_SELECT_CARD, MSG_SELECT_CHAIN, MSG_ANNOUNCE_NUMBER, ACTIVATE_KINDS, CONTEXT_KINDS,
  PROGRESS_KINDS, K_CARD_PICK, K_CARD_FINISH, K_CARD_CANCEL, K_CHAIN_PASS, COUNTER_UNLUCKY, sid, textOf,
} from "./data.js";
import { encode, OPTION_BASE_DIM as B } from "./features.js";
import { Network, softmax } from "./model.js";
import { choose, optionGroups } from "./policy.js";
import { viewOf, cardTuple } from "./view.js";

const MSG = { idle: MSG_SELECT_IDLECMD, battle: MSG_SELECT_BATTLECMD, chain: MSG_SELECT_CHAIN, cards: MSG_SELECT_CARD,
  yesno: MSG_SELECT_YESNO, effectyn: MSG_SELECT_EFFECTYN, number: MSG_ANNOUNCE_NUMBER };
// the windows the other player is asked in even with nothing to use (flow.js: alwaysAsk, respond)
const HIDDEN_WINDOWS = new Set(["battleStart", "attack", "battleEnd", "respond"]);
const DOTTE_DESCS = [sid(10050113, 4), sid(10050113, 5), sid(10050111, 5)];
const INTENT_DECISIONS = 6;   // decisions a planned heal after its cleanse waits for at most

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** level 1-4 (policy.LEVELS); delay: ms before each answer, so the moves can be followed */
export async function modelPlayer({ level = 4, delay = 0, rng = Math.random, log = null } = {}) {
  const { db, model } = await loadAI();
  const net = new Network(model);
  const visits = new Map();     // decision signature -> [[option, opponent decisions so far]]
  const noops = new Map();      // decision signature -> options that led back to it unchanged
  let context = null;           // [kind, card, desc] of our last activation / attack / summon
  let intent = null;            // { code, desc, turn, left }: the heal to play once its cleanse has resolved
  let oppAsks = 0;
  let me = null;
  let watched = null;

  const isCleanse = (o) => {
    if (!o.card || !ACTIVATE_KINDS.has(o.kind) || o.noop) return false;
    const card = db.get(o.card[0]);
    if (DOTTE_DESCS.includes(o.desc)) return !!card && card.cleanseDotte;
    return !!o.desc && db.describe(o.desc).includes("상태이상 해제");
  };

  function signature(v) {
    const cards = v.cards.map((c) => [c.rel, c.loc, c.seq, c.code, c.pos, c.atk, c.def, c.overlay,
      Object.entries(c.counters).map(([k, n]) => [Number(k), n]).sort((a, b) => a[0] - b[0])])
      .map((x) => JSON.stringify(x)).sort();
    const players = v.players.map((p) => Object.entries(p).sort());
    return JSON.stringify([cards, players, v.chain.map((c) => [c.code, c.rel])]);
  }

  /** the model's pick among decision.options (more than one) */
  function decide(view, decision, raw) {
    let sig = null;
    if (!decision.picked || !decision.picked.length) {
      sig = JSON.stringify([raw, view.turn, view.phase, signature(view)]);
      for (const [i, seen] of visits.get(sig) || []) {
        if (seen === oppAsks) {
          if (!noops.has(sig)) noops.set(sig, new Set());
          noops.get(sig).add(i);
        }
      }
      for (const i of noops.get(sig) || []) {
        if (i < decision.options.length && !PROGRESS_KINDS.has(decision.options[i].kind)) decision.options[i].noop = true;
      }
    }
    const options = decision.options;
    const enc = encode(view, decision, db);   // (may take options off: features.sanctuary_rule)
    const { logits, value } = net.forward(enc);
    const probs = softmax(logits);
    let [idx, note] = choose(level, optionGroups(decision.options), enc.opts, probs,
      [view.players[0].hand || 0, view.players[1].hand || 0], rng);
    [idx, note] = cleanseFirst(view, decision, enc, probs, idx, note);
    const chosen = decision.options[idx];
    const original = options.indexOf(chosen);
    if (sig !== null) {
      if (!visits.has(sig)) visits.set(sig, new Set());
      visits.get(sig).add([original, oppAsks]);
    }
    if (log) log({ turn: view.turn, option: chosen, prob: probs[idx], value, note, decision });
    return original;
  }

  /** the cleanse before the heal it lets work (see the top), and that heal once the cleanse has resolved */
  function cleanseFirst(view, decision, enc, probs, idx, note) {
    const opts = decision.options;
    if (intent && (intent.turn !== view.turn || intent.left-- <= 0)) intent = null;
    if (intent && decision.msg === MSG_SELECT_CARD && context && context[1] && context[1][0] === intent.cleanse) {
      // the cleanse's target: the 불행 ally the heal is for
      const ally = opts.findIndex((o) => o.kind === K_CARD_PICK && o.card && o.card[1] === me && o.card[2] === LOCATION_MZONE
        && view.cards.some((c) => c.rel === 0 && c.loc === LOCATION_MZONE && c.seq === o.card[3] && (c.counters[COUNTER_UNLUCKY] || 0) > 0));
      if (ally >= 0) return [ally, "상태이상 해제: 회복할 불행 아군에게"];
    }
    if (intent && decision.msg !== MSG_SELECT_CARD) {
      const heal = opts.findIndex((o) => ACTIVATE_KINDS.has(o.kind) && !o.noop && o.card && o.card[0] === intent.code && o.desc === intent.desc);
      if (heal >= 0) {
        intent = null;
        return [heal, "상태이상 해제 다음 회복"];
      }
    }
    const o = opts[idx];
    if (!ACTIVATE_KINDS.has(o.kind) || !(enc.opts[idx][B + 24] > 0)) return [idx, note];
    const cleanses = opts.map((x, i) => i).filter((i) => isCleanse(opts[i]));
    if (cleanses.length) {
      const first = cleanses.reduce((a, b) => (probs[b] > probs[a] ? b : a));
      intent = { code: o.card[0], desc: o.desc, cleanse: opts[first].card[0], turn: view.turn, left: INTENT_DECISIONS };
      return [first, "불행 아군 회복: 상태이상 해제 먼저"];
    }
    // (no cleanse to play now: this heal would restore nothing - the next most likely move instead)
    const rest = probs.map((p, i) => (i === idx ? 0 : p));
    const best = rest.indexOf(Math.max(...rest));
    return [best, "불행 아군에게는 회복이 들지 않음"];
  }

  function baseDecision(duel, d) {
    const opt = (o) => ({ kind: o.kind, card: o.card ? cardTuple(duel, o.card, me) : null, desc: o.desc || 0,
      extra: 0, noop: !!o.noop });
    return { msg: MSG[d.type], player: me, min: d.type === "cards" ? d.min : 0, max: d.type === "cards" ? d.max : 0,
      cancelable: !!d.cancelable, hint: duel.hints[me] || 0, picked: null, context,
      options: d.type === "cards" ? [] : d.options.map(opt) };
  }

  /** the options of a card choice with `picked` taken (messages.SelectionState.refresh_options) */
  function pickOptions(cards, d, picked) {
    const out = [];
    cards.forEach((c, i) => {
      if (!picked.includes(i)) out.push({ kind: K_CARD_PICK, card: c, desc: 0, extra: 0, noop: false, value: i });
    });
    if (picked.length >= d.min && picked.length > 0) out.push({ kind: K_CARD_FINISH, card: null, desc: 0, extra: 0, noop: false });
    if (!picked.length && (d.cancelable || d.min === 0)) {
      out.push({ kind: K_CARD_CANCEL, card: null, desc: 0, extra: 0, noop: d.min > 0 });
    }
    return out;
  }

  function answer(duel, d) {
    const view = viewOf(duel, me);
    const decision = baseDecision(duel, d);
    if (d.type === "idle" || d.type === "battle" || d.type === "chain") decision.context = context = null;
    if (d.type === "cards") {
      const cards = d.cards.map((c) => cardTuple(duel, c, me));
      const raw = ["cards", cards, d.min, d.max, d.cancelable, decision.hint];
      const picked = [];
      for (;;) {
        decision.picked = [...picked];
        decision.options = pickOptions(cards, d, picked);
        const i = decision.options.length === 1 ? 0 : decide(view, decision, raw);
        const o = pickOptions(cards, d, picked)[i];
        if (o.kind === K_CARD_CANCEL) return null;
        if (o.kind === K_CARD_PICK) picked.push(o.value);
        if (o.kind === K_CARD_FINISH || picked.length >= Math.min(d.max, cards.length)) return picked;
      }
    }
    const raw = [d.type, decision.options.map((o) => [o.kind, o.card, o.desc])];
    const i = decision.options.length === 1 ? 0 : decide(view, decision, raw);
    const o = baseDecision(duel, d).options[i];
    if (CONTEXT_KINDS.has(o.kind)) context = [o.kind, o.card, o.desc];
    return i;
  }

  return {
    level,
    async ask(duel, d) {
      if (me === null) me = d.player;
      if (watched !== duel) {
        watched = duel;
        duel.listeners.push((e) => {
          if (e.type === "ask" && e.decision.player !== me) oppAsks += 1;
        });
      }
      const value = answer(duel, d);
      const passing = d.type === "chain" && d.options[value]?.kind === K_CHAIN_PASS;
      // a pass where the other player waits on this answer takes a moment too (passing at once would tell that
      // there was no support to use); any other pass is at once
      const ms = !delay ? 0 : !passing ? delay : HIDDEN_WINDOWS.has(d.window) ? delay * (0.6 + rng() * 1.4) : 0;
      if (ms) await wait(ms);
      return value;
    },
  };
}
