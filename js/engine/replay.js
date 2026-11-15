/* EDOPro's recorded games played again on the web engine, decision by decision (tools/replay_record.py writes
 * data/ai/test/replay_edopro.jsonl) - from the browser console of any page of the site:
 *   (await import("./js/engine/replay.js")).run({ games: 200 })
 * The web takes the cards EDOPro took off the deck and the HP cards its random choices took, and each player
 * answers as EDOPro's did. At every decision the state the player sees is compared with EDOPro's; the first time
 * the state, the question or the options do not allow the same play, that game stops there and why is reported.
 * Questions only one side asks are let through where nothing was done in them (EDOPro's extra chain windows,
 * the single attack target the web picks by itself). */
import { newDuel, describe } from "./index.js";
import { viewOf } from "../ai/view.js";
import { engineDataUrl } from "../lang.js";

const PLACES = { 0x1: "deck", 0x2: "hand", 0x8: "sz", 0x10: "gr", 0x20: "rm", 0x40: "ex" };
const NUMERIC_DESC = [13, 14, 15, 16, 17, 23];
const MSG = { idle: 11, battle: 10, chain: 16, cards: 15, yesno: 13, effectyn: 12, number: 143 };
const PASS = "22||||0";
const ACTIVATE = [5, 9, 21];

class Stop extends Error {}

function place(loc, seq) {
  if (loc & 0x80) return `ov:${place(loc & 0x7f, seq)}`;
  if (loc === 0x4) return seq >= 5 ? "emz" : `mz${seq}`;
  if (loc === 0x8) return "sz";   // (which support zone does not matter: noSupportZone)
  return PLACES[loc] || `0x${loc.toString(16)}`;
}

function where(card) {
  return card.holder ? place(card.holder.location | 0x80, card.holder.sequence) : place(card.location, card.sequence);
}

const cardKey = (c) => `${c.code}|${c.holder ? c.holder.controller : c.controller}|${where(c)}`;

function optionKey(o) {
  if (o.card) return `${o.kind}|${cardKey(o.card)}|${o.desc || 0}`;
  return `${o.kind}||||${NUMERIC_DESC.includes(o.kind) ? o.desc || 0 : 0}`;
}

