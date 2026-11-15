/* Players that are not people: the stand-in AI until the learning model runs in the page. */
import { K } from "./flow.js";

export const SANCTUARY_HINT = 10050112 * 0x100000 + 4;   // "성전으로 보낼 크리에메이트를 4체 선택하세요"
export const SANCTUARY_ONE_HINT = 10050112 * 0x100000 + 5;   // "성전으로 보낼 카드를 1장까지 선택하세요"

const isBattle = (card) => (card.data.race & 7) !== 0;   // 전사 / 마법사 / 나이트
// the windows the other player is asked in even with nothing to use (flow.js: alwaysAsk, respond)
const HIDDEN_WINDOWS = new Set(["battleStart", "attack", "battleEnd", "respond"]);

/** a puzzle's other player, as ocgcore answers for player 1 with DUEL_SIMPLE_AI: yes to every question, the first
 *  cards to pick, the forced effect first, and in a chain window its first effect while none of its is in the chain;
 *  on its own turn it goes straight to the battle phase and attacks only when it must (EFFECT_MUST_ATTACK leaves
 *  it no end of the battle). delay: milliseconds before each answer that does something */
export function puzzlePlayer({ delay = 0 } = {}) {
  const answer = (duel, d) => {
    if (d.type === "cards") return Array.from({ length: d.min }, (_, i) => i);
    const first = (kinds) => d.options.findIndex((o) => kinds.includes(o.kind) && !o.noop);
    if (d.type === "yesno" || d.type === "effectyn" || d.type === "number") return 0;
    if (d.type === "idle") return Math.max(0, first([K.TO_BP]));
    if (d.type === "battle") {
      const end = first([K.BATTLE_TO_EP]);
      return end >= 0 ? end : Math.max(0, first([K.ATTACK]));
    }
    if (d.type === "chain") {
      if (d.window === "order") return 0;
      const pass = d.options.findIndex((o) => o.kind === K.CHAIN_PASS);
      const mine = duel.chain.some((link) => link.player === d.player);
      const act = first([K.CHAIN_ACTIVATE]);
      return act >= 0 && !mine ? act : Math.max(0, pass);
    }
    return 0;
  };
  return {
    ask(duel, d) {
      const value = answer(duel, d);
      const passing = d.type === "chain" && d.options[value]?.kind === K.CHAIN_PASS;
      return delay && !passing ? new Promise((resolve) => setTimeout(() => resolve(value), delay)) : Promise.resolve(value);
    },
  };
}

/** random, but plays the way a person would try: battle creamates stay in the opening hand, summons and
 *  attacks first, a chain answered now and then. delay: milliseconds before each answer (so it can be followed) */
export function simplePlayer(rng = Math.random, { delay = 0 } = {}) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const answer = (duel, d) => {
    if (d.type === "cards") {
      const order = d.cards.map((c, i) => i);
      duel.shuffle(order);
      if (d.hint === SANCTUARY_HINT) order.sort((a, b) => isBattle(d.cards[a]) - isBattle(d.cards[b]));
      const count = d.min + Math.floor(rng() * (d.max - d.min + 1));
      return order.slice(0, Math.max(d.min, count));
    }
    const real = d.options.map((o, i) => ({ o, i })).filter(({ o }) => !o.noop);
    if (!real.length) return 0;
    if (d.type === "chain" && real.length === 1) return real[0].i;   // (only passing: no thinking)
    const by = (kinds) => real.filter(({ o }) => kinds.includes(o.kind));
    const roll = rng();
    if (d.type === "idle") {
      const s = by([K.SPSUMMON]);
      if (s.length && roll < 0.8) return pick(s).i;
      const a = by([K.ACTIVATE]);
      if (a.length && roll < 0.9) return pick(a).i;
      return by([K.TO_BP])[0]?.i ?? 0;
    }
    if (d.type === "battle") {
      const at = by([K.ATTACK]);
      if (at.length && roll < 0.7) return pick(at).i;
      const a = by([K.BATTLE_ACTIVATE]);
      if (a.length && roll < 0.85) return pick(a).i;
      return by([K.BATTLE_TO_EP])[0]?.i ?? 0;
    }
    if (d.type === "chain") {
      const a = by([K.CHAIN_ACTIVATE]);
      if (a.length && roll < 0.3) return pick(a).i;
      return by([K.CHAIN_PASS])[0]?.i ?? 0;
    }
    return pick(real).i;
  };
  return {
    ask(duel, d) {
      const value = answer(duel, d);
      const passing = d.type === "chain" && d.options[value]?.kind === K.CHAIN_PASS;
      // a pass where the other player waits on this answer takes a moment too (passing at once would tell that
      // there was no support to use); any other pass is at once
      const wait = !delay ? 0 : !passing ? delay : HIDDEN_WINDOWS.has(d.window) ? delay * (0.6 + rng() * 1.4) : 0;
      return wait ? new Promise((resolve) => setTimeout(() => resolve(value), wait)) : Promise.resolve(value);
    },
  };
}
