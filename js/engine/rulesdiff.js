/* The web engine's side of the rules comparison with EDOPro (tools/rules_diff.py plays the same on ocgcore and
 * writes data/ai/test/rules_edopro.json) - from the browser console of any page of the site:
 *   (await import("./js/engine/rulesdiff.js")).run({ games: 300 })
 * Plays random duels with the same random player, counts the same things, and lists what one engine allowed or
 * did and the other never (or far less often), per game. */
import { newDuel, describe } from "./index.js";
import { seeded } from "./selftest.js";

const PHASE_NAMES = { 0x1: "draw", 0x2: "standby", 0x4: "main", 0x8: "battle", 0x100: "main2", 0x200: "end" };
const KIND_GROUP = { 1: "summon", 5: "activate", 9: "activate", 21: "activate", 6: "to_bp", 7: "to_ep", 10: "attack",
  11: "to_m2", 12: "battle_to_ep", 13: "effectyn", 14: "effectyn_no", 15: "yes", 16: "no", 22: "pass", 23: "number", 17: "option" };
const LOC_NAMES = { 0x1: "deck", 0x2: "hand", 0x4: "mzone", 0x8: "szone", 0x10: "grave", 0x20: "removed", 0x40: "extra" };
const MSG = { idle: 11, battle: 10, chain: 16, cards: 15, yesno: 13, effectyn: 12, number: 143 };

const phaseName = (p) => PHASE_NAMES[p >= 0x8 && p <= 0x80 ? 0x8 : p] || `0x${p.toString(16)}`;

function place(card) {
  if (card.holder) return LOC_NAMES[card.holder.location] || "overlay";
  if (card.location === 0x4 && card.sequence >= 5) return "emz";
  return LOC_NAMES[card.location] || `0x${card.location.toString(16)}`;
}

function optionKey(o, order = false) {
  const group = order ? "order" : KIND_GROUP[o.kind] || String(o.kind);
  if (o.card) return `${group}|${o.card.code}|${place(o.card)}|${o.desc || 0}`;
  return `${group}|||${["yes", "no", "number", "option"].includes(group) ? o.desc || 0 : 0}`;
}

/** the random player of tools/rules_diff.py (and its counting) */
function randomPlayer(rng, stats) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const add = (table, key) => (table[key] = (table[key] || 0) + 1);
  return {
    ask(duel, d) {
      const sit = `${phaseName(duel.phase)}/${duel.turnPlayer === d.player ? "own" : "opp"}/${duel.chain.length ? "chain" : "open"}`;
      if (d.type === "cards") {
        add(stats.decisionTypes, `15|${sit}`);
        add(stats.cards, `${d.hint}|${sit}`);
        for (const c of d.cards) add(stats.cardsOffered, `${d.hint}|${c.code}|${place(c)}`);
        const picked = [];
        for (;;) {
          const left = d.cards.map((c, i) => i).filter((i) => !picked.includes(i));
          const stop = [];
          if (picked.length >= d.min && picked.length > 0) stop.push("finish");
          if (!picked.length && d.min === 0) stop.push("cancel");   // (a cancel with min > 0 changes nothing)
          const choice = left.length && (!stop.length || rng() < 0.6) ? pick(left) : pick(stop.length ? stop : left);
          if (choice === "cancel") return Promise.resolve(d.cancelable ? null : []);
          if (choice === "finish") return Promise.resolve(picked);
          picked.push(choice);
          if (picked.length >= Math.min(d.max, d.cards.length)) return Promise.resolve(picked);
        }
      }
      if (d.options.length > 1) {
        add(stats.decisionTypes, `${MSG[d.type]}|${sit}`);
        for (const o of d.options) add(stats.opt, `${optionKey(o, d.window === "order")}|${sit}`);
      }
      const real = d.options.map((o, i) => [o, i]).filter(([o]) => !o.noop).map(([, i]) => i);
      return Promise.resolve(real.length ? pick(real) : 0);
    },
  };
}

function names(key) {
  return key.replace(/\b(1005\d{4})\b/g, (m) => describeCard(Number(m))).replace(/\|(\d{10,})\b/g, (m, d) => `|${describe(Number(d)) || d}`);
}

let cardNames = null;
const describeCard = (code) => (cardNames && cardNames[code] ? `${cardNames[code]}(${code})` : String(code));