/** tools/replay_record.py compact() */
function compact(view) {
  const out = { players: [], field: [], extra: [], grave: [[], []], hand: [], removed: [] };
  for (const p of view.players) {
    out.players.push([p.hand || 0, p.deck || 0, p.grave || 0, p.removed || 0, p.extra || 0, p.summoner_def || 0, p.sanctuary_level || 0]);
  }
  const cards = [...view.cards].sort((a, b) => a.rel - b.rel || a.loc - b.loc || a.seq - b.seq);
  for (const c of cards) {
    const counters = Object.entries(c.counters).map(([k, n]) => [Number(k), n]).filter(([, n]) => n).sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}:${n}`).join(",");
    if (c.loc === 0x4 || c.loc === 0x8) out.field.push(`${c.rel}|${place(c.loc, c.seq)}|${c.code}|${c.pos}|${c.atk}|${c.def}|${c.overlay}|${counters}`);
    else if (c.loc === 0x40) out.extra.push(`${c.rel}|${c.code}|${c.pos}`);
    else if (c.loc === 0x10) out.grave[c.rel].push(c.code);
    else if (c.loc === 0x2 && c.rel === 0) out.hand.push(c.code);
    else if (c.loc === 0x20 && c.rel === 0) out.removed.push(c.code);
  }
  for (const k of ["field", "extra", "hand", "removed"]) out[k].sort();
  return out;
}

function stateDiff(edo, web) {
  const out = [];
  const multiset = (name, a, b) => {
    const left = [...b];
    const onlyE = [];
    for (const x of a) {
      const i = left.indexOf(x);
      if (i >= 0) left.splice(i, 1);
      else onlyE.push(x);
    }
    if (onlyE.length || left.length) out.push(`${name}: EDOPro만 [${onlyE.join(" ; ")}] / 웹만 [${left.join(" ; ")}]`);
  };
  edo.players.forEach((p, rel) => {
    const names = ["패", "덱", "돗테오키 존", "마을", "엑스트라", "성채석 한도", "성전 레벨"];
    p.forEach((x, i) => {
      if (x !== web.players[rel][i]) out.push(`${rel ? "상대" : "자신"} ${names[i]}: EDOPro ${x} / 웹 ${web.players[rel][i]}`);
    });
  });
  // (which support zone a support took does not matter - a player's own chain the web takes in another order)
  const anySupportZone = (xs) => xs.map((x) => x.replace(/\|sz\d\|/, "|sz|"));
  multiset("필드", anySupportZone(edo.field), anySupportZone(web.field));
  multiset("엑스트라", edo.extra, web.extra);
  [0, 1].forEach((rel) => {
    if (JSON.stringify(edo.grave[rel]) !== JSON.stringify(web.grave[rel])) out.push(`${rel ? "상대" : "자신"} 돗테오키 존 순서: EDOPro [${edo.grave[rel]}] / 웹 [${web.grave[rel]}]`);
  });
  multiset("패", edo.hand, web.hand);
  multiset("마을", edo.removed, web.removed);
  return out;
}

let names = null;
function label(key) {
  return String(key).replace(/\b(1005\d{4})\b/g, (m) => (names[m] ? `${names[m]}` : m))
    .replace(/\|(\d{10,})$/, (m, d) => `|${describe(Number(d)) || d}`);
}

/** one recorded game on the web engine -> { ok, reason, detail, turn, at, notes } (debug: and the web duel) */
async function replayGame(game, pool, { timeout = 60000, debug = false } = {}) {
  const entries = game.entries;
  // (EDOPro's keys without the support zone's number, as the web's: a player's own chain the web takes in another
  // order puts its supports in other zones)
  const noSupportZone = (s) => (typeof s === "string" ? s.replace(/\|sz\d(\||$)/g, "|sz$1") : s);
  for (const e of entries) {
    if (e.options) e.options = e.options.map(noSupportZone);
    if (e.chosen) e.chosen = noSupportZone(e.chosen);
    if (e.cards) e.cards = e.cards.map(noSupportZone);
    if (e.picks) e.picks = e.picks.map(noSupportZone);
  }
  let at = 0;
  let stop = null;
  const recent = [];
  const notes = [];
  const queues = game.deckExits.map((q) => [...q]);
  const picks = game.randomPicks.map((q) => [...q]);
  let duelRef = null;
  let webLog = [];       // (what happened on the web since the last decision both made alike)
  let spanStart = 0;     // (... and on EDOPro: the logs of its entries from here)
  const halt = (reason, detail) => {
    if (stop) return;
    const edo = entries.slice(spanStart, at + 1).flatMap((x) => x.log || []);
    stop = { reason, detail, turn: duelRef ? duelRef.turn : 0, at, recent: [...recent],
      edoLog: edo.slice(-30).map(label).join(" | "), webLog: webLog.slice(-30).map(label).join(" | ") };
  };
  const matched = () => {
    webLog = [];
    spanStart = at;
  };
  const situation = (duel) => `${duel.turn}턴 ${duel.phase.toString(16)}`;
  const consumed = new Set();   // (EDOPro's entries the web answered ahead of their turn)
  let selfChains = 0;           // (EDOPro's chains of one player's own supports, taken last first)
  let orderPlan = [];   // (the web's "which first?" answers: EDOPro's chain order, resolved last first)
  let orderPlayer = -1;
  const checkState = (duel, d, e) => {
    // (EDOPro in the middle of a chain: its links are still to resolve, the web resolves each at once; or one of
    // a player's own chain the web takes in another order)
    if (e.chain || e.reordered) return;
    const diff = stateDiff(e.state, compact(viewOf(duel, d.player, { attack: false })));
    if (diff.length) {
      const what = e.msg === 15 ? `카드 선택 (${label(String(e.hint))})` : `msg ${e.msg} → ${label(e.chosen)}`;
      halt("상태가 다름", [...diff.slice(0, 6), `비교한 결정: P${d.player} EDOPro ${what} (페이즈 ${e.phase.toString(16)}) / 웹 ${d.type}/${d.window || ""} (페이즈 ${duel.phase.toString(16)})`]);
      throw new Stop();
    }
  };
  const player = {
    async ask(duel, d) {
      const before = at;
      const answer = decide(duel, d);
      if (at !== before) matched();
      return answer;
    },
  };
  // (EDOPro's very card - its cardid, the web's uid + 1 - among copies of one code in one place, the hand; else
  // any of them)
  const picksOf = (d, e) => {
    const keys = d.cards.map(cardKey);
    const used = [];
    e.picks.forEach((k, n) => {
      const id = (e.pickIds || [])[n];
      let i = id ? keys.findIndex((x, j) => x === k && !used.includes(j) && d.cards[j].uid === id - 1) : -1;
      if (i < 0) i = keys.findIndex((x, j) => x === k && !used.includes(j));
      used.push(i);
    });
    return used;
  };
  const optionOf = (d, e, fits) => {
    const keys = d.options.map(optionKey);
    const exact = e.chosenId ? keys.findIndex((k, j) => fits(k) && d.options[j].card && d.options[j].card.uid === e.chosenId - 1) : -1;
    return exact >= 0 ? exact : keys.findIndex(fits);
  };
  const activation = (e) => e && e.chosen && !e.forced
    && ((e.msg === 16 && e.chosen.startsWith("21|")) || ((e.msg === 11 || e.msg === 10) && /^(5|9)\|/.test(e.chosen)));
  /** EDOPro: a player chains its own supports one onto another (heal, then 불행 cleanse onto it) and they resolve
   *  last first; the web resolves each before the next (continueSupports: the cleanse first, then the heal). So
   *  the web takes them last first: EDOPro's entries of that chain from entries[i] reordered so */
  function reorderSelfChain(i) {
    const a = entries[i];
    const starts = [i];
    let level = a.chain;
    let end = i + 1;
    for (let j = i + 1; j < entries.length && j < i + 40; j++) {
      const f = entries[j];
      if (f.turn !== a.turn) break;
      if (f.msg === 16 && !f.forced && f.p === a.p && f.chain === level + 1 && activation(f)) {
        starts.push(j);
        level++;
        end = j + 1;
        continue;
      }
      if (f.msg === 15 && j === end) {   // (what the last one asked as it was activated: its cost, its targets)
        end = j + 1;
        continue;
      }
      if (f.msg === 16 && !f.forced && f.p !== a.p && f.chosen === PASS) continue;
      if (f.msg === 15 && starts.length && f.chain === level) continue;
      break;
    }
    if (starts.length < 2) return;
    const segs = starts.map((s, k) => entries.slice(s, k + 1 < starts.length ? starts[k + 1] : end));
    const block = segs.reverse().flat();
    for (const x of block) x.reordered = true;
    entries.splice(i, end - i, ...block);
    selfChains++;
  }
  function decide(duel, d) {
    {
      if (stop) throw new Stop();
      if (d.type !== "cards" && d.options.length === 1) return 0;
      if (d.type === "chain" && d.window === "order") return answerOrder(duel, d);
      for (;;) {
        while (consumed.has(at)) at++;
        if (activation(entries[at]) && !entries[at].reordered && entries[at].p === d.player && !duel.chain.length) reorderSelfChain(at);
        const e = entries[at];
        if (!e) {
          halt("EDOPro 기록이 끝났는데 웹 대전이 계속됨", `${d.type} (P${d.player})`);
          throw new Stop();
        }
        const same = e.p === d.player && MSG[d.type] === e.msg && (d.type !== "cards" || e.hint === d.hint) && !e.forced;
        // (a chain window where EDOPro passed may be one the web reaches with the chain already resolved -
        // EDOPro's answers come before resolution, the web's after: its state is not compared)
        // (EDOPro's window after a phase effect where it passed, then at once - nothing happened between - the
        // phase's own where it activated: one window on the web, where it activates)
        const next = entries[at + 1];
        if (same && d.type === "chain" && e.chosen === PASS && next && next.msg === 16 && !next.forced && next.p === e.p
          && !next.chain && !(next.log || []).length && JSON.stringify(next.state) === JSON.stringify(e.state)
          && next.chosen !== PASS && d.options.map(optionKey).includes(next.chosen)) {
          at++;
          continue;
        }
        // (EDOPro asks the player who just activated whether it chains onto its own link; the web does not, and has
        // resolved that chain already)
        if (e.msg === 16 && !e.forced && e.chosen === PASS && e.chain > 0 && !duel.chain.length) {
          at++;
          continue;
        }
        if (same && d.type === "chain" && e.chosen === PASS) {
          at++;
          return d.options.map(optionKey).indexOf(PASS);
        }
        if (same) {
          checkState(duel, d, e);
          if (d.type === "cards") {
            const used = picksOf(d, e);
            const missing = used.indexOf(-1);
            if (missing >= 0) {
              halt("EDOPro가 고른 카드를 웹에서 고를 수 없음", `${label(e.picks[missing])} (후보: ${d.cards.map(cardKey).map(label).join(", ")})`);
              throw new Stop();
            }
            at++;
            recent.push(`P${d.player} 카드 선택 ${e.picks.map(label).join(", ") || "(없음)"}`);
            if (e.cancel) return d.cancelable ? null : [];
            return used;
          }
          const keys = d.options.map(optionKey);
          const onlyE = e.options.filter((k) => !keys.includes(k));
          const onlyW = keys.filter((k) => !e.options.includes(k));
          if (onlyE.length || onlyW.length) notes.push({ where: `${situation(duel)} ${d.type}/${d.window || ""}`, onlyE, onlyW });
          const i = optionOf(d, e, (k) => k === e.chosen);
          if (i < 0) {
            halt("EDOPro가 고른 선택지가 웹에 없음", `${label(e.chosen)} (웹: ${keys.map(label).join(", ")})`);
            throw new Stop();
          }
          at++;
          recent.push(`P${d.player} ${d.type}: ${label(e.chosen)}`);
          return i;
        }
        // a chain window only EDOPro asked, where it passed / the attack target the web picked by itself /
        // EDOPro's order of effects the web resolved by itself
        if (e.msg === 16 && !e.forced && e.chosen === PASS) {
          at++;
          continue;
        }
        if (e.msg === 15 && e.hint === 549 && e.cards.length === 1) {
          at++;
          continue;
        }
        // what EDOPro activated in a chain window, the web offers on its menu
        if (e.msg === 16 && !e.forced && e.p === d.player && (d.type === "idle" || d.type === "battle")) {
          const rest = e.chosen.split("|").slice(1).join("|");
          const i = optionOf(d, e, (k) => ACTIVATE.includes(Number(k.split("|")[0])) && k.split("|").slice(1).join("|") === rest);
          if (i >= 0) {
            at++;
            recent.push(`P${d.player} ${d.type} (EDOPro는 체인 창에서): ${label(e.chosen)}`);
            return i;
          }
        }
        if (e.msg === 16 && e.forced) {
          notes.push({ where: `${situation(duel)} EDOPro만 순서 질문`, onlyE: e.options, onlyW: [] });
          at++;
          continue;
        }
        // a chain window only EDOPro had, where it did something the web lets it do now
        if (e.msg === 16 && !e.forced && e.p === d.player && d.type === "chain") {
          const i = optionOf(d, e, (k) => k === e.chosen);
          if (i >= 0) {
            checkState(duel, d, e);
            at++;
            recent.push(`P${d.player} chain: ${label(e.chosen)}`);
            return i;
          }
        }
        // a window only the web asks: nothing done in it
        if (d.type === "chain") {
          const pass = d.options.findIndex((o) => o.kind === 22);
          if (pass >= 0) return pass;
        }
        // a choice EDOPro made a little later: of triggers in one chain it chose every target first and resolved
        // them after, the web resolves each before the next one is activated
        if (d.type === "cards") {
          const keys = d.cards.map(cardKey);
          const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
          for (let j = at + 1; j < at + 10 && entries[j]; j++) {
            const f = entries[j];
            if (consumed.has(j) || f.msg !== 15 || f.p !== d.player || f.hint !== d.hint || !same(f.cards, keys)) continue;
            consumed.add(j);
            const used = picksOf(d, f);
            recent.push(`P${d.player} 카드 선택 (EDOPro는 나중에) ${f.picks.map(label).join(", ") || "(없음)"}`);
            if (f.cancel) return d.cancelable ? null : [];
            return used;
          }
        }
        halt("질문이 다름", `웹: P${d.player} ${d.type}/${d.window || ""} [${(d.options || d.cards).map((o) => label(d.type === "cards" ? cardKey(o) : optionKey(o))).join(", ")}]`
          + ` / EDOPro: P${e.p} msg ${e.msg} ${label(e.chosen || e.picks.join(","))}`);
        throw new Stop();
      }
    }
  }
  /** the web's "which first?": EDOPro chained these one question at a time (the last one by itself) and resolved
   *  them last first - the web resolves its picks first, so it picks in EDOPro's resolution order */
  function answerOrder(duel, d) {
    const keys = d.options.map(optionKey);
    // EDOPro's questions of this order may come after windows where it passed
    let i = at;
    while (entries[i] && entries[i].msg === 16 && !entries[i].forced && entries[i].chosen === PASS) i++;
    // (EDOPro's own question if it has one now - a window came between, its picks go on from there; else what is
    // left of the plan, unless that is of an earlier question the web answered by itself, the last one alone)
    const fresh = entries[i] && entries[i].msg === 16 && entries[i].forced && entries[i].p === d.player;
    if (fresh || orderPlayer !== d.player || !orderPlan.some((k) => keys.includes(k))) orderPlan = [];
    if (!orderPlan.length) {
      orderPlayer = d.player;
      const chained = [];
      let left = null;
      while (entries[i] && entries[i].msg === 16 && entries[i].forced && entries[i].p === d.player) {
        chained.push(entries[i].chosen);
        left = entries[i].options.filter((k) => !chained.includes(k) && k.split("|")[0] === "21");
        i++;
      }
      if (!chained.length) {
        notes.push({ where: `${situation(duel)} 웹만 순서 질문`, onlyE: [], onlyW: keys });
        return 0;
      }
      at = i;
      // (a continuous one EDOPro runs as picked; the triggers wait in its chain and resolve last first)
      const continuous = new Set(d.options.filter((o) => o.effect && o.effect.type & duel.C.EFFECT_TYPE_CONTINUOUS).map(optionKey));
      const picked = [...chained, ...(left || [])];
      orderPlan = [...picked.filter((k) => continuous.has(k)), ...picked.filter((k) => !continuous.has(k)).reverse()];
    }
    const next = orderPlan.findIndex((k) => keys.includes(k));
    if (next < 0) {
      halt("처리 순서 질문의 선택지가 다름", `웹: ${keys.map(label).join(", ")} / EDOPro: ${orderPlan.map(label).join(", ")}`);
      throw new Stop();
    }
    const k = orderPlan.splice(next, 1)[0];
    if (orderPlan.length && !orderPlan.some((x) => keys.includes(x) && x !== k)) orderPlan = [];
    recent.push(`P${d.player} 순서: ${label(k)}`);
    return keys.indexOf(k);
  }

  // (a seeded rng: a game replays the same every time - its shuffles pick which copy of a code a choice takes)
  let seed = (game.game + 1) * 0x9e3779b1;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const duel = await newDuel({ players: [player, player], rng });
  duelRef = duel;
  // (a recorded card: [code, cardid] - ocgcore's cardid 2 is the first card made, the web's cards[0] - or the
  // code alone; a card made later, a token, may be another on the web: then any card of that code)
  const codeOf = (x) => (Array.isArray(x) ? x[0] : x);
  const cardOf = (x) => {
    const c = Array.isArray(x) && x[1] ? duel.cards[x[1] - 2] : null;
    return c && c.code === x[0] ? c : null;
  };
  // (the very card if the web has it there; another of its code if a choice took another copy before - a card
  // picked in the hand by its code)
  const isIt = (x, c, among) => (cardOf(x) && among.includes(cardOf(x)) ? cardOf(x) === c : codeOf(x) === c.code);
  duel.alignDeckTop = (p, n) => {
    const deck = duel.p[p].deck, q = queues[p];
    for (let i = 0; i < n && i < q.length; i++) {
      const pos = deck.length - 1 - i;
      if (pos < 0) break;
      const below = deck.slice(0, pos + 1);
      if (isIt(q[i], deck[pos], below)) continue;
      let j = -1;
      for (let k = pos - 1; k >= 0; k--) if (isIt(q[i], deck[k], below)) { j = k; break; }
      if (j < 0) {
        halt("덱에 EDOPro가 뽑은 카드가 없음", `P${p} ${label(codeOf(q[i]))}`);
        break;
      }
      [deck[pos], deck[j]] = [deck[j], deck[pos]];
    }
    duel.renumber(p);
  };
  duel.autoAttackTarget = (attacker, targets) => {
    const e = entries[at];
    if (stop || !e || e.msg !== 15 || e.hint !== 549 || e.p !== attacker.controller) return null;
    at++;
    matched();
    const c = targets[targets.map(cardKey).indexOf(e.picks[0])];
    if (c) recent.push(`P${e.p} 공격 대상 (웹은 묻지 않음) ${label(e.picks[0])}`);
    return c || null;
  };
  duel.randomPick = (pool, n) => {
    if (n <= 0 || !pool.length) return [];   // (EDOPro picks nothing then, nor says so)
    const want = picks.shift();
    if (!want || want.length !== n) {
      halt("무작위 선택이 다름", `웹 ${n}장 / EDOPro ${want ? want.length : "없음"}`);
      return null;
    }
    const out = [];
    for (const x of want) {
      const left = pool.filter((y) => !out.includes(y));
      const c = left.find((y) => isIt(x, y, left));
      if (!c) {
        halt("EDOPro가 무작위로 고른 체력 카드가 웹에 없음", `${label(codeOf(x))} (웹의 체력 카드: ${pool.map((y) => label(y.code)).join(", ")})`);
        return null;
      }
      out.push(c);
    }
    return out;
  };
  duel.listeners.push((ev) => {
    const hex = (x) => x.toString(16);
    if (ev.type === "move") webLog.push(`M ${ev.card.code} ${ev.from.controller}:${hex(ev.from.location)}->${ev.to.controller}:${hex(ev.to.location)}`);
    else if (ev.type === "chaining") webLog.push(`C ${ev.card.code}`);
    else if (ev.type === "solved") webLog.push("S");
    else if (ev.type === "draw") webLog.push(`D${ev.player} ${ev.cards.map((c) => c.code).join(",")}`);
    else if (ev.type === "phase") webLog.push(`P${hex(ev.phase)}`);
    else if (ev.type === "turn") webLog.push("T");
    else if (ev.type === "attack") webLog.push("A");
    if (ev.type === "move" && ev.from.location === 0x1 && ev.to.location !== 0x1) {
      const p = ev.from.controller, q = queues[p];
      let i = q.findIndex((x) => cardOf(x) === ev.card);
      if (i < 0) i = q.findIndex((x) => codeOf(x) === ev.card.code);
      if (i < 0) halt("EDOPro에서는 덱에서 나오지 않은 카드", `P${p} ${label(ev.card.code)}`);
      else {
        if (i > 0) notes.push({ where: `${situation(duel)} 덱에서 나온 순서`, onlyE: [codeOf(q[0])], onlyW: [ev.card.code] });
        q.splice(i, 1);
      }
    }
  });
  let crashed = null;
  try {
    let timedOut = false;
    const decks = game.decks.map((i, p) => ({ main: game.order ? game.order[p] : pool[i].main, summoner: pool[i].summoner }));
    await Promise.race([duel.play(decks),
      new Promise((r) => setTimeout(() => { timedOut = true; r(); }, timeout))]);
    if (timedOut && !stop) halt("시간 초과", "");
  } catch (err) {
    if (!(err instanceof Stop)) crashed = String(err.stack || err).split("\n").slice(0, 3).join(" | ");
  }
  if (crashed && !stop) halt("오류", crashed);
  const lua = [...new Set(duel.rt.errors.map((x) => x.split("\n")[0]))];
  if (!stop && lua.length) halt("Lua 오류", lua.slice(0, 2));
  if (!stop) {
    const winner = duel.winner === 2 ? 2 : duel.winner;
    if (winner !== game.winner || duel.turn !== game.turn) halt("결과가 다름", `EDOPro: 승자 ${game.winner}, ${game.turn}턴 / 웹: 승자 ${winner}, ${duel.turn}턴`);
    else {
      // (ocgcore looks at the LP later: the players may still be asked a little once the loser is known)
      const left = entries.slice(at).filter((x, i) => !consumed.has(at + i) && !(x.msg === 16 && x.chosen === PASS));
      if (left.some((x) => x.turn !== game.turn) || left.length > 3) halt("EDOPro 결정이 남았는데 웹 대전이 끝남", `${left.length}개 남음`);
      else if (left.length) notes.push({ where: `${game.turn}턴 끝`, onlyE: left.map((x) => x.chosen || (x.picks || []).join(",")), onlyW: [] });
    }
  }
  return { game: game.game, ok: !stop, ...(stop || {}), decisions: entries.length, notes, selfChains, ...(debug ? { duel } : {}) };
}

/** game `index` of the recording alone, with the web duel (its log, rt.errors) to look into */
export async function one(index) {
  const engine = await (await fetch(engineDataUrl())).json();
  names = Object.fromEntries(Object.entries(engine.cards).map(([c, d]) => [c, d.name]));
  const ai = await (await fetch("data/ai_decks.json")).json();
  const pool = ai.decks.map((d) => ({ main: d.main, summoner: d.summoner }));
  const text = await (await fetch("data/ai/test/replay_edopro.jsonl", { cache: "reload" })).text();
  const game = JSON.parse(text.split("\n").filter(Boolean)[index]);
  return { game, result: await replayGame(game, pool, { debug: true }) };
}

export async function run({ games = 200, from = 0, show = 12 } = {}) {
  const engine = await (await fetch(engineDataUrl())).json();
  names = Object.fromEntries(Object.entries(engine.cards).map(([c, d]) => [c, d.name]));
  const ai = await (await fetch("data/ai_decks.json")).json();
  const pool = ai.decks.map((d) => ({ main: d.main, summoner: d.summoner }));
  const text = await (await fetch("data/ai/test/replay_edopro.jsonl", { cache: "reload" })).text();
  const lines = text.split("\n").filter(Boolean).slice(from, from + games);
  const results = [];
  for (const line of lines) results.push(await replayGame(JSON.parse(line), pool));
  const reasons = {};
  for (const r of results) if (!r.ok) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const noteCount = {};
  for (const r of results) for (const n of r.notes) {
    for (const k of n.onlyE) noteCount[`EDOPro만 ${label(k)} @${n.where.replace(/^\d+턴 /, "")}`] = (noteCount[`EDOPro만 ${label(k)} @${n.where.replace(/^\d+턴 /, "")}`] || 0) + 1;
    for (const k of n.onlyW) noteCount[`웹만 ${label(k)} @${n.where.replace(/^\d+턴 /, "")}`] = (noteCount[`웹만 ${label(k)} @${n.where.replace(/^\d+턴 /, "")}`] || 0) + 1;
  }
  window.replayResults = results;
  const progress = results.map((r) => (r.ok ? 1 : r.at / r.decisions));
  return {
    games: results.length, sameToTheEnd: results.filter((r) => r.ok).length, reasons,
    avgProgress: +(progress.reduce((a, b) => a + b, 0) / results.length).toFixed(3),
    first: results.filter((r) => !r.ok).slice(0, show).map((r) => ({ game: r.game, turn: r.turn, at: `${r.at}/${r.decisions}`, reason: r.reason,
      detail: r.detail, recent: r.recent.slice(-4), edoLog: r.edoLog, webLog: r.webLog })),
    notes: Object.entries(noteCount).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${n}× ${k}`),
  };
}
