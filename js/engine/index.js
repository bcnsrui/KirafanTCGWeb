/* The rules engine's entry: a duel over the card scripts.
 *
 *   const duel = await newDuel({ players: [me, ai] });
 *   const winner = await duel.play([{ main, summoner }, { main, summoner }]);   // player 0 moves first
 *
 * A player is { human?, ask(duel, decision) -> answer } (flow.js: the decisions and their answers). */
import { Duel } from "./duel.js?v=hp2";
import "./actions.js?v=hp2";
import "./flow.js?v=hp2";
import "./puzzle.js?v=hp2";
import { createRuntime } from "./runtime.js";
import { engineDataUrl, getLang } from "../lang.js";

let data = null;
let dataLang = null;

async function loadData() {
  const lang = getLang();
  if (!data || dataLang !== lang) {
    const [engine, scripts] = await Promise.all(
      [engineDataUrl(), "data/scripts.json"].map((f) => fetch(f).then((r) => r.json())),
    );
    data = { engine, scripts };
    dataLang = lang;
  }
  return data;
}

export async function newDuel({ players, rng } = {}) {
  const { engine, scripts } = await loadData();
  const rt = await createRuntime(scripts);
  const duel = new Duel({ db: engine.cards, C: rt.C, rt, rng, players });
  rt.duel = duel;
  duel.system = engine.system;
  return duel;
}

/** the text of an effect description (aux.Stringid: the card's code * 2^20 + the string's index) */
export function describe(desc) {
  if (!data || !desc) return "";
  const code = Math.floor(desc / 0x100000);
  const card = data.engine.cards[code];
  const text = card ? card.strings[desc % 0x100000] : data.engine.system[desc];
  return (text || "").replace(/\r/g, "");
}

/** a player that picks at random (tests, and a stand-in until the AI model is ported) */
export const randomPlayer = {
  ask(duel, d) {
    const r = () => duel.rng();
    if (d.type === "cards") {
      const pool = d.cards.map((_, i) => i);
      duel.shuffle(pool);
      const count = d.min + Math.floor(r() * (d.max - d.min + 1));
      return Promise.resolve(pool.slice(0, Math.max(d.min, count)));
    }
    const real = d.options.map((o, i) => [o, i]).filter(([o]) => !o.noop);
    const pick = real.length ? real[Math.floor(r() * real.length)][1] : 0;
    return Promise.resolve(pick);
  },
};

export { Duel };
