/* Plays duels between two test players on the rules engine and reports what went wrong (Lua errors, crashes,
 * duels that do not end) - run from the browser console:
 *   (await import("./js/engine/selftest.js")).run({ games: 20 })   */
import { newDuel } from "./index.js";
import { simplePlayer } from "./players.js";

export function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** a readable line per log entry (for looking into a duel) */
export function lines(duel, { from = 0, to = Infinity } = {}) {
  const loc = (l) => ({ 1: "덱", 2: "패", 4: "배틀", 8: "서포트", 16: "돗테", 32: "마을", 64: "성전", 128: "아래", 0: "-" })[l] ?? l;
  return duel.log.filter((l) => !["shuffle", "solving", "chainEnd"].includes(l.type)).map((l) => {
    const c = l.card ? l.card.name.slice(0, 7) : "";
    switch (l.type) {
      case "move": return `이동 P${l.card.owner} ${c} ${loc(l.from.location)}→${loc(l.to.location)}`;
      case "ask": {
        const x = l.decision;
        return `질문 P${x.player} ${x.type} ` + (x.options ? x.options.map((o) => o.kind + (o.card ? ":" + o.card.name.slice(0, 4) : "") + (o.noop ? "x" : "")).join(",")
          : x.cards.map((k) => k.name.slice(0, 4)).join(",") + ` ${x.min}-${x.max}`);
      }
      case "phase": return `── ${l.turn}턴 ${l.phase}`;
      case "activate": return `발동 P${l.player} ${c} #${l.desc % 0x100000}`;
      case "lp": return `LP P${l.player} ${l.lp}`;
      case "counter": return `카운터 ${c} ${l.counter.toString(16)}=${l.count}`;
      case "error": return `오류 ${l.message.split("\n")[0]}`;
      default: return `${l.type} ${c}`;
    }
  }).slice(from, to);
}

export async function run({ games = 10, seed = 1, decks = null, timeout = 30000 } = {}) {
  const ai = await (await fetch("data/ai_decks.json")).json();
  const pool = decks || ai.decks.map((d) => ({ main: d.main, summoner: d.summoner, name: d.name }));
  const results = [];
  for (let g = 0; g < games; g++) {
    const rng = seeded(seed + g * 7919);
    const pair = [pool[Math.floor(rng() * pool.length)], pool[Math.floor(rng() * pool.length)]];
    const duel = await newDuel({ players: [simplePlayer(rng), simplePlayer(rng)], rng });
    const started = performance.now();
    let crash = null;
    let timedOut = false;
    try {
      await Promise.race([duel.play(pair), new Promise((r) => setTimeout(() => { timedOut = true; r(); }, timeout))]);
    } catch (err) {
      crash = String(err.stack || err).split("\n").slice(0, 4).join(" | ");
    }
    results.push({ game: g, decks: pair.map((d) => d.name), winner: duel.winner, reason: duel.winReason, turns: duel.turn,
      ms: Math.round(performance.now() - started), asks: duel.log.filter((l) => l.type === "ask").length,
      luaErrors: [...new Set(duel.rt.errors.map((e) => e.split("\n")[0]))], crash, timedOut, duel });
  }
  return results;
}
