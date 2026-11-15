/* Which option the bot of each level plays from the model's odds (kirafan_ai.bridge.server: choose and the
 * overrides of the best level - the mind game when defending, the look-ahead's next step when the model is unsure). */
import { LOCATION_HAND } from "./data.js";
import { OPTION_BASE_DIM as B } from "./features.js";

const BLUFF_HAND = 5;
const BLUFF_MAX_P = 0.5;
const BLUFF_MIN_PROB = 0.05;
const DECK_SIZE = 60, DECK_BUFFS = 6;
const PLAN_TRUST = 0.5;
const PLAN_MIN_PROB = 0.03;

/** level -> null (the best move, with the overrides) or [temperature, least probability a move needs] */
export const LEVELS = { 4: null, 3: [2.2, 0.0], 2: [3.5, 0.0], 1: [5.5, 0.0] };

function pick(weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function pHoldsBuff(hand) {
  let none = 1.0;
  for (let i = 0; i < hand; i++) none *= (DECK_SIZE - DECK_BUFFS - i) / (DECK_SIZE - i);
  return 1.0 - none;
}

function bluffHeal(hands, rows, probs, rng) {
  const cands = rows.map((r, i) => i).filter((i) => rows[i][B + 35] > 0 && probs[i] >= BLUFF_MIN_PROB);
  if (!cands.length) return [null, ""];
  if (hands[0] >= BLUFF_HAND || pHoldsBuff(hands[1]) <= BLUFF_MAX_P) {
    return [cands.reduce((a, b) => (probs[b] > probs[a] ? b : a)), "심리전: 숨은 버프가 없으면 살리는 회복"];
  }
  return [pick(probs, rng), "심리전: 모델 확률대로"];
}

function planStep(rows, probs, idx) {
  if (probs[idx] >= PLAN_TRUST) return null;
  const mine = rows[idx][B + 41] > 0 ? rows[idx][B + 39] : null;
  const cands = rows.map((r, i) => i).filter((i) => rows[i][B + 36] > 0 && rows[i][B + 41] > 0 && probs[i] >= PLAN_MIN_PROB);
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (rows[b][B + 39] > rows[a][B + 39] || (rows[b][B + 39] === rows[a][B + 39] && probs[b] > probs[a]) ? b : a));
  if (rows[best][B + 39] <= 0 || (mine !== null && rows[best][B + 39] <= mine)) return null;
  return best;
}

function defenseStep(rows, probs, idx) {
  if (probs[idx] >= PLAN_TRUST) return null;
  const mine = rows[idx][B + 47] > 0 ? rows[idx][B + 43] : null;
  const cands = rows.map((r, i) => i).filter((i) => rows[i][B + 42] > 0 && rows[i][B + 47] > 0 && probs[i] >= PLAN_MIN_PROB);
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (rows[b][B + 43] < rows[a][B + 43] || (rows[b][B + 43] === rows[a][B + 43] && probs[b] > probs[a]) ? b : a));
  if (rows[best][B + 43] >= (mine !== null ? mine : rows[best][B + 44])) return null;
  return best;
}

/** per option a key shared by the options that are the same move (copies of one card in the hand) */
export function optionGroups(options) {
  return options.map((o, i) => (o.card && o.card[2] === LOCATION_HAND ? `${o.kind}:${o.card[0]}:${o.card[1]}:${o.desc}` : i));
}

/** the most likely move, counting copies of one card in the hand as one */
export function bestOf(groups, probs) {
  const best = new Map();
  groups.forEach((k, i) => {
    const g = best.get(k) || [0.0, i];
    g[0] += probs[i];
    best.set(k, g);
  });
  let out = null;
  for (const g of best.values()) if (out === null || g[0] > out[0]) out = g;
  return out[1];
}

/** [option index, note] the bot of `level` plays; rows: the encoded options, hands: [ours, the opponent's] */
export function choose(level, groups, rows, probs, hands, rng) {
  const params = LEVELS[level];
  if (params) {
    const [temperature, floor] = params;
    let w = probs.map((p) => (p >= floor ? p ** (1.0 / temperature) : 0.0));
    if (!w.some((x) => x)) w = [...probs];
    return [pick(w, rng), ""];
  }
  let idx = bestOf(groups, probs), note = "";
  if (rows[idx][B + 35] <= 0) {
    const [bluff, why] = bluffHeal(hands, rows, probs, rng);
    if (bluff !== null) {
      idx = bluff;
      note = why;
    }
  }
  const step = note ? null : planStep(rows, probs, idx);
  if (step !== null && step !== idx) {
    idx = step;
    note = "수읽기: 이번 턴에 더 많이 쓰러뜨리는 순서";
  }
  const guard = note ? null : defenseStep(rows, probs, idx);
  if (guard !== null && guard !== idx) {
    idx = guard;
    note = "수읽기(방어): 이번 턴에 아군을 덜 잃는 대응";
  }
  return [idx, note];
}
