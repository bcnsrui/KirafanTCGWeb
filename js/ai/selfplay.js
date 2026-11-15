/* Duels of the learning AI on the web engine against the stand-in AI (players.simplePlayer), seats taken in turn -
 * from the browser console of any page of the site:
 *   (await import("./js/ai/selfplay.js")).run({ games: 10, level: 4 })
 * Reports the AI's wins, crashes and Lua errors, and the time a decision takes. */
import { newDuel } from "../engine/index.js";
import { simplePlayer } from "../engine/players.js";
import { seeded } from "../engine/selftest.js";
import { modelPlayer } from "./agent.js";

export async function run({ games = 10, level = 4, seed = 1, versus = null, timeout = 120000 } = {}) {
  const ai = await (await fetch("data/ai_decks.json")).json();
  const pool = ai.decks.map((d) => ({ main: d.main, summoner: d.summoner, name: d.name }));
  const results = [];
  const notes = {};
  for (let g = 0; g < games; g++) {
    const rng = seeded(seed + g * 7919);
    const pair = [pool[Math.floor(rng() * pool.length)], pool[Math.floor(rng() * pool.length)]];
    const seat = g % 2;
    let decisions = 0, ms = 0;
    const model = await modelPlayer({ level, rng, log: (e) => {
      decisions++;
      if (e.note) notes[e.note] = (notes[e.note] || 0) + 1;
    } });
    const timed = { ask: async (duel, d) => {
      const t = performance.now();
      const v = await model.ask(duel, d);
      ms += performance.now() - t;
      return v;
    } };
    const other = versus === "model" ? await modelPlayer({ level, rng }) : simplePlayer(rng);
    const duel = await newDuel({ players: seat === 0 ? [timed, other] : [other, timed], rng });
    let crash = null, timedOut = false;
    try {
      await Promise.race([duel.play(pair), new Promise((r) => setTimeout(() => { timedOut = true; r(); }, timeout))]);
    } catch (err) {
      crash = String(err.stack || err).split("\n").slice(0, 5).join(" | ");
    }
    results.push({ game: g, aiSeat: seat, aiWon: duel.winner === seat, winner: duel.winner, reason: duel.winReason,
      turns: duel.turn, aiDecisions: decisions, msPerAiDecision: decisions ? +(ms / decisions).toFixed(1) : 0,
      luaErrors: [...new Set(duel.rt.errors.map((e) => e.split("\n")[0]))], crash, timedOut });
  }
  const done = results.filter((r) => !r.crash && !r.timedOut);
  return { games, aiWins: results.filter((r) => r.aiWon).length, crashes: results.filter((r) => r.crash).length,
    timeouts: results.filter((r) => r.timedOut).length,
    avgTurns: +(done.reduce((n, r) => n + r.turns, 0) / Math.max(1, done.length)).toFixed(1),
    msPerAiDecision: +(done.reduce((n, r) => n + r.msPerAiDecision, 0) / Math.max(1, done.length)).toFixed(1),
    notes, results };
}