function compare(edo, web, { minRate = 0.05, ratio = 3 } = {}) {
  const out = {};
  for (const table of ["opt", "optAny", "chain", "summon", "destroy", "counter", "decisionTypes", "cardsAny", "cardsOffered", "end"]) {
    const a = edo[table] || {}, b = web[table] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const onlyEdo = [], onlyWeb = [], far = [];
    for (const k of keys) {
      const ra = (a[k] || 0) / edo.games, rb = (b[k] || 0) / web.games;
      if (Math.max(ra, rb) < minRate) continue;
      const row = `${names(k)}  EDOPro ${ra.toFixed(2)} / 웹 ${rb.toFixed(2)}`;
      if (!b[k]) onlyEdo.push([ra, row]);
      else if (!a[k]) onlyWeb.push([rb, row]);
      else if (ra / rb >= ratio || rb / ra >= ratio) far.push([Math.max(ra, rb), row]);
    }
    const top = (xs) => xs.sort((x, y) => y[0] - x[0]).slice(0, 40).map(([, r]) => r);
    out[table] = { onlyEdo: top(onlyEdo), onlyWeb: top(onlyWeb), far: top(far) };
  }
  return out;
}

/** the options (card choices) counted regardless of the situation */
function anySituation(opt, parts = 4) {
  const out = {};
  for (const [k, n] of Object.entries(opt)) {
    const key = k.split("|").slice(0, parts).join("|");
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

/** hook(duel): called with each new duel (more counting for a closer look) */
export async function run({ games = 300, seed = 1, timeout = 60000, hook = null } = {}) {
  const ai = await (await fetch("data/ai_decks.json")).json();
  const engine = await (await fetch("data/engine.json")).json();
  cardNames = Object.fromEntries(Object.entries(engine.cards).map(([c, d]) => [c, d.name]));
  const pool = ai.decks.map((d) => ({ main: d.main, summoner: d.summoner }));
  const stats = { opt: {}, cards: {}, cardsOffered: {}, chain: {}, summon: {}, destroy: {}, counter: {}, end: {}, decisionTypes: {},
    byTurn: {} };
  const add = (table, key) => (stats[table][key] = (stats[table][key] || 0) + 1);
  const turns = [], problems = [];
  for (let g = 0; g < games; g++) {
    const rng = seeded(seed + g * 7919);
    const n = pool.length;
    const pair = [pool[g % n], pool[(Math.floor(g / n) + g) % n]];   // (tools/rules_diff.py: deck_pair)
    const duel = await newDuel({ players: [randomPlayer(rng, stats), randomPlayer(rng, stats)], rng });
    if (hook) hook(duel);
    const addCounter = duel.addCounter.bind(duel);
    duel.addCounter = (card, type, n) => {
      const ok = addCounter(card, type, n);
      if (ok) add("counter", `0x${type.toString(16)}`);
      return ok;
    };
    const byTurn = (what, n = 1) => (stats.byTurn[`${what}|${duel.turn}`] = (stats.byTurn[`${what}|${duel.turn}`] || 0) + n);
    duel.listeners.push((e) => {
      if (e.type === "chaining") {
        add("chain", `${e.card.code}|${LOC_NAMES[e.from] || e.from}|${e.desc || 0}`);
        byTurn("chain");
      } else if (e.type === "attack") byTurn("attack");
      else if (e.type === "draw") byTurn("draw", e.cards.length);
      else if (e.type === "move") {
        if (e.to.location === 0x4 && e.to.sequence < 5 && e.from.location !== 0x4) add("summon", String(e.card.code));
        if (e.from.location === 0x4 && e.to.location === 0x40) {
          add("destroy", String(e.card.code));
          byTurn("destroy");
        }
        if (e.from.location === 0x80 && e.to.location === 0x20) byTurn("hpLost");
      }
    });
    try {
      let timedOut = false;
      await Promise.race([duel.play(pair), new Promise((r) => setTimeout(() => { timedOut = true; r(); }, timeout))]);
      if (timedOut) problems.push(`#${g} 시간 초과 (${duel.turn}턴)`);
    } catch (err) {
      problems.push(`#${g} 오류: ${String(err.message || err).split("\n")[0]}`);
    }
    for (const e of new Set(duel.rt.errors.map((x) => x.split("\n")[0]))) problems.push(`#${g} Lua: ${e}`);
    const hints = duel.log.filter((e) => e.type === "hint" && e.hint === 2);
    const lastHint = hints.length ? hints[hints.length - 1].desc : 0;
    add("end", `${lastHint}|${duel.turn <= 2 ? "early" : duel.turn <= 12 ? "mid" : "late"}`);
    turns.push(duel.turn);
  }
  const web = { games, turns, ...stats, optAny: anySituation(stats.opt), cardsAny: anySituation(stats.cards, 1) };
  const edo = await (await fetch("data/ai/test/rules_edopro.json", { cache: "reload" })).json();
  edo.optAny = anySituation(edo.opt);
  edo.cardsAny = anySituation(edo.cards, 1);
  window.rulesWeb = web;
  window.rulesEdo = edo;
  const avg = (xs) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  return { turns: { edopro: avg(edo.turns), web: avg(turns) }, problems: problems.slice(0, 30), diff: compare(edo, web) };
}
