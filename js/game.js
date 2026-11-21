import { toast } from "./ui.js";
import {
  ATTRIBUTE_ICONS, aiRecipeLabel, loadAiDecks, loadCards, setupTextSize, writeCardInfo,
} from "./decks.js";
import { newDuel, describe } from "./engine/index.js?v=standby2";
import { K, NOOP_DESCS } from "./engine/flow.js?v=standby2";
import { puzzlePlayer, simplePlayer, SANCTUARY_HINT, SANCTUARY_ONE_HINT } from "./engine/players.js?v=hp2";
import { modelPlayer } from "./ai/agent.js";
import { loadSounds, playBgm, playCue, setVolume, voice, volume } from "./sound.js?v=9";
import { FORMAT, deleteReplay, diff, getReplay, saveReplay, unpack } from "./replays.js";
import { makeMatchRecord, submitMatchRecord } from "./records.js";
import { API_BASE } from "./config.js";
import {
  beaconPvpResign, clearPvpDuel, createResignGate, fetchPvpDuel, initPvpDuel, lockstepPlayers, OppResignedError,
  postPvpCoin, postPvpResign, seededRng, waitPvpCoin, waitPvpInit, watchPvpResign,
} from "./pvp.js";
import { deleteRoom, fetchRooms } from "./lobby-rooms.js";
import { currentNick, loadMatchData, saveMatch } from "./match-store.js";
import { getLang, puzzlesDataUrl, setLang } from "./lang.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n43";
import { loadJson, mediaUrl } from "./local-assets.js?v=4";
import { bindBoardFit, fitFieldContent } from "./stage-scale.js?v=14";
import { clearLocalDevCaches } from "./dev-cache.js?v=4";

bindBoardFit();
await clearLocalDevCaches();

/** Uniform board scale (1 at current design size). */
function boardScale() {
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--board-scale"));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Center of `el` in `#board` local CSS px (undo shell scale). */
function boardLocalCenter(boardRect, el) {
  const r = el.getBoundingClientRect();
  const s = boardScale();
  return {
    x: (r.left + r.width / 2 - boardRect.left) / s,
    y: (r.top + r.height / 2 - boardRect.top) / s,
  };
}

function setPic(el, rel) {
  if (!el) return;
  mediaUrl(rel).then((url) => { el.src = url; }).catch(() => { el.src = rel; });
}

const PHASES_KO = ["드로우", "스탠바이", "메인", "배틀", "엔드"];
const PHASES_EN = ["Draw", "Standby", "Main", "Battle", "End"];
const PHASES_JA = ["ドロー", "スタンバイ", "メイン", "バトル", "エンド"];
const PHASE_NAMES_KO = { 0x1: "드로우", 0x2: "스탠바이", 0x4: "메인", 0x8: "배틀", 0x80: "배틀 종료", 0x200: "엔드" };
const PHASE_NAMES_EN = { 0x1: "Draw", 0x2: "Standby", 0x4: "Main", 0x8: "Battle", 0x80: "Battle End", 0x200: "End" };
const PHASE_NAMES_JA = { 0x1: "ドロー", 0x2: "スタンバイ", 0x4: "メイン", 0x8: "バトル", 0x80: "バトル終了", 0x200: "エンド" };
const PHASES = () => (getLang() === "en" ? PHASES_EN : getLang() === "ja" ? PHASES_JA : PHASES_KO);
const PHASE_NAMES = () => (getLang() === "en" ? PHASE_NAMES_EN : getLang() === "ja" ? PHASE_NAMES_JA : PHASE_NAMES_KO);

function statusLabel(name) {
  const key = `status.${name}`;
  const v = t(key);
  return v === key ? name : v;
}

function botDisplay(bot) {
  if (!bot) return "";
  const key = `ai.bot.${bot}`;
  const v = t(key);
  return v === key ? bot : v;
}

function aiSideLabel(match) {
  const level = t("ai.levelN", { n: match.level });
  const bot = botDisplay(match.bot);
  const recipe = match.ai
    ? { name: match.ai.name, level: match.level, summoner: match.ai.summoner }
    : null;
  const short = recipe && cards?.size
    ? aiRecipeLabel(recipe, cards, { short: true })
    : (match.ai?.name || "");
  const head = t("game.aiLabel", { level, bot: bot ? ` ${bot}` : "" });
  return short ? `${head} · ${short}` : head;
}

/** Replay/saved labels may still contain Korean prefixes — rewrite for the current UI language. */
function localizeSideName(name) {
  if (!name) return "";
  let s = String(name);
  s = s.replace(/^나 · /, () => t("game.mePrefix"));
  s = s.replace(/^상대 · /, () => t("game.oppPrefix"));
  s = s.replace(/^自分 · /, () => t("game.mePrefix"));
  s = s.replace(/^相手 · /, () => t("game.oppPrefix"));
  s = s.replace(/^Me · /, () => t("game.mePrefix"));
  s = s.replace(/^Opponent · /, () => t("game.oppPrefix"));
  s = s.replace(/\[AI\]\s*(\d+)\s*단계(?:\s+([^·]+))?/u, (_, lv, bot) => {
    const b = botDisplay((bot || "").trim());
    return t("game.aiLabel", { level: t("ai.levelN", { n: lv }), bot: b ? ` ${b}` : "" });
  });
  s = s.replace(/AI\s*(\d+)\s*단계/u, (_, lv) => `AI ${t("ai.levelN", { n: lv })}`);
  s = s.replace(/AI\s*Lv\.?\s*(\d+)/iu, (_, lv) => `AI ${t("ai.levelN", { n: lv })}`);
  const KO_SUMMONERS = {
    키라라: 10050111, 램프: 10050112, 클레어: 10050113, 아르시브: 10050114,
    미디어: 10050115, 우츠츠: 10050116, 하이프리스: 10050117,
  };
  for (const [ko, id] of Object.entries(KO_SUMMONERS)) {
    if (!s.includes(ko) || !cards?.has?.(id)) continue;
    const short = cards.get(id).name
      .replace(/\(소환사 카드\)$/u, "")
      .replace(/\(Main Character\)$/u, "")
      .replace(/\(召喚士カード\)$/u, "")
      .trim();
    s = s.split(ko).join(short);
  }
  s = s.replace(/땅/g, () => t("attr.땅")).replace(/물/g, () => t("attr.물"))
    .replace(/불/g, () => t("attr.불")).replace(/바람/g, () => t("attr.바람"))
    .replace(/해/g, () => t("attr.해")).replace(/달/g, () => t("attr.달"));
  return s;
}
const BATTLE_SEQS = [0, 2, 4];                 // the battle zone: the monster zones Kirafan.FieldTheRockop leaves open
const SUPPORT_SLOTS = { turn: 3, other: 2 };   // the turn player may hold 3 supports, the other 2
const GAUGE_MAX = 9;
const TRUTH_SETCODE = 0xc01;                   // a summoner in 진실의 손의 시간 (Kirafan.RealistTime gives it this setcode)
const AI_DELAY = 450;                          // ms before each of the AI's answers, so its moves can be followed
// true면 코인 토스·소환사 등장 연출을 건너뛴다
const QUICK_START = false;
// (testing: game.html?auto - AIs at both seats without waiting, decks and level at random)
const AUTO = new URLSearchParams(location.search).has("auto");
const AUTO_LEVEL = Number(new URLSearchParams(location.search).get("level")) || 0;   // (&level=N: both AIs at it)
const STATUS_ICONS = {
  혼란: "confusion", 속박: "bind", 배고픔: "hunger", 나약함: "weak",
  수면: "sleep", 불행: "misfortune", 침묵: "silence", 고립: "isolation",
};
const STATUS_COUNTERS = [[0xb05, "수면"], [0xb02, "불행"], [0xb01, "나약함"], [0xb03, "속박"], [0xb04, "배고픔"], [0xb06, "고립"]];
const COUNTER_ATTACKS = 0xc01;
const UNHAPPY = 0xb02;
const STATUS_PER_LINE = 3;                       // the statuses in words over a battle creamate, per line
const ATTACK_HINT = 549;
const VILLAGE_HINT = 10050111 * 0x100000 + 9;   // 쓰러진 뒤 마을로 보낼 성채석 선택

let cards = new Map();     // code -> the card's text (data/cards.json)
let duel = null;
let me = 0;                // the player the page plays (0 moves first)
let names = ["", ""];
let menu = null;           // the main / battle phase menu waiting for a click: { decision, resolve }
let picking = null;        // cards picked where they are: { decision, picked: [indices], mark, ... } (askOnBoard)
/** Modal chooseCards session: { picked, confirm } — right-click confirms when something is picked */
let chooseSession = null;
const revealed = [false, false];   // the summoners shown before the duel (summonersEnter)
const LAST_ALCHEMISTS = 3;
const lastAlchemist = [[], []];    // per player the codes of the alchemists whose 돗테오키 존 effect came last (newest first)
let entering = null;       // the player whose summoner comes out in this drawing
let replaying = false;     // the page shows a saved game (game.html?replay=<id>) instead of playing one
/** 개막 성전 4장: 양쪽이 다 고를 때까지 성전 내용·로그를 숨긴다 (먼저 고른 쪽이 불리하지 않게) */
let concealOpeningSanctuary = false;
let pendingSanctuaryLogs = [];   // conceal 중 flushSanctuary 보류분

/* The board is drawn from one state (boardState, from the engine):
 *   { turn, phase (PHASES index), turnPlayer: "me" | "op",
 *     me / op: { name, summoner (code), hand: [engine cards], deck (count), village / dotte (oldest first) /
 *                placed (성전: put in from the hand) / fallen (성전: battle creamates that fell): [codes],
 *                battle: [{ card, id, hp, maxHp, atk, attacks, stiff, status: [{ name, turns }] } | null] x 3,
 *                support: [engine card | null] x 3, sanctuaryLevel, fieldLevel, limit (성채석 한도) } }
 * A status's turns are its counters: one comes off in every 엔드 페이즈, so 1 means it ends this turn. */

// ---- drawing ------------------------------------------------------------
function show(card) {
  setPic(document.getElementById("preview"), `pics/${card.id}.jpg`);
  writeCardInfo(document.getElementById("card-info"), card);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** a card's face; `live`: the engine's card, so the menu can offer what it can do now */
function face(id, live = null) {
  const card = cards.get(id);
  const box = el("div", "card-face");
  const img = el("img");
  setPic(img, `pics/small/${id}.jpg`);
  img.alt = card ? card.name : "";
  box.title = card ? card.name : "";
  box.append(img);
  if (card) box.addEventListener("mouseenter", () => show(card));
  if (live && !offerPick(box, live)) offerMenu(box, live);
  return box;
}

/** a creamate's face with its level in a corner ("Lv2"); a summoner's has none */
function leveled(id, live = null) {
  const box = face(id, live);
  const card = cards.get(id);
  if (card?.level && card.kind !== "summoner") box.append(el("span", "level-tag", `Lv${card.level}`));
  return box;
}

/** face-down card back; uses summoner art when known (hand / deck) */
function back(side, summonerId = 0) {
  const box = el("div", "card-face");
  const img = el("img");
  if (summonerId) {
    setPic(img, `pics/small/${summonerId}.jpg`);
  } else {
    img.src = side === "op" ? "assets/cover2.jpg" : "assets/cover.jpg";
  }
  img.alt = "";
  box.append(img);
  return box;
}

function icon(src, title) {
  const img = el("img", "icon");
  img.src = src;
  img.alt = title;
  img.title = title;
  return img;
}

function stat(className, label, value, src) {
  const s = el("div", `stat ${className}`);
  const b = el("b");
  b.append(icon(src, label), el("span", "", value));
  s.append(el("span", "", label), b);
  return s;
}

/**
 * Face-up pile lane (성전 / 돗테오키): side-by-side until full, then compress L→R.
 * @param {number} [max] optional cap (돗테오키: 9)
 */
function faceUpLane(ids, className, title, max = 0) {
  const lane = el("div", className);
  lane.title = title;
  const list = max > 0 ? ids.slice(0, max) : ids;
  if (!list.length) {
    lane.classList.add("empty");
    return lane;
  }
  lane.style.setProperty("--sanct-span", String(Math.max(1, list.length - 1)));
  for (let i = 0; i < list.length; i++) {
    const c = face(list[i]);
    c.style.zIndex = String(i + 1);
    c.style.setProperty("--sanct-i", String(i));
    lane.append(c);
  }
  return lane;
}

/** Village: fill left→right (~10 per row), then next row; surface shows at most 30. */
const VILLAGE_ROW = 10;
const VILLAGE_VISIBLE = 30;

function villageLane(ids, title) {
  const lane = el("div", "village-lane");
  lane.title = title;
  const list = ids.slice(0, VILLAGE_VISIBLE);
  if (!list.length) {
    lane.classList.add("empty");
    return lane;
  }
  // Always lay out against a fixed 3-row grid so row 2 sits in the middle slot.
  const gridRows = 3;
  const cols = Math.min(VILLAGE_ROW, list.length);
  lane.style.setProperty("--v-rows", String(gridRows));
  lane.style.setProperty("--v-cols", String(cols));
  lane.style.setProperty("--v-col-span", String(Math.max(1, cols - 1)));
  lane.style.setProperty("--v-row-span", String(gridRows - 1));
  for (let i = 0; i < list.length; i++) {
    const col = i % VILLAGE_ROW;
    const row = Math.floor(i / VILLAGE_ROW);
    const c = face(list[i]);
    c.style.zIndex = String(i + 1);
    c.style.setProperty("--v-col", String(col));
    c.style.setProperty("--v-row", String(row));
    lane.append(c);
  }
  return lane;
}

function sanctuaryLane(ids, kind, title) {
  return faceUpLane(ids, `sanctuary-lane ${kind}`, title);
}

/** other: the other player's side (its 성전 레벨, against this one's in 진실의 손의 시간) */
function summonerBox(p, other, side = "me") {
  const box = el("div", "summoner-box");

  const sanctuary = el("div", "sanctuary-zone");
  if (concealOpeningSanctuary) sanctuary.classList.add("concealed");
  const levelMark = el("div", "sanctuary-level-mark");
  const sanctCount = p.placed.length + p.fallen.length;
  levelMark.textContent = concealOpeningSanctuary
    ? `${t("game.sanctuary")} ?`
    : `${t("game.sanctuary")} ${sanctCount}`;
  levelMark.title = concealOpeningSanctuary
    ? t("game.concealSanctuary")
    : t("game.pileTotal", { title: t("game.sanctuary"), n: sanctCount });
  levelMark.classList.toggle("alert", !!p.truth && p.sanctuaryLevel >= other.sanctuaryLevel);
  sanctuary.append(
    sanctuaryLane(
      concealOpeningSanctuary ? [] : p.placed,
      "placed",
      t("game.placedFromHand", { n: p.placed.length }),
    ),
    sanctuaryLane(
      concealOpeningSanctuary ? [] : p.fallen,
      "fallen",
      t("game.fallenTitle", { n: p.fallen.length, lv: p.sanctuaryLevel }),
    ),
    levelMark, // overlays the seam between the two lanes
  );
  const owner = side === "op" ? t("game.opp") : t("game.me");
  const headed = t("game.pileOf", { who: owner, pile: t("game.sanctuary") });
  const sections = concealOpeningSanctuary ? null : [
    { title: t("game.placedFromHand", { n: p.placed.length }), ids: p.placed },
    { title: t("game.fallenTitle", { n: p.fallen.length, lv: p.sanctuaryLevel }), ids: p.fallen },
  ];
  if (sections) {
    sanctuary.classList.add("clickable");
    sanctuary.title = t("game.viewPile", { who: owner, pile: t("game.sanctuary") });
    const key = `${side}:성전`;
    sanctuary.addEventListener("click", () => togglePile(key, headed, sections));
    if (openedPile === key) pileSections = () => fillPile(headed, sections);
  } else {
    sanctuary.title = t("game.concealSanctuary");
  }
  box.append(sanctuary);

  // Under sanctuary: name spans full width, then (summoner | stats)
  const foot = el("div", "summoner-foot");
  const name = el("div", "name", localizeSideName(p.name));
  name.title = localizeSideName(p.name);
  const summonerCol = el("div", "summoner-col");
  const summoner = p.summoner ? face(p.summoner, p.summonerCard) : el("div", "slot support");
  summoner.classList.add("summoner-face");
  if (p.entering) summoner.classList.add("entering");
  summonerCol.append(summoner);

  const stats = el("div", "stats");
  const levelRow = el("div", "stat-row");
  const level = stat("sanctuary", t("game.sanctuaryLevel"), p.sanctuaryLevel, "assets/icons/sanctuary.png");
  // (in 진실의 손의 시간 a 성전 레벨 as high as the other's loses as this player's turn ends)
  level.classList.toggle("alert", !!p.truth && p.sanctuaryLevel >= other.sanctuaryLevel);
  const deckStat = stat("deck", t("game.deckPile"), p.deck, "assets/icons/deck-book.png");
  deckStat.title = t("game.pileTotal", { title: t("game.deckPile"), n: p.deck });
  levelRow.append(level, deckStat);
  const stones = stat("stones", t("game.stoneLimit"), `${p.fieldLevel} / ${p.limit}`, "assets/icons/stones.png");
  stones.classList.toggle("alert", p.limit > 0 && p.fieldLevel >= p.limit);
  stats.append(levelRow, stones);
  if (p.truth) stats.append(el("div", "truth", t("game.truthHand")));
  foot.append(name, summonerCol, stats);
  box.append(foot);
  return box;
}

/** a number over a battle creamate, after its icon (attack: the wand for a 마법사, the sword for the others) */
function badge(kind, src, title, value) {
  const b = el("span", `badge ${kind}`);
  b.title = title;
  b.append(icon(src, title), el("span", "", value));
  return b;
}

/** a battle zone place: as wide as a card turned sideways, so 경직 moves nothing */
function battleSlot(b) {
  const cell = el("div", "battle-cell");
  const slot = el("div", "slot battle");
  cell.append(slot);
  if (!b) return cell;
  const card = cards.get(b.id);
  slot.append(face(b.id, b.card));
  slot.classList.toggle("stiff", !!b.stiff);
  const hp = badge("hp", "assets/icons/hp.png", t("game.hp"), `${b.hp}/${b.maxHp}`);
  hp.classList.toggle("hurt", b.hp < b.maxHp);
  hp.classList.toggle("over", b.hp > b.maxHp);
  hp.classList.toggle("low", b.hp <= 1);
  const weapon = `assets/icons/atk-${card?.class === "마법사" ? "wand" : "sword"}-${ATTRIBUTE_ICONS[card?.attribute] || "fire"}.png`;
  const atk = badge("atk", weapon, t("game.atk"), b.atk);
  // (against the card's own attack: raised, lowered)
  if (card) {
    atk.classList.toggle("up", b.atk > card.atk);
    atk.classList.toggle("down", b.atk < card.atk);
  }
  const stats = el("div", "stat-bar");
  stats.append(atk, hp);
  slot.append(stats);
  const top = el("div", "top-tags");
  if (card?.level) top.append(el("span", "badge level", `Lv${card.level}`));
  top.append(el("span", `badge attacks${b.attacks ? "" : " none"}`, t("game.normalAttack", { n: b.attacks })));
  slot.append(top);
  // (stacked over the attacks left: the statuses in words - "수면1 배고픔2" - then a 나이트's aggro on top)
  const tags = el("div", "tags");
  if (b.aggro) {
    const normal = getLang() === "en" ? "Normal" : getLang() === "ja" ? "通常攻撃" : "통상공격";
    const label = b.aggro === "both" ? t("game.aggro")
      : b.aggro === "통상공격" ? t("game.aggroN", { n: normal })
      : t("game.aggroN", { n: t("game.dotteTitle") });
    tags.append(el("span", "badge aggro", label));
  }
  if (b.status.length) {
    const words = el("span", "badge status-text");
    const n = b.status.length;
    const columns = Math.min(n, STATUS_PER_LINE);
    const items = b.status.map(({ name, turns }) => el("span", "", `${statusLabel(name)}${turns}`));
    const rest = n % columns;   // (a last line not full starts further in, so it ends on the right as the others)
    if (rest) items[n - rest].style.gridColumnStart = columns - rest + 1;
    words.style.gridTemplateColumns = `repeat(${columns}, auto)`;
    words.append(...items);
    tags.append(words);
  }
  if (tags.childElementCount) slot.append(tags);
  if (b.status.length) {
    const list = el("div", "statuses");
    list.append(...b.status.map(statusMark));
    slot.append(list);
  }
  return cell;
}

function statusMark({ name, turns }) {
  const label = statusLabel(name);
  const title = turns ? t("game.statusLeft", { name: label, n: turns }) : label;
  const mark = el("span", "status");
  mark.title = title;
  mark.append(STATUS_ICONS[name] ? icon(`assets/icons/status-${STATUS_ICONS[name]}.png`, title) : el("span", "status-name", label));
  if (turns) mark.append(el("b", "status-turns", turns));
  return mark;
}

function zone(label, slots) {
  const box = el("div", "zone");
  const row = el("div", "slots");
  row.append(...slots);
  box.append(el("span", "zone-label", label), row);
  return box;
}

let openedPile = null;   // the pile whose list is open ("me:성전" ...), or null
let pileSections = null; // (redrawn with the board while open)

function closePile() {
  openedPile = null;
  document.getElementById("pile-list").hidden = true;
}

function fillPile(title, sections) {
  const total = sections.reduce((n, s) => n + s.ids.length, 0);
  document.getElementById("pile-list-title").textContent = t("game.pileTotal", { title, n: total });
  document.getElementById("pile-list-cards").replaceChildren(...sections.flatMap((s) => [
    ...(s.title ? [el("h3", "pile-section", s.title)] : []),
    ...(s.ids.length ? s.ids.map((id) => face(id)) : [el("p", "", t("game.noCards"))]),
  ]));
}

/** a pile's list, in sections [{ title, ids }]; the same pile clicked again closes it */
function togglePile(key, title, sections) {
  if (openedPile === key) return closePile();
  openedPile = key;
  fillPile(title, sections);
  document.getElementById("pile-list").hidden = false;
}

function pile(label, value, sections, side) {
  const box = el(sections ? "button" : "div", "pile");
  // Keep Korean keys in data-pile so flight targeting stays stable across languages
  const pileKey = ({
    [t("game.sanctuary")]: "성전",
    [t("game.village")]: "마을",
    [t("game.deckPile")]: "덱",
    [t("game.handPile")]: "손패",
  })[label] || label;
  box.dataset.pile = pileKey;
  box.append(el("b", "", value), el("span", "label", label));
  if (sections) {
    const owner = side === "op" ? t("game.opp") : t("game.me");
    const key = `${side}:${pileKey}`;
    box.title = t("game.viewPile", { who: owner, pile: label });
    const headed = t("game.pileOf", { who: owner, pile: label });
    box.addEventListener("click", () => togglePile(key, headed, sections));
    if (openedPile === key) pileSections = () => fillPile(headed, sections);
  }
  return box;
}

function piles(p, side) {
  const box = el("div", "piles");
  const owner = side === "op" ? t("game.opp") : t("game.me");

  const gauge = el("button", "gauge");
  gauge.title = t("game.viewDotte", { who: owner });
  const title = icon("assets/icons/dotte-title.png", t("game.dotteTitle"));
  title.className = "gauge-title";
  const stars = icon("assets/icons/dotte-stars.png", "");
  stars.className = "gauge-stars";
  const count = Math.min(Math.max(0, p.dotte.length), GAUGE_MAX);
  const num = el("img", "gauge-count");
  num.alt = String(count);
  // Direct assets/ URL (setPic/mediaUrl would wrongly prefix data/)
  num.src = `assets/icons/mission-num/MissionTextNum${count}.png?v=2`;
  const head = el("div", "gauge-head");
  head.append(title, stars, num);
  // Face-up cards under the title (max 9)
  const lane = faceUpLane(
    p.dotte,
    "gauge-lane",
    t("game.dotteGaugeN", { n: Math.min(p.dotte.length, GAUGE_MAX) }),
    GAUGE_MAX,
  );
  gauge.append(head, lane);
  const key = `${side}:돗테오키`;
  const headed = t("game.dotteOf", { who: owner });
  const sections = [{ title: t("game.dotteOrder"), ids: p.dotte }];
  gauge.addEventListener("click", () => togglePile(key, headed, sections));
  if (openedPile === key) pileSections = () => fillPile(headed, sections);

  // Under 돗테오키: larger face-up village box (div like sanctuary — button stacks/clips the badge)
  const village = el("div", "village-pile clickable");
  village.dataset.pile = "마을";
  village.title = t("game.viewPile", { who: owner, pile: t("game.village") });
  const villageMark = el("div", "pile-art-mark", `${t("game.village")} ${p.village.length}`);
  village.append(
    villageLane(p.village, t("game.village")),
    villageMark, // overlays center over card art (same as sanctuary)
  );
  const vKey = `${side}:마을`;
  const vHeaded = t("game.pileOf", { who: owner, pile: t("game.village") });
  const vSections = [{ ids: p.village }];
  village.addEventListener("click", () => togglePile(vKey, vHeaded, vSections));
  if (openedPile === vKey) pileSections = () => fillPile(vHeaded, vSections);

  box.append(gauge, village);
  return box;
}

function drawRow(state, side) {
  const p = state[side];
  const open = state.turnPlayer === side ? SUPPORT_SLOTS.turn : SUPPORT_SLOTS.other;
  const support = Array.from({ length: SUPPORT_SLOTS.turn }, (_, i) => {
    const slot = el("div", "slot support");
    slot.dataset.support = i;   // (playFlights finds the card put here)
    if (p.support[i]) slot.append(leveled(p.support[i].code, p.support[i]));
    else if (i >= open) {
      slot.classList.add("closed");
      slot.title = t("game.supportSlotHint");
    }
    return slot;
  });
  const supportZone = zone(t("game.supportZone"), support);
  supportZone.classList.add("support-zone");
  // Recent alchemist to the right of support
  const last = el("div", "last-alchemist");
  last.title = t("game.alchemistTip");
  const alchRow = el("div", "last-alchemist-cards");
  alchRow.append(...Array.from({ length: LAST_ALCHEMISTS }, (_, i) => (
    p.alchemist[i] ? leveled(p.alchemist[i]) : el("div", "slot empty")
  )));
  last.append(el("span", "zone-label", t("game.recentAlchemist")), alchRow);
  const supportRow = el("div", "support-row");
  supportRow.append(supportZone, last);

  const row = document.getElementById(side === "me" ? "my-row" : "op-row");
  const zones = el("div", "zones");
  zones.append(zone(t("game.battleZone"), p.battle.map((b, i) => {
    const cell = battleSlot(b);
    cell.dataset.index = i;   // (left, middle, right as this player sees them: attackFx finds the cards so)
    return cell;
  })), supportRow);
  const other = state[side === "me" ? "op" : "me"];
  row.replaceChildren(summonerBox(p, other, side), zones, piles(p, side));
}

let lastDrawn = null;   // the board drawn last: what changed since (cardFx)

/* Cards new in this player's hand (drawn, or back to it) come in from the right edge of the screen to their
 * places, those of one drawing all together (the opponent's backs just appear). A drawing again while they
 * move (every event draws the board) carries their flight on in the new elements: arrivals { code, nth, start,
 * ms }. */
const ARRIVE_MS = 450;
let arrivals = [];
/** Latest time (performance.now) any board motion is expected to finish — replay waits for this. */
let motionUntil = 0;

function noteMotion(ms) {
  const t = performance.now() + Math.max(0, ms);
  if (t > motionUntil) motionUntil = t;
}

function motionWaitMs() {
  return Math.max(0, motionUntil - performance.now());
}

function flyDurationMs(dx, dy, speed) {
  return Math.max(FLY_MIN_MS, Math.hypot(dx, dy) / FLY_PX_MS) / Math.max(0.01, speed);
}

function handArrivals(before, state, speed) {
  const now = performance.now();
  if (before) {
    const ms = ARRIVE_MS / Math.max(0.01, speed);
    const had = new Map();
    for (const c of before.me.hand) had.set(c.code, (had.get(c.code) || 0) + 1);
    const seen = new Map();
    for (const c of state.me.hand) {
      const nth = seen.get(c.code) || 0;
      seen.set(c.code, nth + 1);
      if (nth >= (had.get(c.code) || 0)) {
        arrivals.push({ code: c.code, nth, start: now, ms });
        noteMotion(ms);
      }
    }
  } else arrivals = [];
  arrivals = arrivals.filter((a) => now - a.start < a.ms);
  const mine = [...document.getElementById("my-hand").children];
  for (const a of arrivals) {
    const box = mine.filter((x, i) => state.me.hand[i]?.code === a.code)[a.nth];
    if (!box) continue;
    const dx = (window.innerWidth - box.getBoundingClientRect().left) / boardScale();
    const move = box.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], { duration: a.ms, easing: "ease-out" });
    move.currentTime = now - a.start;
  }
}

/* A creamate played from a hand flies from it to its place in the battle / support zone at a steady speed
 * (FLY_PX_MS, times a replay's speed), growing or shrinking steadily to the size it has there; the
 * opponent's come out of the middle of its hand, wherever the card was in it. A copy of the card flies over
 * the board (#fly) while the card itself waits hidden at its place - every drawing hides it again: flights
 * { side, zone: "battle" | "support", index, ghost, end }. */
const FLY_PX_MS = 1.6;
const FLY_MIN_MS = 220;
let flights = [];

/** where the cards are on the screen now, before the board is drawn again: this player's hand one by one, the
 *  opponent's hand's middle, both zones' creamates - places { rect, el } */
function handPlaces() {
  const op = document.getElementById("op-hand");
  const back = op.firstElementChild?.getBoundingClientRect();
  const box = op.getBoundingClientRect();
  const h = back ? back.height : box.height;
  const place = (x) => {
    if (!x) return null;
    const rect = x.getBoundingClientRect();
    return { rect, el: x, w: rect.width, h: rect.height };
  };
  const field = (side) => {
    const row = document.getElementById(side === "me" ? "my-row" : "op-row");
    const gaugeCards = [...(row?.querySelectorAll(".gauge-lane > .card-face") || [])];
    return {
      battle: [0, 1, 2].map((i) => place(row.querySelector(`.battle-cell[data-index="${i}"] .card-face`))),
      support: [0, 1, 2].map((i) => place(row.querySelector(`.slot[data-support="${i}"] .card-face`))),
      // 돗테오키 gauge faces (oldest first) — for gauge → village flights
      dotte: gaugeCards.map(place),
    };
  };
  return {
    mine: [...document.getElementById("my-hand").children].map(place),
    op: { left: box.left + box.width / 2 - (back ? back.width : h * 0.72) / 2, top: box.top + box.height / 2 - h / 2,
      width: back ? back.width : h * 0.72, height: h },
    field: { me: field("me"), op: field("op") },
  };
}

function flightTarget(f) {
  const row = document.getElementById(f.side === "me" ? "my-row" : "op-row");
  const slot = f.zone === "battle" ? row.querySelector(`.battle-cell[data-index="${f.index}"]`)
    : row.querySelector(`.slot[data-support="${f.index}"]`);
  return slot?.querySelector(".card-face") || null;
}

function landFlight(f) {
  f.ghost.remove();
  flights = flights.filter((x) => x !== f);
  const card = flightTarget(f);
  if (card) card.style.visibility = "";
}

/** Face-up pile landing: { side, pile: "placed"|"fallen"|"dotte"|"village", index, code, ghost } */
let sanctuaryFlights = [];

function faceUpPileTarget(f) {
  const row = document.getElementById(f.side === "me" ? "my-row" : "op-row");
  let lane;
  if (f.pile === "dotte") lane = row?.querySelector(".gauge-lane");
  else if (f.pile === "village") lane = row?.querySelector(".village-lane");
  else lane = row?.querySelector(`.sanctuary-lane.${f.pile}`);
  const cards = lane?.querySelectorAll(":scope > .card-face");
  if (!cards?.length) return null;
  const i = Math.min(Math.max(0, f.index), cards.length - 1);
  return cards[i] || null;
}

function landSanctuary(f) {
  f.ghost.remove();
  sanctuaryFlights = sanctuaryFlights.filter((x) => x !== f);
  const card = faceUpPileTarget(f);
  if (card) card.style.visibility = "";
}

/** the creamates new in the zones since `before` that left a hand: their flights (no before: none, at once) */
function playFlights(before, state, speed, from, ahead = null) {
  if (!before) {
    for (const f of [...flights]) landFlight(f);
    for (const f of [...sanctuaryFlights]) landSanctuary(f);
    document.querySelectorAll("#fly .leaving").forEach((x) => x.remove());
    return;
  }
  const newcomers = (side) => {
    const out = [];
    state[side].battle.forEach((b, i) => {
      const a = before[side].battle[i];
      if (b && (!a || a.id !== b.id)) out.push({ side, zone: "battle", index: i, code: b.id });
    });
    state[side].support.forEach((c, i) => {
      const a = before[side].support[i];
      if (c && (!a || a.code !== c.code)) out.push({ side, zone: "support", index: i, code: c.code });
    });
    return out;
  };
  // (this player's: from the place of a card of that code gone from the hand)
  const left = new Map(state.me.hand.reduce((m, c) => m.set(c.code, (m.get(c.code) || 0) + 1), new Map()));
  const gone = new Map();
  before.me.hand.forEach((c, i) => {
    if ((left.get(c.code) || 0) > 0) left.set(c.code, left.get(c.code) - 1);
    else if (from.mine[i]) gone.set(c.code, [...(gone.get(c.code) || []), from.mine[i]]);
  });
  for (const f of newcomers("me")) {
    const place = gone.get(f.code)?.shift();
    if (place) launchFlight(f, place.rect, speed);
  }
  // (the opponent's: as many as its hand has fewer cards, out of its middle)
  const fewer = Math.max(0, before.op.hand.length - state.op.hand.length);
  const theirs = newcomers("op").slice(0, fewer);
  for (const f of theirs) launchFlight(f, from.op, speed);
  playDepartures(before, state, speed, from, gone, fewer - theirs.length, ahead);
  for (const f of flights) {
    const card = flightTarget(f);
    if (card) card.style.visibility = "hidden";
  }
  for (const f of sanctuaryFlights) {
    const card = faceUpPileTarget(f);
    if (card) card.style.visibility = "hidden";
  }
}

/* A card gone from a hand or a zone to a pile flies to it at the same steady speed.
 * 성전 / 돗테오키 / 마을: fly onto the face-up slot and land there (no fade-out).
 * 돗테오키 → 마을: oldest first, staggered (VILLAGE_STAGGER_MS / speed).
 * Which card: one of the code the pile gained, gone from where that pile takes cards from (the opponent's hand
 * by its count, out of its middle). */
const DEPART_TO = [
  ["dotte", ".gauge-lane", ["hand", "support", "battle"]],
  ["fallen", ".sanctuary-lane.fallen", ["battle"]],
  ["placed", ".sanctuary-lane.placed", ["hand"]],
  ["village", ".village-lane, .village-pile", ["dotte", "support", "battle", "hand"]],
];
const FACE_UP_PILES = new Set(["placed", "fallen", "dotte", "village"]);
/** Delay between 돗테오키 → 마을 flights at 1× speed (oldest first). */
const VILLAGE_STAGGER_MS = 200;
/** Delay between 체력(overlay) → 마을 flights at 1× speed (damage-processing order). */
const HP_VILLAGE_STAGGER_MS = 100;

/** Visual battle indices in engine MatchingGroup / damage order (seq 0→2→4).
 *  Opponent's row is reversed on screen, so walk visual indices right→left. */
function damageProcessOrder(side) {
  return side === "me" ? [0, 1, 2] : [2, 1, 0];
}

/** Places for 체력 cards leaving battle creamates (one entry per HP lost), in damage order. */
function hpVillageSources(before, state, from, side) {
  const out = [];
  for (const i of damageProcessOrder(side)) {
    const was = before[side].battle[i];
    const now = state[side].battle[i];
    const place = from.field[side].battle[i];
    if (!was || !place) continue;
    const lost = now && now.id === was.id ? Math.max(0, was.hp - now.hp) : was.hp;
    for (let n = 0; n < lost; n++) out.push(place);
  }
  return out;
}

/** ahead: the board coming next (a replay's next frame) - a battle creamate fallen there only on its way to the
 *  돗테오키 존 (the standby phase's: its 체력 cards go first) flies to the gauge */
function playDepartures(before, state, speed, from, gone, opHand, ahead) {
  const count = (codes) => codes.reduce((m, c) => m.set(c, (m.get(c) || 0) + 1), new Map());
  const onToDotte = (side, code) => {
    if (!ahead) return false;
    const n = (codes) => codes.filter((c) => c === code).length;
    return n(ahead[side].fallen) < n(state[side].fallen) && n(ahead[side].dotte) > n(state[side].dotte);
  };
  for (const side of ["me", "op"]) {
    const sources = [];
    if (side === "me") for (const [code, places] of gone) for (const place of places) sources.push({ code, kind: "hand", place });
    for (const zone of ["battle", "support"]) {
      state[side][zone].forEach((now, i) => {
        const was = before[side][zone][i];
        const code = was && (zone === "battle" ? was.id : was.code);
        const still = now && (zone === "battle" ? now.id : now.code);
        const place = from.field[side][zone][i];
        if (code && still !== code && place) sources.push({ code, kind: zone, place });
      });
    }
    // Cards that left the 돗테오키 gauge (oldest first) — for village landings
    const gaugeLeft = count(state[side].dotte);
    before[side].dotte.forEach((code, i) => {
      if ((gaugeLeft.get(code) || 0) > 0) {
        gaugeLeft.set(code, gaugeLeft.get(code) - 1);
        return;
      }
      const places = from.field[side].dotte || [];
      const place = places[Math.min(i, Math.max(0, places.length - 1))];
      if (place) sources.push({ code, kind: "dotte", place });
    });
    const hpSources = hpVillageSources(before, state, from, side);
    let handLeft = side === "op" ? opHand : 0;
    let villageFromDotte = 0;
    let villageFromHp = 0;
    const row = document.getElementById(side === "me" ? "my-row" : "op-row");
    for (const [pile, target, kinds] of DEPART_TO) {
      const had = count(before[side][pile]);
      const to = row.querySelector(target);
      const ids = state[side][pile];
      for (let idx = 0; idx < ids.length; idx++) {
        const code = ids[idx];
        if ((had.get(code) || 0) > 0) {
          had.set(code, had.get(code) - 1);
          continue;
        }
        let i = -1;
        for (const kind of kinds) if ((i = sources.findIndex((s) => s.code === code && s.kind === kind)) >= 0) break;
        const toGauge = pile === "fallen" && onToDotte(side, code);
        const src = i >= 0 ? sources.splice(i, 1)[0] : null;
        let fromHp = false;
        let place = src?.place
          || (handLeft > 0 && kinds.includes("hand") ? (handLeft--, { rect: from.op, el: leveled(code) }) : null);
        // 체력 overlay → 마을: fly from the damaged creamate (damage order),
        // already at village card size (not the battle creamate's size)
        if (!place && pile === "village" && hpSources.length) {
          const creamate = hpSources.shift();
          const villageFace = row.querySelector(".village-lane > .card-face");
          const vw = villageFace?.getBoundingClientRect();
          place = {
            rect: creamate.rect,
            el: leveled(code),
            w: vw?.width || creamate.w || creamate.rect.width,
            h: vw?.height || creamate.h || creamate.rect.height,
          };
          fromHp = true;
        }
        if (!place) continue;
        if (toGauge) {
          // Card skipped fallen and went to 돗테오키 — land on the newest gauge slot
          const di = Math.min(state[side].dotte.length - 1, GAUGE_MAX - 1);
          if (di >= 0) launchSanctuaryFlight(place, { side, pile: "dotte", index: di, code }, speed);
          else launchDeparture(place, row.querySelector(".gauge"), speed);
        } else if (FACE_UP_PILES.has(pile)) {
          const landIdx = pile === "village" ? Math.min(idx, VILLAGE_VISIBLE - 1)
            : pile === "dotte" ? Math.min(idx, GAUGE_MAX - 1)
            : idx;
          let delay = 0;
          if (pile === "village" && src?.kind === "dotte") {
            delay = (villageFromDotte++ * VILLAGE_STAGGER_MS) / Math.max(0.01, speed);
          } else if (pile === "village" && fromHp) {
            delay = (villageFromHp++ * HP_VILLAGE_STAGGER_MS) / Math.max(0.01, speed);
          }
          launchSanctuaryFlight(place, { side, pile, index: landIdx, code }, speed, delay);
        } else {
          launchDeparture(place, to, speed);
        }
      }
    }
  }
}

/** Fly a card onto a face-up pile slot (성전 / 돗테오키 / 마을; no fade-out). */
function launchSanctuaryFlight(place, f, speed, delayMs = 0) {
  const fallbackOf = () => {
    const row = document.getElementById(f.side === "me" ? "my-row" : "op-row");
    if (f.pile === "dotte") return row?.querySelector(".gauge");
    if (f.pile === "village") return row?.querySelector(".village-pile");
    return row?.querySelector(`.sanctuary-lane.${f.pile}`);
  };
  const estimateFlightMs = () => {
    const card = faceUpPileTarget(f);
    const to = (card || fallbackOf())?.getBoundingClientRect();
    if (!to) return FLY_MIN_MS / Math.max(0.01, speed);
    const { rect } = place;
    return flyDurationMs(
      rect.left + rect.width / 2 - (to.left + to.width / 2),
      rect.top + rect.height / 2 - (to.top + to.height / 2),
      speed,
    );
  };
  const flightMs = estimateFlightMs();
  noteMotion(delayMs + flightMs);
  const start = () => {
    const card = faceUpPileTarget(f);
    if (!card) {
      sanctuaryFlights = sanctuaryFlights.filter((x) => x !== f);
      return launchDeparture(place, fallbackOf(), speed);
    }
    const { rect, el: src } = place;
    const to = card.getBoundingClientRect();
    const ghost = (src || leveled(f.code)).cloneNode(true);
    ghost.classList.add("flying");
    ghost.classList.remove("playable", "picked", "leaving");
    ghost.style.visibility = "";
    const w = place.w || rect.width;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    Object.assign(ghost.style, {
      left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    });
    document.getElementById("fly").append(ghost);
    const dx = x - (to.left + to.width / 2);
    const dy = y - (to.top + to.height / 2);
    const startScale = Math.max(0.2, w / Math.max(1, to.width));
    const ms = flyDurationMs(dx, dy, speed);
    card.style.visibility = "hidden";
    f.ghost = ghost;
    f.end = performance.now() + ms;
    if (!sanctuaryFlights.includes(f)) sanctuaryFlights.push(f);
    ghost.animate(
      [{ translate: `${dx}px ${dy}px`, scale: startScale, opacity: 1 }, { translate: "0 0", scale: 1, opacity: 1 }],
      { duration: ms, easing: "linear" },
    ).onfinish = () => landSanctuary(f);
  };
  // Hide the landing slot immediately so it does not flash before a staggered flight
  const slot = faceUpPileTarget(f);
  if (slot) slot.style.visibility = "hidden";
  f.end = performance.now() + delayMs + flightMs;
  if (!sanctuaryFlights.includes(f)) sanctuaryFlights.push(f);
  if (delayMs > 0) setTimeout(start, delayMs);
  else start();
}

function launchDeparture(place, to, speed) {
  if (!to) return;
  const { rect, el: card } = place;
  const ghost = card.cloneNode(true);
  ghost.classList.add("flying", "leaving");
  ghost.classList.remove("playable", "picked");
  ghost.style.visibility = "";
  // (its own size, round its middle: a card turned sideways (경직) flies upright)
  const w = place.w || rect.width;
  const h = place.h || rect.height;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  Object.assign(ghost.style, { left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` });
  document.getElementById("fly").append(ghost);
  const end = to.getBoundingClientRect();
  const dx = end.left + end.width / 2 - x;
  const dy = end.top + end.height / 2 - y;
  const ms = flyDurationMs(dx, dy, speed);
  noteMotion(ms);
  ghost.animate([
    { translate: "0 0", scale: 1, opacity: 1 },
    { translate: `${dx * 0.8}px ${dy * 0.8}px`, scale: 0.32, opacity: 1, offset: 0.8 },
    { translate: `${dx}px ${dy}px`, scale: 0.15, opacity: 0 },
  ], { duration: ms, easing: "linear" }).onfinish = () => ghost.remove();
}

function launchFlight(f, from, speed) {
  const card = flightTarget(f);
  if (!card) return;
  const to = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add("flying");
  Object.assign(ghost.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.getElementById("fly").append(ghost);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const ms = flyDurationMs(dx, dy, speed);
  noteMotion(ms);
  card.style.visibility = "hidden";
  f.ghost = ghost;
  f.end = performance.now() + ms;
  flights.push(f);
  ghost.animate([{ translate: `${dx}px ${dy}px`, scale: from.width / to.width }, { translate: "0 0", scale: 1 }],
    { duration: ms, easing: "linear" }).onfinish = () => landFlight(f);
}

/** Battle creamate upright ↔ 경직 (defense) spin (~0.5s). Board DOM is rebuilt each draw, so pending
 *  spins are tracked and reattached onto the new face when a later draw lands mid-animation. */
const STIFF_TURN_MS = 200;
const stiffPending = [];

function stiffAngleAt(p, now = performance.now()) {
  const t = Math.min(1, Math.max(0, (now - p.start) / p.ms));
  // ease-in-out (same curve as CSS)
  const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return p.from + (p.to - p.from) * e;
}

function playStiffSpin(face, slot, p) {
  const now = performance.now();
  const left = Math.max(16, p.ms - (now - p.start));
  const from = stiffAngleAt(p, now);
  slot.classList.toggle("stiff", p.to === 90);
  for (const a of face.getAnimations()) a.cancel();
  face.style.transition = "none";
  const anim = face.animate(
    [
      { transform: `translate(-50%, -50%) rotate(${from}deg)` },
      { transform: `translate(-50%, -50%) rotate(${p.to}deg)` },
    ],
    { duration: left, easing: "ease-in-out", fill: "forwards" },
  );
  anim.onfinish = () => {
    face.style.transform = "";
    face.style.transition = "";
  };
}

function stiffTurns(before, state, speed) {
  const now = performance.now();
  const ms = STIFF_TURN_MS / Math.max(0.01, speed);

  for (let i = stiffPending.length - 1; i >= 0; i--) {
    const p = stiffPending[i];
    if (now - p.start >= p.ms) {
      stiffPending.splice(i, 1);
      continue;
    }
    const next = state[p.side].battle[p.index];
    if (!next || next.id !== p.id) {
      stiffPending.splice(i, 1);
      continue;
    }
    const slot = document.querySelector(
      `#${p.side === "me" ? "my-row" : "op-row"} .battle-cell[data-index="${p.index}"] .slot.battle`,
    );
    const face = slot?.querySelector(":scope > .card-face");
    if (!slot || !face) continue;
    playStiffSpin(face, slot, p);
  }

  if (!before) return;
  for (const side of ["me", "op"]) {
    for (let i = 0; i < 3; i++) {
      const prev = before[side].battle[i];
      const next = state[side].battle[i];
      if (!prev || !next || prev.id !== next.id) continue;
      if (!!prev.stiff === !!next.stiff) continue;
      if (stiffPending.some((p) => p.side === side && p.index === i && p.id === next.id)) continue;
      const slot = document.querySelector(
        `#${side === "me" ? "my-row" : "op-row"} .battle-cell[data-index="${i}"] .slot.battle`,
      );
      const face = slot?.querySelector(":scope > .card-face");
      if (!slot || !face) continue;
      const p = {
        side, index: i, id: next.id,
        from: prev.stiff ? 90 : 0,
        to: next.stiff ? 90 : 0,
        start: now, ms,
      };
      stiffPending.push(p);
      playStiffSpin(face, slot, p);
      noteMotion(ms);
    }
  }
}

/** fx: show what happened to the battle creamates since the last drawing (a replay going back or jumping: not) */
function draw(state, { fx = true, speed = 1, ahead = null } = {}) {
  const before = lastDrawn;
  lastDrawn = state;
  if (fx && before) queueMicrotask(() => cardFx(before, state, speed));   // (once the board is drawn)
  const from = fx && before ? handPlaces() : null;   // (where the hands' cards were, before they are drawn again)
  pileSections = null;
  drawRow(state, "op");
  drawRow(state, "me");
  if (fx) stiffTurns(before, state, speed);
  requestAnimationFrame(() => fitFieldContent());
  if (pileSections) pileSections();
  document.getElementById("op-hand").replaceChildren(...state.op.hand.map(() => back("op", state.op.summoner)));
  document.getElementById("my-hand").replaceChildren(...state.me.hand.map((c) => leveled(c.code, c)));
  handArrivals(fx ? before : null, state, speed);
  playFlights(from && before, state, speed, from, ahead);
  const turnBox = document.getElementById("turn-box") || document.querySelector(".turn-box");
  const whoTurn = state.turnPlayer === "me" ? t("game.myTurn") : t("game.oppTurn");
  if (turnBox) turnBox.textContent = t("game.turn", { n: state.turn, who: whoTurn });
  document.getElementById("phases").replaceChildren(...PHASES().map((name, i) => el("li", i === state.phase ? "on" : "", name)));
  const d = menu && menu.decision;
  const button = document.getElementById("phase-button");
  const battle = state.phase === 3;
  const wait = battle && !replaying ? endTurnWait(state) : 0;
  button.textContent = battle
    ? `${t("game.endTurn")}${wait ? `(${wait}s)` : ""}`
    : t("game.battlePhase");
  button.disabled = wait > 0 || !(d && d.options.some((o) => o.kind === (battle ? K.BATTLE_TO_EP : K.TO_BP)));
}

/* 턴 종료 waits END_TURN_WAIT ms from the start of this player's battle phase (the 배틀 페이즈 button clicked
 * twice does not end the turn): the seconds still to wait, counted down on the button. The first turn, with no
 * attack allowed, waits only FIRST_TURN_WAIT */
const END_TURN_WAIT = 5000;
const FIRST_TURN_WAIT = 1000;
let endTurnLock = { turn: 0, until: 0 };

function endTurnWait(state) {
  if (state.turnPlayer !== "me") return 0;
  if (endTurnLock.turn !== state.turn) {
    endTurnLock = { turn: state.turn, until: Date.now() + (state.turn === 1 ? FIRST_TURN_WAIT : END_TURN_WAIT) };
  }
  const left = Math.ceil((endTurnLock.until - Date.now()) / 1000);
  if (left > 0) setTimeout(render, 250);
  return Math.max(0, left);
}

// ---- the engine's game as the board's state ----------------------------------------
function phaseIndex(phase) {
  const C = duel.C;
  if (phase === C.PHASE_DRAW) return 0;
  if (phase === C.PHASE_STANDBY) return 1;
  if (phase === C.PHASE_MAIN1 || phase === C.PHASE_MAIN2) return 2;
  if (phase === C.PHASE_END) return 4;
  return phase ? 3 : 0;
}

/* the hand as it is shown: 전사 마법사 나이트 승려 알케미스트, then level 3-2-1,
 * then 불 물 땅 바람 해 달, then the lower card number */
const ATTRIBUTE_ORDER = { 4: 0, 2: 1, 1: 2, 8: 3, 16: 4, 32: 5 };
const lowBit = (v) => v & -v;

function sortHand(hand) {
  const key = (c) => [lowBit(c.data.race) || 99, -duel.levelOf(c), ATTRIBUTE_ORDER[lowBit(c.data.attribute)] ?? 9, c.code];
  return [...hand].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

/** a 나이트's pull: "통상공격" (enemies must attack it, Kirafan5.Aggroknight), "돗테오키" (enemy battle zone
 *  dotte effects must target it, Kirafan5.SkillAggroknight), "both" or "" */
function aggroOf(c) {
  const C = duel.C;
  const attack = c.effects.some((e) => e.code === C.EFFECT_CANNOT_SELECT_BATTLE_TARGET);
  const dotte = c.effects.some((e) => e.code === C.EFFECT_CANNOT_BE_EFFECT_TARGET);
  return attack && dotte ? "both" : attack ? "통상공격" : dotte ? "돗테오키" : "";
}

function sideState(p) {
  const C = duel.C;
  const z = duel.p[p];
  const summoner = z.mzone[5] || z.mzone[6];
  const battle = BATTLE_SEQS.map((s) => {
    const c = z.mzone[s];
    return c && {
      card: c, id: c.code, hp: c.overlay.length, maxHp: c.data.def, atk: duel.atkOf(c),
      attacks: c.counters.get(COUNTER_ATTACKS) || 0, stiff: (c.position & C.POS_DEFENSE) !== 0,
      status: STATUS_COUNTERS.filter(([k]) => c.counters.get(k)).map(([k, name]) => ({ name, turns: c.counters.get(k) })),
      aggro: aggroOf(c),
    };
  });
  if (p !== me) battle.reverse();   // (the opponent's side faces this player)
  const support = z.szone.filter(Boolean);
  const fallen = z.extra.filter((c) => c.faceup);
  return {
    name: names[p],
    summoner: summoner ? summoner.code : revealed[p] ? duel.decks[p].summoner : 0,
    entering: entering === p,
    summonerCard: summoner || null,
    truth: !!summoner && duel.isSetCard(summoner, TRUTH_SETCODE),
    hand: p === me ? sortHand(z.hand) : [...z.hand],
    alchemist: lastAlchemist[p],
    deck: z.deck.length,
    village: z.removed.map((c) => c.code), // oldest first; top face = last
    dotte: z.grave.map((c) => c.code),
    placed: concealOpeningSanctuary ? [] : (summoner ? summoner.overlay.map((c) => c.code) : []),
    fallen: fallen.map((c) => c.code),
    battle,
    support: [...support, null, null, null].slice(0, 3),
    sanctuaryLevel: fallen.reduce((n, c) => n + duel.levelOf(c), 0),
    fieldLevel: summoner ? duel.atkOf(summoner) : 0,
    limit: summoner ? duel.defOf(summoner) : 0,
  };
}

function bothOpeningSanctuaryDone() {
  if (!duel) return false;
  for (const p of [0, 1]) {
    const z = duel.p[p];
    const summoner = z.mzone[5] || z.mzone[6];
    if (!summoner || summoner.overlay.length < 4) return false;
  }
  return true;
}

function revealOpeningSanctuary() {
  if (!concealOpeningSanctuary) return;
  if (!bothOpeningSanctuaryDone()) return;
  concealOpeningSanctuary = false;
  if (openedPile?.endsWith(":성전")) closePile();
  for (const { owner, names } of pendingSanctuaryLogs) {
    const count = names.length > 1 ? t("log.cardsParen", { n: names.length }) : "";
    log(t("log.toSanctuary", { who: who(owner), names: names.join(", "), count }));
  }
  pendingSanctuaryLogs = [];
  if (!replaying) recordFrame(savedState(boardState()));
  render();
}

function boardState() {
  return {
    turn: duel.turn, phase: phaseIndex(duel.phase), turnPlayer: duel.turnPlayer === me ? "me" : "op",
    me: sideState(me), op: sideState(1 - me),
  };
}

let drawTimer = 0;
/** one redraw for everything that happened in this task (a timer, not requestAnimationFrame: that one stops while
 *  the tab is in the background, and the game goes on) */
function render() {
  if (!duel || drawTimer) return;
  drawTimer = setTimeout(() => {
    drawTimer = 0;
    draw(boardState());
  }, 0);
}

/** run a pending redraw now (and cancel its timer) so attack FX see the board that just changed */
function flushDraw() {
  if (!drawTimer) return;
  clearTimeout(drawTimer);
  drawTimer = 0;
  draw(boardState());
}

// ---- the replay being recorded ------------------------------------------------------
/* A frame: the board as this player saw it (boardState without the engine's cards: codes, the opponent's hand
 * a count) whenever the log told something and before every decision, with the log's lines since the last one -
 * only what changed (replays.js diff). */
// (cues: the voices said, [kind, code]; actor: the card that came out / used an effect / attacked last)
const recorder = { frames: [], last: null, lines: [], cues: [], actor: 0, attack: null, thrust: false, id: null };

function savedState(state) {
  const side = (p, mine) => ({
    name: p.name, summoner: p.summoner, truth: p.truth, alchemist: [...p.alchemist],
    hand: mine ? p.hand.map((c) => c.code) : p.hand.length,
    deck: p.deck, village: p.village, dotte: p.dotte, placed: p.placed, fallen: p.fallen,
    battle: p.battle.map((b) => b && { id: b.id, hp: b.hp, maxHp: b.maxHp, atk: b.atk, attacks: b.attacks,
      stiff: b.stiff, status: b.status, aggro: b.aggro }),
    support: p.support.map((c) => (c ? c.code : 0)),
    sanctuaryLevel: p.sanctuaryLevel, fieldLevel: p.fieldLevel, limit: p.limit,
  });
  return { turn: state.turn, phase: state.phase, turnPlayer: state.turnPlayer, me: side(state.me, true), op: side(state.op, false) };
}

/** a saved state as draw() takes it */
function shownState(saved) {
  const side = (p) => ({
    ...p, entering: false, summonerCard: null,
    hand: Array.isArray(p.hand) ? p.hand.map((code) => ({ code })) : Array.from({ length: p.hand }, () => ({})),
    battle: p.battle.map((b) => b && { ...b, card: null }),
    support: p.support.map((code) => (code ? { code } : null)),
  });
  return { ...saved, me: side(saved.me), op: side(saved.op) };
}

// ---- the attack motion --------------------------------------------------------------
/* As an attack's target is chosen: the attacker's weapon (a 마법사's wand, the others' sword) in its attribute's
 * colour comes out turned towards the target and waits there, the target mark of that colour stamped big over the
 * middle of the target's art (every enemy's, for an attack that hits them all). As the attacked player answers - a
 * support, or none (the engine's "answer") - the mark goes and the weapon is thrust at the target. A battle
 * creamate's 돗테오키 that deals damage does the same, from its activation to the answer to it; one that hits one
 * enemy and then all of them (combo) is thrust at the one, then a weapon for each enemy at them all.
 * Places as this player sees them: { side: "me" | "op", index: 0-2 left to right }, so a replay keeps them as
 * they are (frame.k: the aim, frame.t: the thrust). */
const AIM_MS = 400;
const THRUST_MS = 450;
const HOLD_MS = 700;   // the least the weapon is out before it is thrust (an answer at once, a 돗테오키 resolving)
let swing = null;      // the weapons waiting to be thrust: { parts: [{ weapon, at }], marks, since, then }
let thrusting = null;  // a thrust waiting out HOLD_MS: { go, timer }
let comboTimer = 0;    // a 돗테오키 hitting one enemy and then all (info.combo): the second blow, as the first is thrust

/** an attack event as the motion takes it */
function attackInfo(e) {
  const place = (c) => {
    const i = BATTLE_SEQS.indexOf(c.sequence);
    return { side: c.controller === me ? "me" : "op", index: c.controller === me ? i : 2 - i };
  };
  const card = cards.get(e.attacker.code);
  return {
    from: place(e.attacker), to: e.target ? place(e.target) : null, all: !!e.all,
    foe: e.attacker.controller === me ? "op" : "me",
    attr: ATTRIBUTE_ICONS[String(card?.attribute || "").split("/")[0]] || "fire",
    wand: card?.class === "마법사",
  };
}

/** the waiting weapons thrust at their targets, the marks gone (once they have been out HOLD_MS); a combo's
 *  first blow followed by its second: a weapon for each enemy, thrust at them all */
function thrustFx(speed = 1) {
  if (!swing) return;
  const { parts, marks, since, then } = swing;
  swing = null;
  const go = () => {
    thrusting = null;
    marks.forEach((m) => m.remove());
    for (const { weapon, at } of parts) {
      weapon.getAnimations().forEach((a) => a.cancel());
      weapon.animate([
        { transform: at(-0.06, 1.1), opacity: 1 },
        { transform: at(0.55, 1.2), opacity: 1, offset: 0.6 },
        { transform: at(0.6, 1.2), opacity: 0 },
      ], { duration: THRUST_MS / speed, easing: "ease-in-out" }).onfinish = () => weapon.remove();
    }
    if (then) {
      comboTimer = setTimeout(() => {
        comboTimer = 0;
        attackFx({ ...then, all: true, each: true, combo: false }, { speed, second: true });
        thrustFx(speed);
      }, (THRUST_MS * 0.6) / speed);
    }
  };
  const wait = since + HOLD_MS / speed - performance.now();
  if (wait <= 0) return go();
  thrusting = { go, timer: setTimeout(go, wait) };
}

/** the motion gone at once (a replay going back or jumping) */
function clearAttackFx() {
  if (thrusting) clearTimeout(thrusting.timer);
  clearTimeout(comboTimer);
  document.querySelectorAll("#fx > *").forEach((x) => x.remove());
  swing = thrusting = null;
  comboTimer = 0;
}

/** the weapon out and aimed, waiting (thrustFx), and the marks. info.each: a weapon for each target (a combo's
 *  second blow), else one aimed at them all */
function attackFx(info, { speed = 1, second = false } = {}) {
  // (a thrust still waiting goes now, a combo's second blow not at all; a weapon never thrust goes)
  if (!second) {
    clearTimeout(comboTimer);
    comboTimer = 0;
  }
  if (thrusting) {
    clearTimeout(thrusting.timer);
    thrusting.go();
    clearTimeout(comboTimer);
    comboTimer = 0;
  }
  if (swing) {
    swing.parts.forEach((p) => p.weapon.remove());
    swing.marks.forEach((m) => m.remove());
    swing = null;
  }
  const fx = document.getElementById("fx");
  const board = document.getElementById("board").getBoundingClientRect();
  const cellOf = (side, i) => document.querySelector(`#${side === "me" ? "my-row" : "op-row"} .battle-cell[data-index="${i}"]`);
  const from = cellOf(info.from.side, info.from.index);
  // (no target: an attack straight at the player, the summoner card)
  const summoner = document.querySelector(`#${info.foe === "me" ? "my-row" : "op-row"} .summoner-box .summoner-face`);
  // (the enemies there now; a combo's second blow, those there as it was aimed - one may have fallen to it since)
  const enemies = [0, 1, 2].filter((i) => cellOf(info.foe, i)?.querySelector(".card-face"));
  const targets = info.all
    ? (info.places || enemies).map((i) => cellOf(info.foe, i)).filter(Boolean)
    : [info.to ? cellOf(info.to.side, info.to.index) : summoner].filter(Boolean);
  if (!from || !targets.length) return;
  const center = (box) => boardLocalCenter(board, box);
  const a = center(from);
  const points = targets.map(center);
  const middle = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  const parts = (info.each ? points : [middle]).map((aim) => {
    const dx = aim.x - a.x;
    const dy = aim.y - a.y;
    // (the pictures point up and to the left: -135°)
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 135;
    const weapon = el("img", "fx-weapon");
    weapon.src = `assets/attack/${info.wand ? "wand" : "sword"}-${info.attr}.png`;
    weapon.style.left = `${a.x}px`;
    weapon.style.top = `${a.y}px`;
    fx.append(weapon);
    const at = (f, s) => `translate(-50%, -50%) translate(${dx * f}px, ${dy * f}px) rotate(${angle}deg) scale(${s})`;
    const aimAnim = weapon.animate([
      { transform: at(0, 0.5), opacity: 0 },
      { transform: at(0.04, 1.05), opacity: 1, offset: 0.55 },
      { transform: at(-0.06, 1.1), opacity: 1 },
    ], { duration: AIM_MS / speed, easing: "ease-out", fill: "forwards" });
    // After aim: rock along the facing axis until thrust.
    // Period matches .fx-target-pulse (0.9s ease-in-out alternate).
    aimAnim.finished.then(() => {
      if (!weapon.isConnected || !swing?.parts.some((p) => p.weapon === weapon)) return;
      weapon.animate([
        { transform: at(-0.116, 1.1) },
        { transform: at(-0.004, 1.1) },
      ], {
        duration: 900 / speed,
        easing: "ease-in-out",
        direction: "alternate",
        iterations: Infinity,
      });
    }).catch(() => {});
    return { weapon, at };
  });
  const marks = targets.map((t) => {
    const elTarget = t.querySelector(".card-face") || t.querySelector(".slot") || t;
    const p = boardLocalCenter(board, elTarget);
    const mark = el("img", "fx-target");
    mark.src = `assets/attack/target-${info.attr}.png`;
    mark.style.left = `${p.x}px`;
    mark.style.top = `${p.y}px`;
    fx.append(mark);
    return mark;
  });
  swing = { parts, marks, since: performance.now(), then: info.combo ? { ...info, places: enemies } : null };
  // Aim + hold + thrust (+ optional combo second blow)
  let attackMs = (AIM_MS + HOLD_MS + THRUST_MS) / Math.max(0.01, speed);
  if (info.combo) attackMs += (THRUST_MS * 0.6 + AIM_MS + HOLD_MS + THRUST_MS) / Math.max(0.01, speed);
  noteMotion(attackMs);
}

// ---- what happened to a battle creamate ---------------------------------------------
/* Seen in the board's change from one drawing to the next (so a replay shows it as well): healed (more 체력, not
 * as it comes out) - a heart over it, then "かいふく" rising out of the top of its art; a stronger attack - the
 * orange flame; a status put on it (or made longer) - the blue one. */
const CARD_FX_MS = 500;
const HEAL_TEXT_MS = 900;

function cardFx(before, after, speed = 1) {
  for (const side of ["me", "op"]) {
    after[side].battle.forEach((b, i) => {
      const a = before[side].battle[i];
      if (!a || !b || a.id !== b.id) return;
      const longer = (s) => {
        const was = (a.status || []).find((x) => x.name === s.name);
        return !was || s.turns > was.turns;
      };
      const kinds = [];
      if (a.hp > 0 && b.hp > a.hp) kinds.push("heart");
      if (b.atk > a.atk) kinds.push("buff");
      if ((b.status || []).some(longer)) kinds.push("debuff");
      if (kinds.length) cardFxAt(side, i, kinds, speed);
    });
  }
}

function cardFxAt(side, index, kinds, speed) {
  const face = document.querySelector(`#${side === "me" ? "my-row" : "op-row"} .battle-cell[data-index="${index}"] .card-face`);
  if (!face) return;
  const fx = document.getElementById("fx");
  const board = document.getElementById("board").getBoundingClientRect();
  const mid = boardLocalCenter(board, face);
  const s = boardScale();
  const r = face.getBoundingClientRect();
  const put = (className, src, y) => {
    const img = el("img", className);
    img.src = src;
    img.style.left = `${mid.x}px`;
    img.style.top = `${y}px`;
    fx.append(img);
    return img;
  };
  const fxMs = CARD_FX_MS / Math.max(0.01, speed);
  noteMotion(kinds.includes("heart") ? fxMs + HEAL_TEXT_MS / Math.max(0.01, speed) : fxMs);
  for (const kind of kinds) {
    const icon = put("fx-card", `assets/effects/${kind}.png`, mid.y);
    icon.animate([
      { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1, offset: 0.3 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.75 },
      { transform: "translate(-50%, -50%) scale(1.05)", opacity: 0 },
    ], { duration: fxMs, easing: "ease-out" }).onfinish = () => icon.remove();
  }
  if (!kinds.includes("heart")) return;
  setTimeout(() => {
    const text = put("fx-heal-text", "assets/effects/heal-text.png", mid.y - (r.height * 0.12) / s);
    text.animate([
      { transform: "translate(-50%, -50%) translateY(6px)", opacity: 0 },
      { transform: "translate(-50%, -50%) translateY(0)", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%, -50%) translateY(-14px)", opacity: 1, offset: 0.6 },
      { transform: "translate(-50%, -50%) translateY(-30px)", opacity: 0 },
    ], { duration: HEAL_TEXT_MS / Math.max(0.01, speed), easing: "ease-out" }).onfinish = () => text.remove();
  }, fxMs);
}

/** a battle creamate's 돗테오키 that deals damage to the enemy, as the motion takes it (null: none) - its text:
 *  "적 단일에게 ...데미지" the target chosen as it is activated, "적 전체에게 ...데미지" every enemy (a choice of the
 *  two, (선택 효과): the one with a target, or the other); both (호토 코코아): the one, then all of them (combo) */
function dotteAttack(e) {
  const C = duel.C;
  if (e.from !== C.LOCATION_MZONE || NOOP_DESCS.has(e.desc) || !cards.get(e.card.code)?.battle
    || !BATTLE_SEQS.includes(e.card.sequence)) return null;
  const block = (cards.get(e.card.code)?.desc || "").split(/\[돗테오키 게이지 \d+\]/)[1] || "";
  const text = block.split(/\n\s*\n/)[0];
  const choice = text.includes("(선택 효과)");
  const target = e.targets.find((t) => t.controller !== e.player && t.location === C.LOCATION_MZONE);
  const single = /적 단일에게[^.]*데미지/.test(text) && !!target;
  const all = /적 전체에게[^.]*데미지/.test(text) && (!choice || !e.targets.length);
  if (!all && !single) return null;
  if (single && all && !choice) return { ...attackInfo({ attacker: e.card, target, all: false }), combo: true };
  return attackInfo({ attacker: e.card, target: target || null, all });
}

/** the motion of an attack in a game being played (and kept for its replay): the thrust as the other player
 *  answers the attack or the 돗테오키 (a support, or none) */
let dotteSwing = null;   // the chain link of the 돗테오키 whose weapon waits
let aiming = false;      // an attack aimed, not yet thrust (the replay's aim kept even where the board had none)
function attackEvent(e) {
  const aim = (info) => {
    // (the board as it is now: a draw may still wait for its timer - render)
    flushDraw();
    recorder.attack = info;
    aiming = true;
    attackFx(info);
  };
  const thrust = () => {
    recorder.thrust = true;
    aiming = false;
    dotteSwing = null;
    thrustFx();
  };
  if (e.type === "chaining") {
    const info = dotteAttack(e);
    if (!info) return;
    aim(info);
    dotteSwing = e.index;
  } else if (e.type === "attack") aim(attackInfo(e));
  else if (e.type === "answer" ? (e.attack && aiming) || (dotteSwing !== null && e.index === dotteSwing)
    // (its resolving, the battle, a phase or the chain's end without an answer: the game ended or moved on before)
    : (e.type === "solving" && dotteSwing !== null && e.index === dotteSwing)
      || ((e.type === "battle" || e.type === "phase" || e.type === "turn") && aiming)
      || (e.type === "chainEnd" && dotteSwing !== null)) thrust();
}

/** the card an event shows acting: one coming out, using an effect, attacking (a summoner's 효과 발동X: none) */
function actorOf(e) {
  if (e.type === "summon" && !isSummoner(e.card)) return e.card.code;
  if (e.type === "chaining" && !NOOP_DESCS.has(e.desc)) return e.card.code;
  if (e.type === "attack") return e.attacker.code;
  return 0;
}

/** state: the board kept earlier for this frame (flushSanctuary), else as it is now */
function recordFrame(kept = null) {
  if (!duel || replaying) return;
  const state = kept || savedState(boardState());
  const change = diff(recorder.last, state);
  if (!change && !recorder.lines.length && !recorder.cues.length && !recorder.actor && !recorder.attack
    && !recorder.thrust) return;
  const frame = { s: change || {}, l: recorder.lines.splice(0) };
  if (recorder.cues.length) frame.v = recorder.cues.splice(0);
  if (recorder.actor) frame.a = recorder.actor;
  if (recorder.thrust) frame.t = 1;                 // (the attack motion: the weapon thrust, thrustFx)
  if (recorder.attack) frame.k = recorder.attack;   // (and aimed, attackFx)
  recorder.actor = 0;
  recorder.attack = null;
  recorder.thrust = false;
  recorder.frames.push(frame);
  recorder.last = state;
}

/** Archive AI / server-PvP replays on the API (admin folder). Local save is separate.
 *  Only games that reached 5+ turns are kept for admin. */
function archiveReplayRemote(replay, match) {
  const pvp = !!(match?.pvp || match?.roomId);
  const ai = !!match?.ai && !pvp;
  if (!pvp && !ai) return;
  const turns = Number(replay?.turns ?? match?.turns ?? 0);
  if (!(turns >= 5)) return;
  const body = {
    ...replay,
    mode: pvp ? "pvp" : "ai",
    roomId: match?.roomId || "",
  };
  fetch(`${API_BASE}/replays/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** the game so far kept for the replay list (again at its end: the same id) */
async function keepReplay(match, result) {
  flushSanctuary();
  recordFrame();
  if (!recorder.frames.length) return null;
  const payload = {
    id: recorder.id || Date.now(), format: FORMAT, date: new Date().toISOString(),
    names: [...(me === 0 ? names : [names[1], names[0]])], myDeck: match.me.name, aiDeck: match.ai.name,
    level: match.level, bot: match.bot || "", result, turns: duel.turn, frames: recorder.frames,
  };
  try {
    recorder.id = await saveReplay(payload);
    archiveReplayRemote({ ...payload, id: recorder.id }, match);
  } catch (err) {
    console.error(err);
    toast(t("replay.saveFail"));
  }
  // 전적만 계정 동기화 (덱 전문·리플레이 프레임은 올리지 않음)
  try {
    const record = makeMatchRecord({
      result,
      level: match.level,
      bot: match.bot || "",
      turns: duel.turn,
      myDeck: match.me?.name || "",
      aiDeck: match.ai?.name || "",
    });
    await submitMatchRecord(record);
  } catch (err) {
    console.warn(err);
  }
  return recorder.id;
}

// ---- the duel log ---------------------------------------------------------------
function log(text) {
  const list = document.getElementById("duel-log");
  list.append(el("li", "", text));
  list.scrollTop = list.scrollHeight;
  if (!replaying) recorder.lines.push(text);
}

const who = (p) => (p === me ? t("game.me") : t("game.opp"));

function effectText(desc) {
  return desc && !NOOP_DESCS.has(desc) ? describe(desc) : "";
}

/* cards put into the 성전 from the hand one after another (the opening's 4, the draw phase's one): one line, and
 * one action of the replay - the board as the last of them went in */
let sanctuaryPut = null;   // { owner, names, state }

function isSanctuaryPut(e) {
  const C = duel.C;
  return e.type === "move" && e.to.location === C.LOCATION_OVERLAY && e.from.location === C.LOCATION_HAND;
}

function flushSanctuary() {
  if (!sanctuaryPut) return;
  const entry = sanctuaryPut;
  sanctuaryPut = null;
  if (concealOpeningSanctuary) {
    pendingSanctuaryLogs.push(entry);
    revealOpeningSanctuary();
    return;
  }
  const { owner, names, state } = entry;
  const count = names.length > 1 ? t("log.cardsParen", { n: names.length }) : "";
  log(t("log.toSanctuary", { who: who(owner), names: names.join(", "), count }));
  recordFrame(state);
}

/** what happened, for the 기록 tab (only what the player could see) */
function logEntry(e) {
  const C = duel.C;
  switch (e.type) {
    case "turn": return log(t("log.turnBanner", {
      n: duel.turn,
      who: e.player === me ? t("game.myTurn") : t("game.oppTurn"),
    }));
    case "phase": return PHASE_NAMES()[e.phase] && e.phase !== C.PHASE_DRAW
      ? log(t("log.phase", { phase: PHASE_NAMES()[e.phase] })) : null;
    case "draw":   // (the opening's deals and redraws are told by what goes to the 성전)
      return duel.turn <= 1 && duel.phase <= C.PHASE_DRAW ? null
        : log(t("log.draw", { who: who(e.player), n: e.cards.length }));
    case "summon": return isSummoner(e.card) ? null
      : log(t("log.appear", { who: who(e.card.controller), name: nameOf(e.card) }));
    case "chaining": return NOOP_DESCS.has(e.desc) ? null : log(`${who(e.player)}: ${usedText(e.card, e.targets, e.desc, e.from)}`);
    case "solving": {
      // (a heal does nothing to a creamate under 불행; the scripts let it be targeted all the same)
      if (!effectText(e.desc).includes("회복")) return null;
      const healed = e.targets.length ? e.targets : duel.battleZone(e.player);
      const unhappy = healed.filter((c) => c.controller === e.player && (c.counters.get(UNHAPPY) || 0) > 0);
      return unhappy.length ? log(`${who(e.player)}: ${josa(unhappy.map((c) => nameOf(c)).join(", "), "은", "는")} 불행 상태라 회복되지 않습니다`) : null;
    }
    case "attack": return log(`${who(e.attacker.controller)}: ${attackText(e.attacker, e.target, e.all)}`);
    case "transform": return log(`${who(e.card.controller)}: ${josa(cards.get(e.from)?.name || t("log.card"), "이", "가")} ${e.card.name}(으)로 변했습니다`);
    case "destroyed": return log(t("log.fallen", { who: who(e.card.controller), name: nameOf(e.card, e.card.previous) }));
    case "move":
      if (isSanctuaryPut(e)) {
        if (sanctuaryPut && sanctuaryPut.owner !== e.card.owner) flushSanctuary();
        sanctuaryPut ||= { owner: e.card.owner, names: [] };
        sanctuaryPut.names.push(e.card.name);
        sanctuaryPut.state = replaying ? null : savedState(boardState());
        // 양쪽 개막 성전이 다 들어가면 바로 공개 (다음 이벤트까지 기다리지 않음)
        if (concealOpeningSanctuary && bothOpeningSanctuaryDone()) flushSanctuary();
        return null;
      }
      if (e.to.location === C.LOCATION_GRAVE && e.from.location & (C.LOCATION_HAND | C.LOCATION_MZONE)) {
        return log(t("log.toDotte", { who: who(e.card.owner), name: nameOf(e.card, e.from) }));
      }
      return null;
    case "hint": {
      const text = describe(e.desc);
      if (!text || e.player !== me) return null;
      toast(text.split("\n")[0]);
      return log(text.replace(/\n/g, " "));
    }
    case "battleContinues":
      if (e.player === me) toast(t("duel.oppSupportContinue"));
      return log(e.player === me ? t("log.mySupportContinue") : t("log.mySupportContinueSelf"));
    case "error": return console.warn("[엔진]", e.message);
    default: return null;
  }
}

// ---- the player's choices -----------------------------------------------------------
function optionLabel(o) {
  if (o.kind === K.SPSUMMON) return t("duel.summonToBattle");
  if (o.kind === K.ATTACK) return t("duel.normalAttack");
  if (o.kind === K.TO_BP) return t("game.toBattle");
  if (o.kind === K.BATTLE_TO_EP) return t("game.endTurn");
  if (o.kind === K.CHAIN_PASS) return t("duel.skip");
  if (o.desc === DOTTE_EFFECT) return t("duel.dotteEffect");
  return effectText(o.desc) || t("duel.activateEffectShort");
}

/**
 * Chip color from this option's effect text (label + effect; bare totteoki → card totteoki block).
 * Multi-effect priority: draw > status > atk > summon > gauge > heal
 * (heal then splits heal-aoe / heal-single)
 */
/** Drop "(배틀 페이즈 종료시) …" deferred bonuses so chip color follows the immediate effect only. */
function stripDeferredBattleEnd(text, cardDesc = "") {
  const END = /(?:\(?\s*|（\s*)?(?:배틀\s*페이즈\s*종료시|(?:自分の)?バトルフェイズ終了時|At\s+the\s+end\s+of\s+(?:your\s+)?Battle\s*Phase|Battle\s*Phase\s*Ends?)\s*(?:\)|）)?/i;
  let out = String(text || "");
  out = out.replace(new RegExp(END.source + "[\\s\\S]*", "i"), "");
  const desc = String(cardDesc || "");
  const hasEnd = END.test(desc);
  const dm = desc.match(new RegExp(END.source + "\\s*([^\\n(（]+)", "i"));
  if (dm) {
    const bonus = dm[1].trim().replace(/\s+/g, " ")
      .replace(/[＋]/g, "+").replace(/[－]/g, "-");
    // 본효과가 게이지뿐인데 종료 보너스도 게이지면 flex 삭제로 본효과까지 날아감 → 복합 라벨에만 적용
        const compound = /[,，、]|드로우|\bdraw\b|카드|부여|해제|회복|\bheal\b|攻撃|\batk\b/i.test(out);
    if (bonus && compound) {
      const flex = bonus
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\+/g, "\\s*\\+\\s*")
        .replace(/\\-/g, "\\s*-\\s*")
        .replace(/\s+/g, "\\s*");
      out = out.replace(new RegExp(flex, "gi"), " ");
    }
  }
  // 종료시 보너스만 제거 (본효과 게이지/드로우 문구는 유지)
  if (hasEnd) {
    const bonusLine = dm ? dm[1] : "";
    const endIsDraw = /드로우|draw|カードを.*引|ドロー/i.test(bonusLine);
    const endIsGauge = /게이지|gauge|ゲージ/i.test(bonusLine);
    // 라벨이 "부여/해제 … 드로우" 형태면 desc 번역과 무관하게 꼬리 드로우 제거
    const labelDeferredDraw = /(?:부여|해제|abnormals?|弱体|拘束|睡眠|不幸|空腹|孤立).{0,24}(?:드로우|draw|カードを)/i.test(out)
      || /(?:드로우|draw|カードを).{0,12}$/i.test(out) && /부여|해제|abnormal|弱体|拘束|睡眠|不幸/i.test(out);
    if (endIsDraw || labelDeferredDraw) {
      out = out.replace(
        /(?:\s|,|、)+?(?:드로우\s*\+?\s*\d*|draw\s*\d*\s*cards?|カードを\s*\d+\s*枚引[くく]?)\s*$/gi,
        " ",
      );
      out = out.replace(/(부여|해제|解除|abnormals?)\s*(?:드로우\s*\+?\s*\d*|,\s*draw\s*\d*\s*cards?)/gi, "$1");
    }
    if (endIsGauge) {
      out = out.replace(
        /(?:\s|,|、)+?(?:돗테오키\s*게이지\s*[+\-]?\s*\d*|increase(?:\s+the)?\s+totteoki\s*gauge(?:\s*by\s*\d+)?|totteoki\s*gauge(?:\s*by)?\s*\d*|とっておきゲージ(?:を)?(?:\d+)?(?:増やす|増加|減らす)?)\s*$/gi,
        " ",
      );
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function optionChipKind(o) {
  if (o.kind === K.ATTACK) return "attack"; // 통상공격 → 하늘색
  const label = optionLabel(o);
  const effect = effectText(o.desc) || "";
  const cardDesc = (o.card && cards.get(o.card.code)?.desc) || "";
  let s = `${label}\n${effect}`;
  // EN: The "Totteoki" Effect / The Second Totteoki Effect (따옴표·Second 포함)
  const bareDotte = o.desc === DOTTE_EFFECT
    || (/(?:돗테오키|とっておき|totteoki)/i.test(label)
      && /(?:효과|効果|effect|スキル|skill)/i.test(label)
      && !/(?:게이지|ゲージ|gauge)/i.test(label));
  if (bareDotte) {
    // 샤미코 등 ①/② 선택: 해당 선택지 본문으로 색 분류
    const totteBlock = cardDesc.split(
      /\[돗테오키 게이지[^\]]*\]|【とっておきゲージ[^\]]*】|\[とっておきゲージ[^\]]*\]|\[Totteoki[^\]]*\]|\[Consume[^\]]*Totteoki\s*Gauge[^\]]*\]/i,
    )[1] || "";
    if (totteBlock.trim()) {
      const body = totteBlock.split(/\n\s*\n\s*\(/)[0];
      const choices = [...body.matchAll(/[①②③][:：]\s*([^\n①②③]+)/g)].map((m) => m[1].trim());
      const second = /두번째|第二|2つ目|second/i.test(label);
      if (choices.length) {
        const pick = second ? (choices[1] || choices[choices.length - 1]) : choices[0];
        s = `${label}\n${pick}`;
      } else {
        s = `${label}\n${body}`;
      }
    }
  }
  const kind = optionChipKindFromText(s, cardDesc);
  if (kind !== "other") return kind;
  // 돗테오키 효과 버튼: EN/JA 문구 미매칭으로 연노랑(other) 떨어지지 않게
  if (bareDotte) return "totteoki";

  // 플레이버 라벨(앨리스 등): 서포트 [스킬]/[Skill]/【スキル】 본문으로 재분류 (돗테오키 버튼에는 적용하지 않음)
  const skillBody = (cardDesc.match(/\[(?:스킬|スキル|Skill|Summon)\]\s*([\s\S]*?)(?=\n\s*\[|\n\s*【|$)/i)
    || cardDesc.match(/【(?:スキル|召喚)】\s*([\s\S]*?)(?=\n\s*【|$)/i)
    || [])[1];
  if (skillBody && skillBody.trim()) {
    const sk = stripDeferredBattleEnd(skillBody, cardDesc);
    if (sk) {
      const fromSkill = optionChipKindFromText(sk, cardDesc);
      if (fromSkill !== "other") return fromSkill;
    }
  }
  return "other";
}

/** optionChipKind 본문 분류만 (라벨·효과 문자열 s 기준) */
function optionChipKindFromText(s, cardDesc = "") {
  s = stripDeferredBattleEnd(String(s || ""), cardDesc);
  const healAoe = /광역\s*회복|全体回復|area\s*heal|광역.*회복|회복.*광역|全体.*回復|all[-\s]?heal|heal\s+to\s+all|all\s+allies|味方全体|아군\s*전체.*회복|회복.*아군\s*전체|全員回復/i.test(s)
    || (/(?:광역|aoe|아군\s*전체|味方全体|\ball\s+allies\b)/i.test(s) && /회복|heal|回復|recover|리커버리|リカバリー/i.test(s));
  const healSingle = /단일\s*회복|単体回復|single\s*heal|단일.*회복|회복.*단일|単体.*回復|heal\s+to\s+a\s+single|single\s+ally/i.test(s)
    || (/단일|単体|single/i.test(s) && /회복|heal|回復|recover|리커버리|リカバリー/i.test(s))
    || (/회복|heal|回復|recover|리커버리|リカバリー/i.test(s) && !healAoe);
  const hasHeal = healAoe || healSingle;
  const isCleanse = /상태이상\s*해제|状態異常を?(?:すべて)?解除|解除.*状態異常|clear\s+(?:all\s+)?abnormals|remove\s+(?:all\s+)?(?:status|abnormal)/i.test(s)
    || (/(?:상태이상|状態異常|abnormals?)/i.test(s) && /해제|解除|clear|cleanse|remove/i.test(s));
  const cleanseAoe = isCleanse && (
    /(?:광역|아군\s*전체|味方全体|all\s+allies|from\s+all\s+allies|全体の状態異常)/i.test(s)
    || /(?:아군\s*전체|味方全体|all\s+allies).{0,48}(?:상태이상|abnormal|状態異常)|(?:상태이상|abnormal|状態異常).{0,48}(?:아군\s*전체|味方全体|all\s+allies|全体)/i.test(cardDesc)
  );
  // EN "+2 draws" — \bdraw\b alone misses plural "draws"
  const hasDraw = /드로우|ドロー|\bdraws?\b|カードを\s*(?:\d+\s*枚)?引|draw\s+cards?|\+\s*\d+\s*draws?/i.test(s)
    || /크리에메이트\s*\([^)]*속성\)\s*를\s*패에|サーチ|(?:속성).{0,20}패에|패에.{0,20}(?:속성)|add\s+.*(?:attribute|creamate).*\s+to\s+(?:your\s+)?hand|手札に加/i.test(s)
    || (/(?:불|물|바람|땅|해|달|어둠)\s*속성|火|水|風|地|陽|月|闇/i.test(s) && /패에\s*넣|手札/i.test(s));
  const hasStatus = !isCleanse && /상태이상|状態異常|abnormals?|\bstatus\b|경직|硬直|load\s*factor|stiff|나약함|약화|弱体|weak(?:ness)?|침묵|沈黙|silence|혼란|混乱|confusion|불행|不幸|misfortune|unhappy|독|고립|孤立|isolat(?:e|ion)|수면|睡眠|\bsleep\b|속박|束縛|拘束|paralysis|\bbind\b|배고픔|空腹|hunger/i.test(s);
  const hasAtk = /공격력|攻撃力|\batk\b|attack\s*power|공격\s*력|攻撃力を|攻撃力アップ|atk\s*up/i.test(s)
    || (/통상\s*공격|通常攻撃|normal\s*attack/i.test(s)
      && /(?:적\s*)?전체|全体|all\s+enemies|데미지|damage|횟수|回数|target(?:s)?\s+all/i.test(s));
  const hasSummon = /배틀\s*존에\s*소환|バトルゾーンに召喚|summon\s+to\s+battle|battle\s*zone.*summon|소환.*배틀|バトル.*召喚/i.test(s)
    || (/배틀\s*존|バトルゾーン|battle\s*zone/i.test(s) && /소환|召喚|summon/i.test(s));
  // JA MT leftovers → treat as とっておきゲージ
  const hasGauge = /돗테오키\s*게이지|とっておき(?:」)?ゲージ|totteoki\s*gauge|特選ゲージ|特技ゲージ|秘蔵ゲージ|必殺ゲージ|スペシャルゲージ|お宝ゲージ|秘策ゲージ|トッテオキゲージ|(?:^|[^ぁ-んァ-ヶ一-龯a-z])ゲージ\s*[+\-＋－]/i.test(s)
    && (/[+\-＋－]|증가|감소|減ら|増や|increase|decrease|上昇|低下|\+\d|\-\d|ゲージ増加|ゲージ減少/i.test(s)
      || /게이지를|ゲージを|gauge\s+by/i.test(s));
  if (hasDraw) return "draw";
  if (hasStatus) return "status";
  if (hasAtk) return "atk";
  if (hasSummon) return "summon";
  if (hasGauge) return "gauge";
  if (hasHeal || isCleanse) return (healAoe || cleanseAoe) ? "heal-aoe" : "heal-single";
  return "other";
}

function closeMenu() {
  const list = document.getElementById("card-menu");
  list.hidden = true;
  list.classList.remove("ribbon", "cream", "flip-in");
}

/** a card the open menu has options for: it glows, and a click lists them */
function offerMenu(box, card) {
  if (!menu) return;
  const options = menu.decision.options.map((o, i) => ({ o, i })).filter(({ o }) => o.card === card && !o.noop);
  if (!options.length) return;
  box.classList.add("playable");
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    const list = document.getElementById("card-menu");
    list.classList.remove("ribbon", "cream");
    const n = options.length;
    list.style.setProperty("--chip-total", String(n));
    list.replaceChildren(...options.map(({ o, i }, order) => {
      const kind = optionChipKind(o);
      const b = el("button", `menu-button small effect-chip effect-chip--${kind}`, optionLabel(o));
      // bottom → top page-flip: last option (bottom) first
      b.style.setProperty("--chip-i", String(order));
      b.addEventListener("click", () => answerMenu(i));
      return b;
    }));
    const boardEl = document.getElementById("board");
    const board = boardEl.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const sc = boardScale();
    list.hidden = false;
    // restart flip if the same menu is opened again
    list.classList.remove("flip-in");
    void list.offsetWidth;
    list.classList.add("flip-in");
    const w = list.offsetWidth;
    const cx = (r.left - board.left + r.width / 2) / sc;
    const topLocal = (r.top - board.top) / sc - list.offsetHeight - 6;
    const botLocal = (r.bottom - board.top) / sc + 6;
    list.style.left = `${Math.min(Math.max(0, cx - w / 2), boardEl.clientWidth - w)}px`;
    list.style.top = `${topLocal > 0 ? topLocal : botLocal}px`;
  });
}

function answerMenu(i) {
  if (!menu) return;
  const { resolve, bar } = menu;
  menu = null;
  closeMenu();
  if (bar) {
    document.getElementById("select-bar").hidden = true;
    document.getElementById("select-ok").onclick = null;
  }
  render();
  resolve(i);
}

function askMenu(d) {
  return new Promise((resolve) => {
    menu = { decision: d, resolve };
    render();
  });
}

/** a question over the board: buttons [{ label, value, card?, primary?, wide? }];
 *  pictures: [{ src, caption, className? }] shown under the text */
function askPrompt(title, text, buttons, { result = false, pictures = [] } = {}) {
  const box = document.getElementById("prompt");
  if (!box) return Promise.reject(new Error("prompt UI 없음"));
  box.classList.toggle("result", !!result);
  box.classList.remove("waiting");
  document.getElementById("prompt-title").textContent = title;
  const body = document.getElementById("prompt-text");
  body.textContent = text;
  if (pictures.length) {
    const row = el("div", "prompt-pictures");
    row.append(...pictures.map((p) => {
      const fig = el("figure", p.className || "");
      const img = el("img");
      img.src = p.src;
      img.alt = p.caption;
      fig.append(img, el("figcaption", "", p.caption));
      return fig;
    }));
    body.append(row);
  }
  return new Promise((resolve) => {
    const row = el("div", "row");
    const list = buttons.map((b) => {
      const button = el("button", `menu-button${b.primary ? " primary" : ""}`, b.label);
      if (b.card) {
        const info = cards.get(b.card.code);
        if (info) button.addEventListener("mouseenter", () => show(info));
      }
      button.addEventListener("click", () => {
        box.hidden = true;
        box.classList.remove("waiting");
        box.style.display = "";
        box.style.zIndex = "";
        resolve(b.value);
      });
      return button;
    });
    const wide = list.filter((_, i) => buttons[i].wide);
    const small = list.filter((_, i) => !buttons[i].wide);
    row.append(...small);
    document.getElementById("prompt-options").replaceChildren(...wide, row);
    box.hidden = false;
    box.removeAttribute("hidden");
    box.style.display = "flex";
    box.style.visibility = "visible";
    box.style.opacity = "1";
    box.style.zIndex = "9999";
    // 보드 위에 확실히 보이도록 맨 앞으로
    box.parentElement?.appendChild(box);
  });
}

function showWaitingPrompt(title, text) {
  const box = document.getElementById("prompt");
  if (!box) return;
  box.classList.add("waiting");
  box.classList.remove("result");
  document.getElementById("prompt-title").textContent = title;
  document.getElementById("prompt-text").textContent = text;
  document.getElementById("prompt-options").replaceChildren();
  box.hidden = false;
  box.removeAttribute("hidden");
  box.style.display = "flex";
  box.style.zIndex = "40";
}

function hideWaitingPrompt() {
  const box = document.getElementById("prompt");
  if (!box) return;
  if (!box.classList.contains("waiting") && box.hidden) return;
  box.hidden = true;
  box.classList.remove("waiting");
  box.style.display = "";
  box.style.zIndex = "";
}

/** 대기/선택 프롬프트를 강제로 닫아 보드가 가려지지 않게 합니다. */
function clearPromptOverlay() {
  hideOppWaitNotice(true);
  const box = document.getElementById("prompt");
  if (!box) return;
  box.hidden = true;
  box.classList.remove("waiting", "result");
  box.style.display = "";
  box.style.zIndex = "";
  document.getElementById("prompt-options")?.replaceChildren();
}

/** 상대 선택 대기 — 알케미스트 알림과 같은 notices 위치, ... 만 점멸 */
let oppWaitDepth = 0;
let oppWaitDotsTimer = 0;

function showOppWaitNotice() {
  oppWaitDepth++;
  if (oppWaitDepth > 1) return;
  const host = document.getElementById("notices");
  if (!host) return;
  let box = document.getElementById("opp-wait");
  if (!box) {
    box = el("div", "notice panel opp-wait");
    box.id = "opp-wait";
    const body = el("div", "notice-text");
    const line = el("span", "opp-wait-line");
    line.append(document.createTextNode(t("duel.waitOpp")), el("span", "opp-wait-dots", "."));
    body.append(line);
    box.append(body);
    host.prepend(box);
  }
  box.hidden = false;
  box.removeAttribute("hidden");
  const dots = box.querySelector(".opp-wait-dots");
  let n = 1;
  if (dots) dots.textContent = ".";
  clearInterval(oppWaitDotsTimer);
  oppWaitDotsTimer = setInterval(() => {
    n = (n % 3) + 1;
    if (dots) dots.textContent = ".".repeat(n);
  }, 450);
}

function hideOppWaitNotice(force = false) {
  if (force) oppWaitDepth = 0;
  else oppWaitDepth = Math.max(0, oppWaitDepth - 1);
  if (oppWaitDepth > 0) return;
  clearInterval(oppWaitDotsTimer);
  oppWaitDotsTimer = 0;
  const box = document.getElementById("opp-wait");
  if (box) {
    box.hidden = true;
    box.setAttribute("hidden", "");
  }
}

/** the Korean particle after a name: 이/가, 을/를 by whether its last syllable ends in a consonant (a last digit
 *  read as said: 1 일, 3 삼 ... end in one) */
const DIGIT_FINAL = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
function josa(name, withFinal, without) {
  const plain = name.replace(/\(.*?\)\s*$/, "").trim();
  const end = plain[plain.length - 1];
  if (end >= "0" && end <= "9") return name + (DIGIT_FINAL[end] ? withFinal : without);
  const last = [...plain].reverse().find((ch) => ch >= "가" && ch <= "힣");
  return name + (last && (last.charCodeAt(0) - 0xac00) % 28 ? withFinal : without);
}

/** a card's name; a battle creamate's with its place as this player sees it - "이름(왼쪽)" - while another of
 *  that name is in the same battle zone. place: where it was, for a card that has just left */
function placeLabels() {
  return [t("duel.placeLeft"), t("duel.placeMid"), t("duel.placeRight")];
}
function nameOf(card, place = card) {
  if (!card?.code) return t("duel.ruleEffect");
  const i = place.location === duel.C.LOCATION_MZONE ? BATTLE_SEQS.indexOf(place.sequence) : -1;
  if (i < 0) return card.name;
  const p = place.controller;
  const twin = BATTLE_SEQS.some((s) => {
    const c = duel.p[p].mzone[s];
    return c && c !== card && c.name === card.name;
  });
  return twin ? `${card.name}(${placeLabels()[p === me ? i : 2 - i]})` : card.name;
}

/** "A가 B에게 통상 공격했습니다" (one target), "A가 통상 공격했습니다" (every enemy) */
function attackText(attacker, target, all) {
  const name = nameOf(attacker);
  if (all || !target) return t("duel.attackAll", { name });
  return t("duel.attackOne", { name, target: nameOf(target) });
}

/** "A가 B에게 돗테오키 효과를 사용했습니다": a battle creamate's dotte effect, or the effect's own name */
const DOTTE_EFFECT = 10050111 * 0x100000 + 5;
function usedText(card, targets, desc, from) {
  const C = duel.C;
  const what = desc === DOTTE_EFFECT || (from === C.LOCATION_MZONE && !effectText(desc)) ? t("duel.dotteEffect")
    : effectText(desc) || (from === C.LOCATION_GRAVE ? t("duel.dotteZoneEffect") : t("duel.effect"));
  const name = nameOf(card);
  if (targets && targets.length) {
    return t("duel.usedOn", { name, target: targets.map((x) => nameOf(x)).join(", "), what });
  }
  return t("duel.used", { name, what });
}

function chainContext() {
  const C = duel.C;
  const top = duel.chain[duel.chain.length - 1];
  if (!top && duel.windowReason === "battleEnd") return t("duel.battleEndOpp");
  if (!top && duel.phase === C.PHASE_BATTLE_START) {
    return duel.turnPlayer === me ? t("duel.battleStartMe") : t("duel.battleStartOpp");
  }
  if (top) return `${who(top.player)}: ${usedText(top.card, top.targets.map((x) => x.card), top.effect.description, top.location)}.`;
  if (duel.attacker) {
    return `${who(duel.attacker.controller)}: ${attackText(duel.attacker, duel.attackTarget, duel.hitsAll(duel.attacker))}.`;
  }
  return t("duel.phaseNow", { phase: PHASE_NAMES()[duel.phase] || "" });
}

/** what an effect that happens with others (flow.askOrder) does: its description, else the card text of its
 *  timing (the line of "(배틀 페이즈 종료시)", the [자신 배틀 페이즈 개시시] section, an alchemist's dotte zone effect) */
function orderLabel(o) {
  const C = duel.C;
  const text = effectText(o.desc);
  if (text) return text;
  const desc = (cards.get(o.card.code)?.desc || "").replace(/\r/g, "");
  const code = o.effect.code;
  if (o.card.location === C.LOCATION_GRAVE && o.card.data.race & 16) {
    return t("duel.dotteZoneWhen", { text: dotteZoneText(o.card.code) });
  }
  if (code === C.EVENT_PHASE + C.PHASE_BATTLE) {
    const line = desc.split("\n").find((l) =>
      /배틀 페이즈 종료시|バトルフェイズ終了時|Battle Phase End/i.test(l));
    return line ? line.trim() : t("duel.battleEndEffect");
  }
  if (code === C.EVENT_PHASE + C.PHASE_BATTLE_START) {
    if (isSummoner(o.card)) return t("duel.battleStartAtk");   // (Kirafan.battleop)
    const body = desc.split(/\[(?:자신 배틀 페이즈 개시시|自分のバトルフェイズ開始時|Your Battle Phase Start)\]/)[1];
    return body
      ? `${t("duel.battleStartEffect").replace(/효과$|効果$/, "").trim()}: ${body.split(/\n\s*\n|\n\[/)[0].trim().replace(/\n/g, " ")}`
      : t("duel.battleStartEffect");
  }
  const phase = {
    [C.PHASE_DRAW]: PHASES()[0],
    [C.PHASE_STANDBY]: PHASES()[1],
    [C.PHASE_END]: PHASES()[4],
  }[code - C.EVENT_PHASE];
  return phase ? t("duel.phaseEffect", { phase }) : t("duel.effect");
}

/** the order of this player's effects that happen at once: the one to resolve first, then the next... */
function askOrder(d) {
  return askPrompt(t("duel.chainTitle"), t("duel.chainBody"),
    d.options.map((o, i) => ({ label: `${nameOf(o.card)} · ${orderLabel(o)}`, value: i, card: o.card, wide: true })));
}

async function askChain(d) {
  if (d.window === "order") return askOrder(d);
  const pass = d.options.findIndex((o) => o.kind === K.CHAIN_PASS);
  const real = d.options.map((o, i) => ({ o, i })).filter(({ o }) => o.kind === K.CHAIN_ACTIVATE && !o.noop);
  // (a window the other player waits on: asked even with nothing to use, so passing says nothing about the hand)
  const hidden = ["battleStart", "attack", "battleEnd", "respond"].includes(d.window);
  if (!real.length && !hidden) return pass;
  const more = d.window === "continue";   // (a support of this player's has just resolved)
  // the cards that can answer glow where they are (the same menu as the main phase's), with a bar to pass
  if (real.every(({ o }) => inView(o.card))) {
    return new Promise((resolve) => {
      menu = { decision: d, resolve, bar: true, pass };
      const bar = document.getElementById("select-bar");
      document.getElementById("select-title").textContent = more ? t("duel.activateSupport") : chainContext();
      document.getElementById("select-count").textContent = (real.length ? t("duel.tapToActivate") : t("duel.noUsable"))
        + (duel.turnPlayer !== me ? t("duel.rightClickPass") : "");
      document.getElementById("select-count").classList.remove("warn");
      const cancel = document.getElementById("select-cancel");
      cancel.hidden = true;
      cancel.setAttribute("hidden", "");
      const ok = document.getElementById("select-ok");
      ok.disabled = false;
      ok.textContent = more ? t("duel.dontUse") : t("duel.skip");
      ok.onclick = () => answerMenu(pass);
      bar.hidden = false;
      render();
    });
  }
  return askPrompt(more ? t("duel.activateSupport") : t("duel.activateEffect"),
    more ? t("duel.pickSupport") : chainContext(), [
      ...real.map(({ o, i }) => ({ label: `${nameOf(o.card)} · ${optionLabel(o)}`, value: i, card: o.card, wide: true })),
      { label: more ? t("duel.dontUse") : t("duel.skip"), value: pass, primary: true },
    ]);
}

function placeName(c) {
  const C = duel.C;
  const side = c.controller === me ? "" : `${t("game.opp")} `;
  if (c.location === C.LOCATION_HAND) return `${side}${t("game.handPile")}`;
  if (c.location === C.LOCATION_MZONE) return `${side}${t("game.battleZone")}`;
  if (c.location === C.LOCATION_SZONE) return `${side}${t("game.supportZone")}`;
  if (c.location === C.LOCATION_GRAVE) return `${side}${t("game.dotteZone")}`;
  if (c.location === C.LOCATION_OVERLAY) return `${side}${t("game.sanctuary")}`;
  if (c.location === C.LOCATION_REMOVED) return `${side}${t("game.village")}`;
  return side + (getLang() === "en" ? "card" : getLang() === "ja" ? "カード" : "카드");
}

/** Hide/show the shared cancel button; [hidden] alone can still paint with border-image buttons. */
function setPickCancelVisible(cancel, visible) {
  if (!cancel) return;
  cancel.hidden = !visible;
  if (visible) {
    cancel.removeAttribute("hidden");
    cancel.style.removeProperty("display");
  } else {
    cancel.setAttribute("hidden", "");
    cancel.style.setProperty("display", "none", "important");
  }
}

/** picking min..max cards: the sanctuary choices and the attack target say what they are for */
function askCards(d) {
  const ids = d.cards.map((c) => c.code);
  // Opening 4: hint id, or exact 4/4 pick (same SelectMatchingCard as draw 0~1, but min/max differ)
  const opening = d.hint === SANCTUARY_HINT || (d.min === 4 && d.max === 4);
  if (opening) {
    concealOpeningSanctuary = true;
    if (openedPile?.endsWith(":성전")) closePile();
    d = { ...d, cancelable: false };
  }
  const sanctuary = opening || d.hint === SANCTUARY_ONE_HINT;
  const attack = d.hint === ATTACK_HINT;
  const village = d.hint === VILLAGE_HINT;
  const isBattle = (c) => !!cards.get(c.code)?.battle;
  const range = d.min === d.max ? String(d.max) : `${d.min}~${d.max}`;
  const what = attack ? t("duel.pickAttack")
    : village ? t("duel.pickVillage")
      : describe(d.hint) || t("duel.pickCards", { n: range });
  // (for an alchemist's effect from the 돗테오키 존: whose, which, and what it does)
  const link = duel.building || duel.solving;
  const alchemist = link && isAlchemistLink(link)
    ? `${who(link.player)}: ${link.card.name} · ${t("game.dotteZone")} (${dotteZoneText(link.card.code).replace(/\n/g, " ")}) · ` : "";
  const how = {
    title: alchemist + what,
    kind: sanctuary ? "sanctuary" : attack ? "attack" : "pick",
    mark: sanctuary ? t("game.sanctuary") : attack ? t("duel.attack") : t("duel.pick"),
    okLabel: sanctuary ? t("duel.sendSanctuary") : attack ? t("duel.attack") : t("duel.confirm"),
    status: opening ? (picked) => {
      const fighters = d.cards.filter((c, i) => !picked.includes(i) && isBattle(c)).length;
      return { text: t("duel.fightersLeft", { n: fighters }), warn: fighters === 0 };
    } : null,
  };
  if (d.cards.every(inView)) return askOnBoard(d, how);
  return chooseCards({
    ...how,
    note: opening
      ? t("duel.openingNote", { total: ids.length, min: d.min, hand: ids.length - d.min })
      : sanctuary ? t("duel.sanctuaryNote") : "",
    ids, places: d.cards.map(placeName), min: d.min, max: d.max, cancelable: d.cancelable,
  });
}

/** a card the board shows face up to this player: in its hand, or in a battle / support zone */
function inView(c) {
  const C = duel.C;
  if (c.location === C.LOCATION_HAND) return c.controller === me;
  return c.location === C.LOCATION_MZONE || c.location === C.LOCATION_SZONE;
}

/** a card the pick on the board can take: it glows, and a click picks it (or puts it back) */
function offerPick(box, card) {
  if (!picking) return false;
  const i = picking.decision.cards.indexOf(card);
  if (i < 0) return false;
  box.classList.add("selectable");
  box.dataset.mark = picking.mark;
  box.classList.toggle("picked", picking.picked.includes(i));
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    const { picked, decision: d } = picking;
    const at = picked.indexOf(i);
    if (at >= 0) picked.splice(at, 1);
    else if (d.max === 1) picked.splice(0, picked.length, i);
    else if (picked.length < d.max) picked.push(i);
    else return toast(t("duel.maxPick", { n: d.max }));
    updatePickBar();
    draw(boardState());
  });
  return true;
}

function rightClickPickHint(kind) {
  return kind === "attack" ? t("duel.rightClickAttack") : t("duel.rightClickPut");
}

function updatePickBar() {
  const { picked, decision: d, status, okLabel, noneLabel, kind } = picking;
  const { text, warn } = status ? status(picked) : {};
  const line = document.getElementById("select-count");
  const range = d.min === d.max ? String(d.max) : `${d.min}~${d.max}`;
  const ok = document.getElementById("select-ok");
  ok.disabled = picked.length < d.min || picked.length > d.max;
  ok.textContent = picked.length === 0 && d.min === 0 ? noneLabel : okLabel;
  const hint = picked.length > 0 && !ok.disabled ? rightClickPickHint(kind) : "";
  line.textContent = t("duel.pickCount", { cur: picked.length, range })
    + (text ? ` · ${text}` : "")
    + hint;
  line.classList.toggle("warn", !!warn);
}

/** min..max of the decision's cards picked on the board and in the hand, where they are (null: cancelled).
 *  noneLabel: the button while nothing is picked (when that is allowed) */
function askOnBoard(d, { title, mark, kind, okLabel, status, noneLabel }) {
  const emptyLabel = noneLabel
    || (kind === "sanctuary" || mark === t("game.sanctuary") ? t("duel.dontPut") : t("duel.dontSelect"));
  picking = { decision: d, picked: [], mark, kind, okLabel, status, noneLabel: emptyLabel };
  document.getElementById("select-title").textContent = title;
  const bar = document.getElementById("select-bar");
  const ok = document.getElementById("select-ok");
  const cancel = document.getElementById("select-cancel");
  cancel.textContent = t("game.cancel");
  setPickCancelVisible(cancel, !!d.cancelable);
  updatePickBar();
  bar.hidden = false;
  draw(boardState());
  // draw() may refresh chrome — keep cancel suppressed for required picks
  setPickCancelVisible(cancel, !!d.cancelable);
  return new Promise((resolve) => {
    const done = (value) => {
      picking = null;
      bar.hidden = true;
      ok.onclick = cancel.onclick = null;
      setPickCancelVisible(cancel, false);
      draw(boardState());
      resolve(value);
    };
    ok.onclick = () => {
      if (picking.picked.length < d.min || picking.picked.length > d.max) return;
      done([...picking.picked]);
    };
    cancel.onclick = () => { if (d.cancelable) done(null); };
  });
}

/** Right-click shortcut: confirm 성전/돗테오키 (etc.) only when at least one card is picked. */
function tryConfirmPickByRightClick(e) {
  if (picking) {
    const ok = document.getElementById("select-ok");
    if (picking.picked.length > 0 && ok && !ok.disabled) {
      e.preventDefault();
      ok.click();
      return true;
    }
    return false;
  }
  if (chooseSession) {
    const ok = document.getElementById("choose-ok");
    if (chooseSession.picked.length > 0 && ok && !ok.disabled) {
      e.preventDefault();
      ok.click();
      return true;
    }
    return false;
  }
  return false;
}

/** asks for min..max of `ids`; resolves with the picked indices (null: cancelled).
 *  status(picked indices) writes the line beside the button: { text, warn } */
function chooseCards({ title, note, ids, places, min, max, cancelable, mark, kind, okLabel, status }) {
  const box = document.getElementById("choose");
  const ok = document.getElementById("choose-ok");
  const cancel = document.getElementById("choose-cancel");
  const line = document.getElementById("choose-count");
  const picked = [];
  const emptyLabel = kind === "sanctuary" || mark === t("game.sanctuary") ? t("duel.dontPut") : t("duel.dontSelect");
  document.getElementById("choose-title").textContent = title;
  document.getElementById("choose-note").textContent = note;
  // Re-apply cancel label (applyI18n ran at boot; keep it current)
  cancel.textContent = t("game.cancel");
  const update = () => {
    const { text, warn } = status ? status(picked) : {};
    const range = min === max ? String(max) : `${min}~${max}`;
    ok.disabled = picked.length < min || picked.length > max;
    ok.textContent = picked.length === 0 && min === 0 ? emptyLabel : okLabel;
    const hint = picked.length > 0 && !ok.disabled ? rightClickPickHint(kind) : "";
    line.textContent = t("duel.pickCount", { cur: picked.length, range })
      + (text ? ` · ${text}` : "")
      + hint;
    line.classList.toggle("warn", !!warn);
  };
  document.getElementById("choose-cards").replaceChildren(...ids.map((id, i) => {
    const button = el("button", "choose-card");
    button.dataset.mark = mark;
    button.append(face(id));
    if (places) button.append(el("span", "choose-place", places[i]));
    button.addEventListener("click", () => {
      const at = picked.indexOf(i);
      if (at >= 0) picked.splice(at, 1);
      else if (max === 1) picked.splice(0, picked.length, i);
      else if (picked.length < max) picked.push(i);
      else return toast(t("duel.maxPick", { n: max }));
      [...document.getElementById("choose-cards").children].forEach((b, k) => b.classList.toggle("on", picked.includes(k)));
      update();
    });
    return button;
  }));
  update();
  setPickCancelVisible(cancel, !!cancelable);
  box.hidden = false;
  return new Promise((resolve) => {
    const done = (value) => {
      chooseSession = null;
      box.hidden = true;
      ok.onclick = cancel.onclick = null;
      setPickCancelVisible(cancel, false);
      resolve(value);
    };
    chooseSession = { picked, confirm: () => {
      if (picked.length < min || picked.length > max) return;
      done([...picked]);
    } };
    ok.onclick = () => {
      if (picked.length < min || picked.length > max) return;
      done([...picked]);
    };
    cancel.onclick = () => { if (cancelable) done(null); };
  });
}

/* The standby phase (Kirafan.Dotteop): "send a card of your hand or battle zone to the 돗테오키 존?", then which.
 * Asked at once on the board: no card picked answers no; a card picked answers yes, and then that card. */
const STANDBY_DOTTE = 10050111 * 0x100000 + 0;
let standbyPick = null;

async function askStandbyDotte() {
  const z = duel.p[me];
  const choices = [...z.hand, ...z.mzone.slice(0, 5).filter(Boolean)];
  const picked = await askOnBoard({ cards: choices, min: 0, max: 1, cancelable: false }, {
    title: t("duel.standbyDotte"),
    kind: "dotte",
    mark: t("game.dotteTitle"),
    okLabel: t("duel.toDotte"),
    noneLabel: t("duel.dontSend"),
  });
  standbyPick = picked && picked.length ? choices[picked[0]] : null;
  return standbyPick ? 0 : 1;
}

async function askYesNo(d) {
  const text = d.type === "effectyn"
    ? (getLang() === "en"
      ? `Activate the effect of ${nameOf(d.card)}?\n${effectText(d.desc)}`
      : getLang() === "ja"
        ? `${nameOf(d.card)}の効果を発動しますか？\n${effectText(d.desc)}`
        : `${nameOf(d.card)}의 효과를 발동할까요?\n${effectText(d.desc)}`)
    : describe(d.desc) || (getLang() === "en" ? "Proceed?" : getLang() === "ja" ? "実行しますか？" : "할까요?");
  return askPrompt(t("duel.confirm"), text, [{ label: t("duel.yes"), value: 0, primary: true }, { label: t("duel.no"), value: 1 }]);
}

async function askNumber(d) {
  return askPrompt(t("duel.pickNumber"), describe(duel.hints[me]) || "", d.numbers.map((n, i) => ({ label: String(n), value: i })));
}

const human = {
  human: true,
  ask(_, d) {
    render();
    if (d.type === "cards") {
      // (the card already picked for the standby phase's question: askStandbyDotte)
      const i = standbyPick ? d.cards.indexOf(standbyPick) : -1;
      standbyPick = null;
      if (i >= 0) return Promise.resolve([i]);
      return askCards(d);
    }
    if (d.type === "yesno" && d.desc === STANDBY_DOTTE) return askStandbyDotte();
    if (d.type === "idle" || d.type === "battle") return askMenu(d);
    if (d.type === "chain") return askChain(d);
    if (d.type === "yesno" || d.type === "effectyn") return askYesNo(d);
    if (d.type === "number") return askNumber(d);
    return Promise.resolve(0);
  },
};

function setupPhaseButtons() {
  const pick = (kinds) => {
    if (!menu) return;
    const i = menu.decision.options.findIndex((o) => kinds.includes(o.kind));
    if (i >= 0) answerMenu(i);
  };
  // (one button: to the battle phase from the main phase, the end of the turn from the battle phase)
  document.getElementById("phase-button").addEventListener("click", (e) => {
    if (!e.currentTarget.disabled) pick([K.TO_BP, K.BATTLE_TO_EP]);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#card-menu")) closeMenu();
  });
  // 성전/돗테오키 등으로 카드 선택 중이면 우클릭 = 확인(선택이 있을 때만). 없으면 카운터 패스.
  const onBoardContextMenu = (e) => {
    if (tryConfirmPickByRightClick(e)) return;
    if (!menu || !menu.bar || duel.turnPlayer === me) return;
    e.preventDefault();
    answerMenu(menu.pass);
  };
  document.getElementById("board").addEventListener("contextmenu", onBoardContextMenu);
  document.getElementById("choose")?.addEventListener("contextmenu", (e) => {
    tryConfirmPickByRightClick(e);
  });
}

// ---- the duel ---------------------------------------------------------------------
/** 로비 match 페이로드에서 이 닉네임의 대전 정보를 만듭니다. */
function matchFromRoom(remoteMatch, nick, roomId) {
  if (!remoteMatch?.players || !nick) return null;
  const mine = remoteMatch.players[nick];
  const oppKey = remoteMatch.host === nick ? remoteMatch.opp : remoteMatch.host;
  const theirs = remoteMatch.players[oppKey];
  if (!mine || !theirs) return null;
  return {
    pvp: remoteMatch.pvp === true || (!remoteMatch.vsAi && !!remoteMatch.host && !!remoteMatch.opp),
    roomId: remoteMatch.roomId || roomId,
    matchId: remoteMatch.matchId || "",
    host: remoteMatch.host,
    opp: remoteMatch.opp,
    localNick: nick,
    players: remoteMatch.players,
    level: remoteMatch.level || 4,
    bot: remoteMatch.bot || "",
    me: mine,
    ai: theirs,
  };
}

/** the match the AI match screen saved; two AI recipes when there is none */
async function loadMatch() {
  if (AUTO) {   // (two of the AI decks at random, an AI level at random; &level=N: that level and its decks)
    const { bots, decks } = await loadAiDecks(cards);
    const fixed = AUTO_LEVEL >= 1 && AUTO_LEVEL <= 4 ? AUTO_LEVEL : 0;
    const all = [...decks.values()];
    const list = fixed && all.some((d) => d.level === fixed) ? all.filter((d) => d.level === fixed) : all;
    const pick = () => list[Math.floor(Math.random() * list.length)];
    const level = fixed || 1 + Math.floor(Math.random() * 4);
    return { level, bot: bots[level] || "", ai: pick(), me: pick() };
  }

  const params = new URLSearchParams(location.search);
  const nick = (params.get("nick") || currentNick()).trim();
  const roomId = params.get("room") || "";

  // URL/서버에서 PvP 매치 복구 (게스트 창이 sessionStorage 를 못 읽을 때)
  if (params.get("pvp") === "1" && nick) {
    try {
      const rooms = await fetchRooms();
      let room = roomId ? rooms.find((r) => String(r.id) === String(roomId)) : null;
      // URL room 이 옛 값이거나 비면, 이 닉이 들어 있는 게임중 방으로 복구
      if (!room?.match) {
        room = rooms.find((r) => r.status === "게임중" && r.match?.players?.[nick]) || null;
      }
      const fromServer = matchFromRoom(room?.match, nick, room?.id || roomId);
      if (fromServer) {
        saveMatch(fromServer, nick);
        return fromServer;
      }
    } catch (err) {
      console.warn("room match fetch failed", err);
    }
  }

  const match = loadMatchData(nick) || loadMatchData();
  if (match && match.me && match.ai) {
    if (nick && !match.localNick) match.localNick = nick;
    if (roomId && !match.roomId) match.roomId = roomId;
    if (match.roomId && match.host) match.pvp = true;
    return match;
  }
  const { bots, decks } = await loadAiDecks(cards);
  const [mine, theirs] = [...decks.values()];
  if (!mine) return null;
  toast(t("duel.fallbackExampleDeck"));
  return { level: theirs.level, bot: bots[theirs.level] || "", ai: theirs, me: mine };
}

const WIN_REASONS = {
  deck: "덱과 마을의 카드가 다 떨어졌습니다.",
  turns: "턴 수가 너무 길어 무승부입니다.",
  get surrender() { return t("duel.resignOppWin"); },
};

/** Official end-of-duel lines live on summoner utility card 10050114 (not creamate flavor hints). */
const END_MSG_CODE = 10050114;
const END_MSG_IDX = new Set([0, 1, 2, 3, 4, 5, 7, 8]);

/** Result dialog body: system win/lose hint only — never a random creamate HINT_MESSAGE. */
function endDetailText(duel, seat) {
  if (duel.winReason === "deck") return WIN_REASONS.deck;
  if (duel.winReason === "turns") return WIN_REASONS.turns;
  if (duel.winReason === "surrender") return WIN_REASONS.surrender;

  const decode = (desc) => {
    const n = Number(desc);
    if (!Number.isFinite(n)) return null;
    const code = Math.floor(n / 0x100000);
    const idx = n % 0x100000;
    if (code !== END_MSG_CODE || !END_MSG_IDX.has(idx)) return null;
    return describe(n);
  };

  const hints = [...duel.log].filter((e) => e.type === "hint" && e.desc != null).reverse();
  for (const e of hints) {
    if (e.player !== seat) continue;
    const text = decode(e.desc);
    if (text) return text;
  }
  for (const e of hints) {
    const text = decode(e.desc);
    if (text) return text;
  }
  if (duel.winReason === "lp") return t("duel.endBySanctuary");
  return "";
}

/** a coin toss: heads, this player decides who moves first; tails, the AI does. true when this player moves first */
async function coinToss() {
  const heads = Math.random() < 0.5;
  const face = getLang() === "en" ? (heads ? "Heads" : "Tails")
    : getLang() === "ja" ? (heads ? "表" : "裏")
      : (heads ? "앞면" : "뒷면");
  const pictures = [{
    src: heads ? "assets/coin-front.png" : "assets/coin-back.png",
    caption: face,
    className: "coin",
  }];
  if (heads) {
    log(t("coin.headsLog"));
    return askPrompt(t("coin.headsTitle"), t("coin.headsPick"), [
      { label: t("coin.first"), value: true, primary: true },
      { label: t("coin.second"), value: false },
    ], { pictures });
  }
  const aiFirst = Math.random() < 0.5;
  const order = aiFirst ? t("coin.first") : t("coin.second");
  log(t("coin.tailsLog", { order }));
  await askPrompt(t("coin.tailsTitle"), `${t("coin.tailsWait")}\n${t("coin.tailsResult", { order })}`,
    [{ label: t("duel.confirm"), value: 0, primary: true }], { pictures });
  return !aiFirst;
}

const NOTICE_SHOWN = 3000;   // ms an alchemist notice stays unless 확인 closes it sooner

/** an alchemist's effect as it is sent to the 돗테오키 존 (Kirafan4) */
function isAlchemistLink(link) {
  return link.location === duel.C.LOCATION_GRAVE && (link.card.data.race & 16) !== 0;
}

/** what an alchemist's card says it does as it is sent to the 돗테오키 존 */
function dotteZoneText(code) {
  const block = (cards.get(code)?.desc || "").split("[돗테오키 존으로 보내졌을 때]")[1];
  return block ? block.split(/\n\s*\n|\n\[/)[0].trim() : "";
}

const openNotices = new Map();   // the alchemist (card) -> its notice, until its effect has resolved

/** an alchemist's effect from the 돗테오키 존, shown as it is activated - before any target is chosen: who, which
 *  card, what it does, in a notice of its own (a newer one on top, pushing the older down); the card joins that
 *  player's recent alchemists. The targets join the notice once chosen (noticeEvent), and it goes by itself
 *  NOTICE_SHOWN after the effect has resolved (or at 확인) */
function alchemistNotice(link) {
  if (!isAlchemistLink(link)) return;
  const recent = lastAlchemist[link.player];
  recent.unshift(link.card.code);
  recent.length = Math.min(recent.length, LAST_ALCHEMISTS);
  render();
  const effect = dotteZoneText(link.card.code);
  const box = el("div", "notice panel");
  const img = el("img");
  setPic(img, `pics/small/${link.card.code}.jpg`);
  img.alt = link.card.name;
  const body = el("div", "notice-text");
  const text = el("span", "", effect);
  body.append(el("b", "", t("duel.alchemistActivate", { who: who(link.player), name: link.card.name })), text);
  const ok = el("button", "menu-button small", t("duel.confirm"));
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    box.remove();
    if (openNotices.get(link.card)?.box === box) openNotices.delete(link.card);
  };
  const expire = () => {
    const left = el("i", "notice-time");   // (the time left, shrinking)
    left.style.animationDuration = `${NOTICE_SHOWN}ms`;
    box.append(left);
    timer = setTimeout(close, NOTICE_SHOWN);
  };
  ok.addEventListener("click", close);
  box.append(img, body, ok);
  document.getElementById("notices").prepend(box);
  openNotices.set(link.card, { box, text, effect, expire });
}

/** an open alchemist notice: its targets once chosen, its time running once the effect has resolved */
function noticeEvent(e) {
  if (e.type === "chainEnd") {   // (any left open: their effect did not come to resolve)
    for (const notice of openNotices.values()) notice.expire();
    openNotices.clear();
    return;
  }
  const notice = openNotices.get(e.card);
  if (!notice) return;
  if (e.type === "chaining" && e.targets.length) {
    notice.text.textContent = `${notice.effect}\n${t("duel.targets", { list: e.targets.map((x) => nameOf(x)).join(", ") })}`;
  }
  if (e.type === "solved") {
    openNotices.delete(e.card);
    notice.expire();
  }
}

const ENTER_HOLD = 1200;   // ms a summoner's entrance lasts at least (without its voice too)

/** before the duel: the first player's summoner comes out and says its line, then the second player's */
async function summonersEnter() {
  if (QUICK_START || AUTO) {
    revealed[0] = revealed[1] = true;
    for (const p of [0, 1]) {
      const name = cards.get(duel.decks[p].summoner)?.name || t("log.summoner");
      log(t("log.appear", { who: who(p), name }));
    }
    return;
  }
  for (const p of [0, 1]) {
    revealed[p] = true;
    entering = p;
    draw(boardState());
    entering = null;
    const code = duel.decks[p].summoner;
    const name = cards.get(code)?.name || t("log.summoner");
    log(t("log.appear", { who: who(p), name }));
    await Promise.all([voice("summon", code), new Promise((r) => setTimeout(r, ENTER_HOLD))]);
  }
}

/** the learning AI of the match's level (js/ai); the stand-in AI if it cannot be loaded */
async function opponent(match, delay = AI_DELAY) {
  const level = [1, 2, 3, 4].includes(Number(match.level)) ? Number(match.level) : 4;
  try {
    window.kirafanAILog = [];   // (its decisions, for looking into a game from the console)
    return await modelPlayer({ level, delay, log: ({ turn, option, prob, value, note }) => window.kirafanAILog.push({
      turn, kind: option.kind, card: option.card && option.card[0], desc: option.desc, prob: +prob.toFixed(3),
      winChance: Math.round(50 * (value + 1)), note }) });
  } catch (err) {
    console.error(err);
    toast(t("duel.tempAi"));
    return simplePlayer(Math.random, { delay: AI_DELAY });
  }
}

function recordedPlayer(player) {
  const wrapped = Object.create(player);
  wrapped.ask = (...args) => {
    flushSanctuary();
    recordFrame();
    return player.ask(...args);
  };
  return wrapped;
}

async function clearMatchRoom(match, { keepDuel = false } = {}) {
  const roomId = match?.roomId;
  if (!roomId) return;
  sessionStorage.removeItem("kirafan.room.id");
  try {
    await deleteRoom(roomId);
  } catch {
    /* ignore */
  }
  if (keepDuel) return;
  try {
    await fetch(`${API_BASE}/duels/${encodeURIComponent(roomId)}`, { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

async function finishMatch(match, { pvp = false } = {}) {
  menu = null;
  hideOppWaitNotice(true);
  render();
  const winner = duel.winner;
  if (winner === me || winner === 1 - me) playBgm(winner === me ? "win" : "lose");
  const surrenderedWin = pvp && duel.winReason === "surrender" && winner === me;
  const title = winner === me ? t("duel.win") : winner === 1 - me ? t("duel.resultLoss") : (getLang() === "en" ? "Draw" : getLang() === "ja" ? "引き分け" : "무승부");
  const text = surrenderedWin ? WIN_REASONS.surrender : endDetailText(duel, me);
  surrendering = null;
  log(`${title}${text ? ` - ${text.replace(/\n/g, " ")}` : ""}`);
  await clearMatchRoom(match);
  const fromRoom = !!match?.roomId;
  const id = await keepReplay(match, title.replace("!", "").replace("！", ""));
  const left = Number(new URLSearchParams(location.search).get("auto")) || 0;
  if (AUTO && left > 0) {
    if (duel.turn <= 2 && id) await deleteReplay(id);
    const next = duel.turn <= 2 ? left : left - 1;
    if (next > 0) return void (location.href = `game.html?auto=${next}${AUTO_LEVEL ? `&level=${AUTO_LEVEL}` : ""}`);
  }
  const lobby = fromRoom || pvp;
  const rematch = getLang() === "en" ? "Rematch" : getLang() === "ja" ? "再戦" : "다시 하기";
  const roomList = getLang() === "en" ? "Room list" : getLang() === "ja" ? "部屋一覧へ" : "방 목록으로";
  const next = await askPrompt(title, text, [
    { label: lobby ? t("nav.server") : t("nav.ai"), value: lobby ? "server.html" : "ai.html" },
    ...(id ? [{ label: t("replay.view"), value: `game.html?replay=${id}` }] : []),
    ...(lobby
      ? [{ label: roomList, value: "server.html", primary: true }]
      : [{ label: rematch, value: "game.html", primary: true }]),
  ], { result: true });
  location.href = next;
}

/** 서버 방 정보로 방장 여부를 확정합니다. */
async function resolvePvpHost(match, nick) {
  let hostName = match.host || "";
  try {
    const rooms = await fetchRooms();
    const room = rooms.find((r) => String(r.id) === String(match.roomId));
    if (room?.host) hostName = room.host;
    if (room?.match?.host) hostName = room.match.host;
  } catch {
    /* ignore */
  }
  match.host = hostName;
  return !!nick && nick === hostName;
}

/** 코인 앞면: 내가 선공/후공을 고릅니다. 반환값은 "내가 선공인가". */
async function askLocalGoesFirst() {
  if (QUICK_START) return Math.random() < 0.5;
  const pictures = [{ src: "assets/coin-front.png", caption: t("coin.headsFace"), className: "coin" }];
  log(t("coin.headsLog"));
  toast(t("duel.pickFirst"));
  return askPrompt(t("coin.headsTitle"), t("coin.headsPick"), [
    { label: t("coin.first"), value: true, primary: true },
    { label: t("coin.second"), value: false },
  ], { pictures });
}

/** 서버 방에서 최신 match/roomId/matchId 를 다시 읽어 붙입니다. */
async function refreshPvpMatch(match, nick) {
  try {
    const rooms = await Promise.race([
      fetchRooms(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("rooms timeout")), 5000)),
    ]);
    let room = match.roomId ? rooms.find((r) => String(r.id) === String(match.roomId)) : null;
    if (!room?.match?.players?.[nick]) {
      room = rooms.find((r) => r.status === "게임중" && r.match?.players?.[nick]) || room;
    }
    const fresh = matchFromRoom(room?.match, nick, room?.id || match.roomId);
    if (fresh) {
      Object.assign(match, fresh);
      saveMatch(match, nick);
      if (fresh.roomId && new URLSearchParams(location.search).get("room") !== String(fresh.roomId)) {
        const q = new URLSearchParams(location.search);
        q.set("room", String(fresh.roomId));
        if (nick) q.set("nick", nick);
        q.set("pvp", "1");
        history.replaceState(null, "", `game.html?${q}`);
      }
    }
  } catch {
    /* ignore */
  }
  return match;
}

/** 동전으로 고른 사람이 선/후를 정하면 hostFirst(방장이 선공?)로 바꿉니다. */
function hostFirstFromChooser(match, chooser, chooserGoesFirst) {
  return chooser === match.host ? !!chooserGoesFirst : !chooserGoesFirst;
}

const PVP_LIVE_KEY = "kirafan.pvp.live";
let pvpUnloadResign = null; // { roomId, nick } — 새로고침·탭 닫기 = 항복

function armPvpUnloadResign(roomId, nick) {
  pvpUnloadResign = { roomId: String(roomId), nick: nick || "" };
  try { sessionStorage.setItem(PVP_LIVE_KEY, String(roomId)); } catch { /* ignore */ }
}

function disarmPvpUnloadResign() {
  pvpUnloadResign = null;
  try { sessionStorage.removeItem(PVP_LIVE_KEY); } catch { /* ignore */ }
}

function isPvpLiveReload(roomId) {
  try { return sessionStorage.getItem(PVP_LIVE_KEY) === String(roomId); } catch { return false; }
}

// 새로고침·탭 닫기 → 항복 전송. 상대 watch 가 감지하면 resignGate 로 대기 ask 중단
window.addEventListener("pagehide", (e) => {
  if (e.persisted || !pvpUnloadResign) return;
  beaconPvpResign(pvpUnloadResign.roomId, pvpUnloadResign.nick);
});

/** 진행 중/이미 항복·새로고침이면 로비로. true면 호출측은 return. */
async function leaveIfPvpAlreadyGone(match, roomId, localNick) {
  let existing = null;
  try {
    existing = await fetchPvpDuel(roomId);
  } catch {
    existing = null;
  }
  const resigned = !!(existing?.phase === "resigned" || existing?.resignedBy);
  const resignedBy = resigned ? String(existing.resignedBy || "") : null;
  const hasAnswers = !!(existing?.answers && typeof existing.answers === "object"
    && Object.keys(existing.answers).length > 0);
  const refreshed = isPvpLiveReload(roomId);

  if (!resigned && !hasAnswers && !refreshed) return false;

  if (!resigned) {
    try {
      await postPvpResign(roomId, localNick);
    } catch (err) {
      console.warn("resign on reload failed", err);
    }
  }
  disarmPvpUnloadResign();
  const mine = !resigned || resignedBy === localNick || resignedBy === "";
  toast(mine ? t("duel.resignToastSelf") : t("duel.resignToastOpp"));
  await clearMatchRoom(match, { keepDuel: true });
  location.href = "server.html";
  return true;
}

async function playPvpMatch(match) {
  concealOpeningSanctuary = false;
  pendingSanctuaryLogs = [];
  // URL nick 을 최우선 (같은 브라우저 두 창이 localStorage 닉을 공유해도 섞이지 않게)
  const urlNick = (new URLSearchParams(location.search).get("nick") || "").trim();
  const localNick = (urlNick || match.localNick || currentNick() || "").trim();
  match.localNick = localNick;
  let isHost = !!(localNick && match.host && localNick === match.host);
  log(`플레이어 대전 준비: ${match.host || "?"} vs ${match.opp || "?"} · 나=${localNick || "?"} · ${isHost ? "방장" : "게스트"} · room=${match.roomId || "?"}`);

  let hostFirst;
  let seed;
  try {
    await refreshPvpMatch(match, localNick);
    isHost = await resolvePvpHost(match, localNick);
    const roomId = match.roomId;
    if (!roomId) throw new Error("roomId 없음");
    // 새로고침·재입장: clearPvpDuel 하기 전에 항복/진행중 여부 확인
    if (await leaveIfPvpAlreadyGone(match, roomId, localNick)) return;
    armPvpUnloadResign(roomId, localNick);
    if (isHost && !match.matchId) {
      match.matchId = `${roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    // 1) 방장만 동전(누가 고를지)을 올려 공유. 실제 선후공은 랜덤 당첨자가 정함.
    let coin = null;
    if (isHost) {
      const chooser = Math.random() < 0.5 ? match.host : match.opp;
      seed = (Math.random() * 0xffffffff) >>> 0 || 1;
      if (!match.matchId) match.matchId = `${roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await clearPvpDuel(roomId);
      coin = await postPvpCoin(roomId, {
        seed,
        chooser,
        host: match.host,
        opp: match.opp,
        matchId: match.matchId,
      });
      log(`동전: ${chooser} 님이 선후공을 정합니다`);
    } else {
      // 이미 선후공까지 끝난 뒤 들어온 게스트는 coin 단계를 건너뜀
      showWaitingPrompt("대기 중", "동전을 던지는 중입니다.\n창을 닫지 마세요.");
      try {
        let existing = null;
        try {
          const res = await fetch(`${API_BASE}/duels/${encodeURIComponent(roomId)}`, { cache: "no-store" });
          if (res.ok) existing = await res.json();
        } catch {
          /* ignore */
        }
        if (existing?.ok && existing.seed != null && typeof existing.hostFirst === "boolean" && existing.chooser) {
          coin = existing;
          log("이미 올라온 동전/선후공 정보를 사용합니다");
        } else {
          coin = await waitPvpCoin(roomId, { timeoutMs: 180000 });
        }
      } finally {
        hideWaitingPrompt();
        clearPromptOverlay();
      }
      seed = coin.seed;
      if (coin.matchId) match.matchId = coin.matchId;
      log(`동전: ${coin.chooser} 님이 선후공을 정합니다`);
    }

    const chooser = String(coin.chooser || "");
    const iChoose = chooser === localNick;

    // 2) 앞면 당첨자만 선후공 선택, 나머지는 대기
    if (typeof coin.hostFirst === "boolean" && coin.phase === "ready" && !iChoose) {
      hostFirst = !!coin.hostFirst;
      log("상대의 선후공 설정을 받았습니다");
    } else if (iChoose && typeof coin.hostFirst === "boolean" && coin.phase === "ready") {
      // 내가 고르는 차례였는데 이미 확정됨(재입장) → 그대로 사용
      hostFirst = !!coin.hostFirst;
      log("저장된 선후공 설정을 사용합니다");
    } else if (iChoose) {
      const iGoFirst = await askLocalGoesFirst();
      hostFirst = hostFirstFromChooser(match, chooser, iGoFirst);
      await initPvpDuel(roomId, {
        seed,
        hostFirst,
        host: match.host,
        opp: match.opp,
        matchId: match.matchId,
        chooser,
      });
      log(`선후공 결정 · 내가 ${iGoFirst ? "선공" : "후공"}`);
    } else {
      showWaitingPrompt("대기 중", "상대가 선후공을 정하는 중입니다.\n창을 닫지 마세요.");
      try {
        const init = await waitPvpInit(roomId, { timeoutMs: 180000 });
        seed = init.seed;
        hostFirst = !!init.hostFirst;
        if (init.matchId) match.matchId = init.matchId;
        log("상대의 선후공 설정을 받았습니다");
      } finally {
        hideWaitingPrompt();
        clearPromptOverlay();
      }
    }
  } catch (err) {
    disarmPvpUnloadResign();
    hideWaitingPrompt();
    clearPromptOverlay();
    console.error(err);
    await askPrompt("오류", `대전 시작에 실패했습니다.\n${err?.message || err}`, [
      { label: "방 목록으로", value: "server.html", primary: true },
    ]);
    location.href = "server.html";
    return;
  }

  clearPromptOverlay();
  const roomId = match.roomId;
  if (!roomId) throw new Error("roomId 없음");

  // 엔진 좌석: 선공이 player 0. 방장 닉 기준
  const hostIsPlayer0 = hostFirst;
  const localIsPlayer0 = localNick === match.host ? hostIsPlayer0 : !hostIsPlayer0;
  me = localIsPlayer0 ? 0 : 1;
  isHost = localNick === match.host;

  let stopResignWatch = null;
  let oppResigned = false;
  const resignGate = createResignGate();
  try {
    armPvpUnloadResign(roomId, localNick);

    const isCancelled = () => oppResigned || resignGate.isCancelled()
      || !!(duel && duel.over && duel.winReason === "surrender");
    const { players } = lockstepPlayers(roomId, human, { human: true, ask: async () => 0 }, localIsPlayer0, {
      onRemoteWait: () => showOppWaitNotice(),
      onRemoteDone: () => hideOppWaitNotice(),
      isCancelled,
      resignGate,
    });
    duel = await newDuel({ players: players.map(recordedPlayer), rng: seededRng(seed) });
    window.kirafanDuel = duel;

    const hostDeck = match.players?.[match.host] || (isHost ? match.me : match.ai);
    const oppDeck = match.players?.[match.opp] || (isHost ? match.ai : match.me);
    if (!hostDeck?.main || !oppDeck?.main) throw new Error("덱 정보가 없습니다");
    const deck0 = hostIsPlayer0 ? hostDeck : oppDeck;
    const deck1 = hostIsPlayer0 ? oppDeck : hostDeck;
    duel.decks = [
      { main: deck0.main, summoner: deck0.summoner },
      { main: deck1.main, summoner: deck1.summoner },
    ];
    const name0 = hostIsPlayer0 ? match.host : match.opp;
    const name1 = hostIsPlayer0 ? match.opp : match.host;
    names = [
      me === 0 ? t("game.meDeck", { name: deck0.name }) : name0,
      me === 1 ? t("game.meDeck", { name: deck1.name }) : name1,
    ];
    if (me === 0) names[1] = t("game.oppDeck", { name: deck1.name });
    else names[0] = t("game.oppDeck", { name: deck0.name });

    duel.listeners.push((e) => {
      if (!isSanctuaryPut(e)) flushSanctuary();
      logEntry(e);
      soundOf(e);
      const actor = actorOf(e);
      if (actor) recorder.actor = actor;
      attackEvent(e);
      if (recorder.lines.length || recorder.cues.length) recordFrame();
      noticeEvent(e);
      render();
    });
    surrendering = async () => {
      log(t("duel.resignSelf"));
      try {
        await postPvpResign(roomId, localNick);
      } catch (err) {
        console.warn("resign post failed", err);
        beaconPvpResign(roomId, localNick);
      }
      disarmPvpUnloadResign();
      return keepReplay(match, t("game.replayResignAsLoss"));
    };
    let leaveAfterOppResign = null;
    const endByOppResign = (by) => {
      if (by && by === localNick) return; // 내가 올린 항복
      if (oppResigned) return;
      oppResigned = true;
      clearPromptOverlay();
      menu = null;
      const exitBtn = document.getElementById("surrender");
      if (exitBtn) {
        exitBtn.disabled = true;
        exitBtn.setAttribute("aria-disabled", "true");
      }
      log("상대가 항복하여 게임에서 승리하였습니다.");
      if (duel && !duel.over) duel.lose(1 - me, "surrender");
      resignGate.trip(by || "");
      playBgm("win");
      // 엔진 종료를 기다리지 않고 바로 알림창 — 나가기 → 방 목록
      leaveAfterOppResign = (async () => {
        disarmPvpUnloadResign();
        try { await keepReplay(match, t("duel.resultWin")); } catch { /* ignore */ }
        try { await clearMatchRoom(match, { keepDuel: true }); } catch { /* ignore */ }
        await askPrompt(t("duel.win"), WIN_REASONS.surrender, [
          { label: t("duel.exit"), value: "server.html", primary: true },
        ], { result: true });
        location.href = "server.html";
      })();
    };
    stopResignWatch = watchPvpResign(roomId, endByOppResign);
    duel.onActivate = alchemistNotice;
    playBgm("duel");
    log(`플레이어 대전: ${match.host} vs ${match.opp}`);
    log(`선공: ${hostIsPlayer0 ? match.host : match.opp}`);
    toast(isHost ? t("duel.syncGuest") : t("duel.syncHost"));
    await summonersEnter();
    try {
      await duel.play(duel.decks);
    } catch (err) {
      if (!(err instanceof OppResignedError)) throw err;
      if (!duel.over) duel.lose(1 - me, "surrender");
    }
    disarmPvpUnloadResign();
    if (leaveAfterOppResign) {
      await leaveAfterOppResign;
      return;
    }
    await finishMatch(match, { pvp: true });
  } catch (err) {
    disarmPvpUnloadResign();
    console.error(err);
    toast(t("duel.error", { msg: err?.message || err }));
    await clearMatchRoom(match);
    await askPrompt(t("common.error"), t("duel.aborted", { msg: err?.message || err }), [
      { label: t("duel.toRoomList"), value: "server.html", primary: true },
    ]);
    location.href = "server.html";
  } finally {
    stopResignWatch?.();
    hideOppWaitNotice(true);
  }
}

const AI_PROGRESS_KEY = "kirafan.ai.progress";

function aiProgressId(match) {
  return `${match.me?.name || ""}|${match.ai?.name || ""}|${match.level}|${match.bot || ""}`;
}

function loadAiProgress(match) {
  try {
    const data = JSON.parse(sessionStorage.getItem(AI_PROGRESS_KEY) || "null");
    if (!data || data.id !== aiProgressId(match)) return null;
    if (data.seed == null || data.me == null || !Array.isArray(data.answers)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveAiProgress(store) {
  try {
    sessionStorage.setItem(AI_PROGRESS_KEY, JSON.stringify({
      id: aiProgressId(store.match),
      seed: store.seed,
      me: store.me,
      answers: store.answers,
    }));
  } catch { /* ignore */ }
}

function clearAiProgress() {
  try { sessionStorage.removeItem(AI_PROGRESS_KEY); } catch { /* ignore */ }
}

/** 저장된 수순을 먼저 재생한 뒤, 새 선택만 플레이어/AI 에게 묻습니다. */
function wrapAnswerLog(player, store) {
  return {
    human: !!player.human,
    async ask(duel, decision) {
      const i = store.step++;
      if (i < store.answers.length) return store.answers[i];
      if (store.resuming) {
        store.resuming = false;
        toast(t("log.resumeDone"));
        render();
      }
      const answer = await player.ask(duel, decision);
      store.answers.push(answer);
      saveAiProgress(store);
      return answer;
    },
  };
}

async function playMatch(match) {
  if (match?.pvp && match.roomId) {
    return playPvpMatch(match);
  }
  concealOpeningSanctuary = false;
  pendingSanctuaryLogs = [];
  const saved = AUTO ? null : loadAiProgress(match);
  let seed;
  if (saved) {
    seed = saved.seed;
    me = saved.me;
  } else {
    seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    const first = (QUICK_START || AUTO) ? Math.random() < 0.5 : await coinToss();
    me = first ? 0 : 1;
  }
  const store = {
    match,
    seed,
    me,
    answers: saved ? [...saved.answers] : [],
    step: 0,
    resuming: !!saved,
  };
  saveAiProgress(store);
  const ai = await opponent(match, AUTO ? 0 : AI_DELAY);
  const seat = AUTO ? await opponent(match, 0) : human;
  const players = (me === 0 ? [seat, ai] : [ai, seat])
    .map((p) => wrapAnswerLog(p, store))
    .map(recordedPlayer);
  duel = await newDuel({ players, rng: seededRng(seed) });
  window.kirafanDuel = duel;
  const mine = { main: match.me.main, summoner: match.me.summoner };
  const theirs = { main: match.ai.main, summoner: match.ai.summoner };
  duel.decks = me === 0 ? [mine, theirs] : [theirs, mine];
  const aiName = aiSideLabel(match);
  const myLabel = localizeSideName(match.me.name);
  names = me === 0
    ? [t("game.meDeck", { name: myLabel }), aiName]
    : [aiName, t("game.meDeck", { name: myLabel })];
  duel.listeners.push((e) => {
    if (!isSanctuaryPut(e)) flushSanctuary();
    logEntry(e);
    if (!store.resuming) soundOf(e);
    const actor = actorOf(e);
    if (actor) recorder.actor = actor;
    attackEvent(e);
    if (recorder.lines.length || recorder.cues.length) recordFrame();
    noticeEvent(e);
    if (!store.resuming) render();
  });
  surrendering = () => {
    log(t("duel.resignSelf"));
    clearAiProgress();
    return keepReplay(match, t("game.replayResignAsLoss"));
  };
  duel.onActivate = alchemistNotice;
  playBgm("duel");
  const myDeckName = localizeSideName(match.me.name);
  log(t("log.matchStart", { me: t("game.me"), myDeck: myDeckName, opp: aiName }));
  log(t("log.firstPlayer", { who: me === 0 ? t("game.me") : t("game.opp") }));
  if (saved) {
    toast(t("log.resuming"));
    log(t("log.resume"));
    revealed[0] = revealed[1] = true;
  } else {
    await summonersEnter();
  }
  await duel.play(duel.decks);
  clearAiProgress();
  await finishMatch(match, { pvp: false });
}

let surrendering = null;   // (during a game: keeps it for the replay list before the page is left)

// ---- a puzzle (game.html?puzzle=<id>: data/puzzles.json, EDOPro's tutorials and puzzles) -------------------------
const CLEARED_STORE = "kirafan.puzzles.cleared";

function clearedPuzzles() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLEARED_STORE)) || []);
  } catch {
    return new Set();
  }
}

/** a line of the puzzle's story (Debug.ShowHint): "★클레어\n..." is 클레어 speaking. A click anywhere (or Enter /
 *  the space bar) goes on; that click does nothing else */
function showHint(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const speaker = lines[0].startsWith("★") ? lines.shift().slice(1).trim() : "";
  log(`${speaker ? `${speaker}: ` : ""}${lines.join(" ")}`);
  const box = document.getElementById("story");
  document.getElementById("story-name").textContent = speaker || t("puzzle.guide");
  document.getElementById("story-text").textContent = lines.join("\n");
  box.hidden = false;
  return new Promise((resolve) => {
    const done = (e) => {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      if (e.type === "click" && e.target.closest("#surrender")) return;   // (포기하고 나가기 works as usual)
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener("click", done, true);
      document.removeEventListener("keydown", done, true);
      box.hidden = true;
      resolve(0);
    };
    // (from the next task on: not the click that made this line come)
    setTimeout(() => {
      document.addEventListener("click", done, true);
      document.addEventListener("keydown", done, true);
    }, 0);
  });
}

async function playPuzzle(id) {
  const list = await loadJson(puzzlesDataUrl());
  const puzzle = list.find((p) => p.id === Number(id));
  if (!puzzle) return toast(t("puzzle.missing"));
  document.getElementById("surrender").textContent = t("duel.surrenderPuzzle");
  document.getElementById("surrender").addEventListener("click", () => {
    if (confirm(t("puzzle.quitConfirm"))) location.href = "puzzle.html";
  });
  me = 0;
  revealed[0] = revealed[1] = true;
  // --@aiLevel N in puzzle lua (e.g. 속박=4) → learning AI; else SIMPLE_AI
  const aiLevel = Number(puzzle.aiLevel) || 0;
  const opp = aiLevel >= 1 && aiLevel <= 4
    ? await modelPlayer({ level: aiLevel, delay: AI_DELAY })
    : puzzlePlayer({ delay: AI_DELAY });
  duel = await newDuel({ players: [human, opp] });
  window.kirafanDuel = duel;
  duel.decks = [{ summoner: 0 }, { summoner: 0 }];
  names = [t("puzzle.me"), aiLevel ? t("game.aiLabel", { level: t("ai.levelN", { n: aiLevel }), bot: "" }) : t("puzzle.opp")];
  duel.listeners.push((e) => {
    logEntry(e);
    noticeEvent(e);
    soundOf(e);
    attackEvent(e);
    render();
  });
  duel.onActivate = alchemistNotice;
  duel.onHint = showHint;
  playBgm("duel");
  log(`${puzzle.category} ${puzzle.number} ${puzzle.title}`);
  render();
  const winner = await duel.playPuzzle(puzzle.source);
  menu = null;
  render();
  const solved = winner === me;
  if (solved) localStorage.setItem(CLEARED_STORE, JSON.stringify([...clearedPuzzles().add(puzzle.id)]));
  playBgm(solved ? "win" : "lose");
  const next = list.find((p) => p.id === puzzle.id + 1);
  const go = await askPrompt(
    solved ? t("puzzle.success") : t("puzzle.fail"),
    solved ? t("puzzle.solved", { title: puzzle.title }) : t("puzzle.retryHint"),
    [
      { label: t("puzzle.toList"), value: "puzzle.html" },
      { label: t("puzzle.retry"), value: `game.html?puzzle=${puzzle.id}`, primary: !solved || !next },
      ...(solved && next ? [{ label: t("puzzle.next"), value: `game.html?puzzle=${next.id}`, primary: true }] : []),
    ],
    { result: true },
  );
  location.href = go;
}

// ---- a saved game shown again (game.html?replay=<id>) -----------------------------------
const STEP_MS = 500;                       // an action at 1x
const SPEED_MIN = 0.25;   // the speed bar: 0.25x to 3x by 0.25 (game.html #replay-speed)
const SPEED_MAX = 3;

async function viewReplay(id) {
  replaying = true;
  document.body.classList.add("replaying");
  document.body.classList.remove("replay-hidden");
  const hideBtn = document.getElementById("replay-hide");
  const showBtn = document.getElementById("replay-show");
  const setReplayPanelVisible = (visible) => {
    document.body.classList.toggle("replay-hidden", !visible);
    if (showBtn) showBtn.hidden = visible;
  };
  hideBtn?.addEventListener("click", () => setReplayPanelVisible(false));
  showBtn?.addEventListener("click", () => setReplayPanelVisible(true));
  setReplayPanelVisible(true);
  const exit = document.getElementById("surrender");
  exit.textContent = t("duel.exit");
  const progressKey = `kirafan.replay.at:${id}`;
  exit.addEventListener("click", () => {
    try { sessionStorage.removeItem(progressKey); } catch { /* ignore */ }
    location.href = "replay.html";
  });
  const replay = await getReplay(id).catch(() => null);
  if (!replay) return toast(t("replay.missing"));
  const { states, lines } = unpack(replay);
  const all = lines.flat();
  const upTo = [];   // the log's lines shown at each frame
  lines.reduce((n, l, i) => (upTo[i] = n + l.length), 0);
  const list = document.getElementById("duel-log");
  const slider = document.getElementById("replay-seek");
  const where = document.getElementById("replay-where");
  slider.max = String(states.length - 1);
  let at = -1;
  let direction = 0;   // 1 playing, -1 playing backwards, 0 stopped
  let speed = 1;
  let timer = 0;
  const loadProgress = () => {
    try {
      const raw = sessionStorage.getItem(progressKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.at !== "number") return null;
      return data;
    } catch {
      return null;
    }
  };
  const saveProgress = () => {
    try {
      sessionStorage.setItem(progressKey, JSON.stringify({ at, speed, direction: 0 }));
    } catch { /* ignore */ }
  };

  // (going on to a frame, played or one step: its voices; the end of the game: its music. Back or a jump: silent)
  const endingRaw = String(replay.result || "").replace("!", "");
  const ending = ({ 승리: "win", 패배: "lose", Victory: "win", Defeat: "lose", 勝利: "win", 敗北: "lose" })[endingRaw];
  // (the card that acted last by each frame, shown in 카드 정보: a replay of before it was kept, the last one heard)
  const actors = [];
  const kept = replay.frames.some((f) => f.a);
  const heard = (f) => (!kept && f.v && f.v.length ? f.v[f.v.length - 1][1] : 0);
  replay.frames.reduce((last, f, k) => (actors[k] = f.a || heard(f) || last), 0);
  const thrusts = replay.frames.some((f) => f.t);
  let shownActor = 0;
  const showFrame = (i, { sound = false } = {}) => {
    at = Math.max(0, Math.min(states.length - 1, i));
    const actor = actors[at];
    if (actor && actor !== shownActor && cards.get(actor)) show(cards.get(actor));
    shownActor = actor;
    if (sound) for (const [kind, code] of replay.frames[at].v || []) playCue(kind, code);
    // (an attack's motion as the replay comes to it - kept before the thrust was: thrust the frame after -;
    // back or a jump: none)
    const { k: aim, t: thrust } = replay.frames[at];
    if (!sound) clearAttackFx();
    else {
      if (thrust || !thrusts) thrustFx(speed);
      if (aim) requestAnimationFrame(() => attackFx(aim, { speed }));
    }
    if (at < states.length - 1) playBgm("duel");
    else if (sound && ending) playBgm(ending);
    draw(shownState(states[at]), { fx: sound, speed, ahead: states[at + 1] || null });
    const want = upTo[at];
    while (list.childElementCount > want) list.lastElementChild.remove();
    while (list.childElementCount < want) list.append(el("li", "", all[list.childElementCount]));
    list.scrollTop = list.scrollHeight;
    slider.value = String(at);
    where.textContent = t("game.replayWhere", { at: at + 1, total: states.length, turn: states[at].turn });
    saveProgress();
  };
  const buttons = {
    play: document.getElementById("replay-play"),
    back: document.getElementById("replay-reverse"),
    pause: document.getElementById("replay-pause"),
  };
  const mark = () => {
    buttons.play.classList.toggle("on", direction === 1);
    buttons.back.classList.toggle("on", direction === -1);
    buttons.pause.classList.toggle("on", direction === 0);
  };
  const stop = () => {
    clearTimeout(timer);
    direction = 0;
    mark();
  };
  /** Wait at least STEP_MS, and until board motions (flights / attacks / fx) finish. */
  const stepDelay = () => Math.max(STEP_MS / Math.max(0.01, speed), motionWaitMs());
  const tick = () => {
    const next = at + direction;
    if (next < 0 || next >= states.length) return stop();
    showFrame(next, { sound: direction === 1 });
    timer = setTimeout(tick, stepDelay());
  };
  const run = (dir) => {
    clearTimeout(timer);
    // (played from an end it cannot go on from: from the other end)
    if (dir === 1 && at >= states.length - 1) showFrame(0);
    if (dir === -1 && at <= 0) showFrame(states.length - 1);
    direction = dir;
    mark();
    timer = setTimeout(tick, stepDelay());
  };
  const seek = (i, sound = false) => {
    stop();
    showFrame(i, { sound });
  };

  buttons.play.addEventListener("click", () => run(1));
  buttons.back.addEventListener("click", () => run(-1));
  buttons.pause.addEventListener("click", stop);
  document.getElementById("replay-first").addEventListener("click", () => seek(0));
  document.getElementById("replay-last").addEventListener("click", () => seek(states.length - 1));
  document.getElementById("replay-prev").addEventListener("click", () => seek(at - 1));
  document.getElementById("replay-next").addEventListener("click", () => seek(at + 1, true));
  // (moved while playing - either way -: it goes on playing that way once let go, unless at the end it plays to)
  let resume = 0;
  slider.addEventListener("input", () => {
    if (direction) resume = direction;
    seek(Number(slider.value));
  });
  slider.addEventListener("change", () => {
    const dir = resume;
    resume = 0;
    if (dir === 1 ? at < states.length - 1 : dir === -1 && at > 0) run(dir);
  });
  const speedBar = document.getElementById("replay-speed");
  const speedValue = document.getElementById("replay-speed-value");
  const showSpeed = () => (speedValue.textContent = `${speed.toFixed(2)}x`);
  speedBar.value = String(speed);
  showSpeed();
  speedBar.addEventListener("input", () => {
    speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(speedBar.value) || 1));
    showSpeed();
    if (direction) run(direction);
  });
  // (space: play / stop, the arrows: one action back / on - not while the speed bar has them)
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input:not([type=range]), textarea, #replay-speed")) return;
    if (e.key === " ") {
      e.preventDefault();
      if (direction) stop();
      else run(1);
    } else if (e.key === "ArrowLeft") seek(at - 1);
    else if (e.key === "ArrowRight") seek(at + 1, true);
  });

  const date = new Date(replay.date);
  let outcome = String(replay.result || "").replace("!", "");
  if (outcome === "항복" || outcome === "降参" || outcome === "Surrender") outcome = t("game.replayResignAsLoss");
  else if (outcome === "승리" || outcome === "Victory" || outcome === "勝利") outcome = t("duel.resultWin");
  else if (outcome === "패배" || outcome === "Defeat" || outcome === "敗北") outcome = t("duel.resultLoss");
  const locale = getLang() === "ja" ? "ja-JP" : getLang() === "en" ? "en-US" : "ko-KR";
  document.getElementById("replay-title").textContent = t("game.replayTitle", {
    date: date.toLocaleString(locale),
    result: outcome,
    turns: t("game.replayTurns", { n: replay.turns }),
  });

  // 새로고침: 보던 위치(없으면 마지막=최신 상황)로. 처음 열 때만 처음부터 자동 재생
  const saved = loadProgress();
  if (saved) {
    if (typeof saved.speed === "number" && saved.speed > 0) {
      speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, saved.speed));
      speedBar.value = String(speed);
      showSpeed();
    }
    const resumeAt = Math.max(0, Math.min(states.length - 1, saved.at | 0));
    showFrame(resumeAt, { sound: false });
    mark();
  } else {
    showFrame(0, { sound: true });
    run(1);   // (it plays from the start as it opens)
  }
}

// ---- the left column ------------------------------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll(".tabs .tab");
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-page").forEach((page) => (page.hidden = page.dataset.page !== tab.dataset.tab));
  }));
}

function setupChat() {
  const input = document.getElementById("chat-input");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const list = document.getElementById("duel-log");
    list.append(el("li", "chat-line", `나: ${input.value.trim()}`));
    list.scrollTop = list.scrollHeight;
    input.value = "";
  });
}

/** the settings' sliders: the creamates' voices and the background music */
function setupVolume() {
  for (const kind of ["voice", "bgm"]) {
    const slider = document.getElementById(`volume-${kind}`);
    const label = document.getElementById(`volume-${kind}-value`);
    const show = () => (label.textContent = `${slider.value}%`);
    slider.value = Math.round(volume(kind) * 100);
    show();
    slider.addEventListener("input", () => {
      setVolume(kind, slider.value / 100);
      show();
    });
  }
}

/** settings tab: language select (reload so card/UI packs match) */
function setupLang() {
  const sel = document.getElementById("settings-lang");
  if (!sel) return;
  sel.value = getLang();
  sel.addEventListener("change", () => {
    const prev = getLang();
    const next = setLang(sel.value);
    if (next !== prev) {
      toast(next === "en" ? t("toast.langEn") : next === "ja" ? t("toast.langJa") : t("toast.langKo"));
      setTimeout(() => location.reload(), 450);
    } else {
      toast(t("toast.langSaved"));
    }
  });
}

const isSummoner = (card) => card.isType(duel.C.TYPE_EXTRA);   // (an Xyz monster in EDOPro)

/** HP-chip batch fallback (paths that skip AnnounceHpHits). Prefer hpDamageWave. */
const hpSoundBatch = new Map();   // creamate → { code, lethal }
const defeatFromHp = new WeakSet();
/** Creamates already voiced by AnnounceHpHits — suppress later hpDamage/destroyed. */
const hpSoundCovered = new WeakSet();
let hpSoundFlush = 0;
let hpSoundSay = null;
/** Fallback debounce when hits are not pre-announced as a wave. */
const HP_SOUND_DEBOUNCE_MS = 400;

function pickHpVoice(entries) {
  // entries: [{ code, lethal }, ...] — defeat preferred, then random one
  if (!entries.length) return null;
  const lethal = entries.filter((e) => e.lethal);
  const pool = lethal.length ? lethal : entries;
  return pool[Math.floor(Math.random() * pool.length)];
}

function flushHpSounds(say) {
  hpSoundFlush = 0;
  // Standby Dotteeop: overlays leave when a creamate is sent to 돗테오키 — not damage/fall
  if (duel?.phase === duel.C.PHASE_STANDBY) {
    hpSoundBatch.clear();
    return;
  }
  const entries = [...hpSoundBatch.entries()];
  hpSoundBatch.clear();
  if (!entries.length) return;
  for (const [creamate, info] of entries) {
    if (info.lethal) defeatFromHp.add(creamate);
  }
  const pick = pickHpVoice(entries.map(([, info]) => info));
  if (pick) (say || hpSoundSay)?.(pick.lethal ? "defeat" : "damage", pick.code);
}

function scheduleHpSoundFlush(say) {
  hpSoundSay = say;
  if (hpSoundFlush) clearTimeout(hpSoundFlush);
  hpSoundFlush = setTimeout(() => flushHpSounds(hpSoundSay), HP_SOUND_DEBOUNCE_MS);
}

function flushHpSoundsNow() {
  if (!hpSoundBatch.size && !hpSoundFlush) return;
  if (hpSoundFlush) {
    clearTimeout(hpSoundFlush);
    hpSoundFlush = 0;
  }
  flushHpSounds(hpSoundSay);
}

/** Before HP Remove: one damage or defeat (defeat preferred) for the whole wave. */
function playHpDamageWave(e, say) {
  if (duel?.phase === duel.C.PHASE_STANDBY) return;
  const hits = (e.hits || []).filter((h) => h?.card && !isSummoner(h.card));
  if (!hits.length) return;
  for (const h of hits) {
    hpSoundCovered.add(h.card);
    if (h.lethal) defeatFromHp.add(h.card);
  }
  // Drop any in-flight fallback batch for these creamates
  for (const h of hits) hpSoundBatch.delete(h.card);
  const pick = pickHpVoice(hits.map((h) => ({ code: h.card.code, lethal: !!h.lethal })));
  if (pick) say(pick.lethal ? "defeat" : "damage", pick.code);
}

/** Shared totteoki labels: "돗테오키 효과를 발동한다" / "돗테오키 효과" / "두번째 돗테오키 효과". */
const DOTTE_VOICE_DESCS = new Set([
  DOTTE_EFFECT,
  10050113 * 0x100000 + 4,
  10050113 * 0x100000 + 5,
]);

/** 돗테오키 게이지 사용·「돗테오키 효과」로 표기된 효과 → sound/totteoki/.
 *  (카드 문구에 '돗테오키 게이지'만 있는 스킬은 여기 넣지 않음 — activate/recovery 사용) */
function isTotteokiActivate(e) {
  if (DOTTE_VOICE_DESCS.has(e.desc)) return true;
  const text = effectText(e.desc) || "";
  // Exact totteoki-effect label only — not "돗테오키 게이지+1" flavor on normal skills
  if (/돗테오키\s*효과|とっておき効果|(?:^|[^가-힣])totteoki(?:\s*effect)?$/i.test(text.trim())) return true;
  const C = duel.C;
  // Battle creamate field totteoki often has a blank description id
  return !!(cards.get(e.card.code)?.battle && e.card.location === C.LOCATION_MZONE && !text);
}

/** 알케미스트 돗테오키 존(묘지) 발동 → sound/Alchemist/ (게이지 돗테오키는 위에서 totteoki). */
function isAlchemistActivate(e) {
  const C = duel.C;
  if (e.card.location !== C.LOCATION_GRAVE) return false;
  const info = cards.get(e.card.code);
  if (info?.class === "알케미스트") return true;
  return !!(e.card.data?.race & 16);
}

/** 승려 회복 스킬 → sound/recovery/ (돗테오키 게이지 효과는 totteoki가 우선). */
function isRecoveryActivate(e) {
  if (cards.get(e.card.code)?.class !== "승려") return false;
  // 나츠 메구미 등: 문구가 「리커버리/リカバリー」인 부여 스킬도 회복으로 본다
  return /회복|回復|heal|recover|리커버리|リカバリー/i.test(effectText(e.desc));
}

function activateVoiceKind(e) {
  if (isTotteokiActivate(e)) return "totteoki";
  if (isAlchemistActivate(e)) return "alchemist";
  if (isRecoveryActivate(e)) return "recovery";
  return "activate";
}

/** Voices / SFX: summon (소환·앨리스 변신), attack, totteoki/, Alchemist/ (알케미스트 존),
 *  recovery/, activate/ (스킬), HP damage / fall (destroy/). 패시브(상시)는 발동 이벤트 없음.
 *  Lethal → defeat only. */
function soundOf(e) {
  const say = (kind, code = 0) => {
    playCue(kind, code);
    recorder.cues.push([kind, code]);   // (said again as the replay comes to it)
  };
  if (e.type === "summon") {
    if (!isSummoner(e.card)) say("summon", e.card.code);
  }
  // 앨리스 카터릿 ↔ 다크니스: 변신 후 카드 코드로 summon/ (파일 없으면 무음)
  else if (e.type === "transform") say("summon", e.to ?? e.card.code);
  else if (e.type === "attack") say("attack", e.attacker.code);
  else if (e.type === "activate" && !NOOP_DESCS.has(e.desc)) {
    // Summoner sounds only: summon/ (등장) + summoner/ (진실의 손의 시간). Nothing else.
    if (isSummoner(e.card)) {
      if (!e.continuous) say("summoner", e.card.code); // RealistTime (also PHASE_BATTLE)
      return;
    }
    // 배틀 페이즈 종료시 (drawtrigger / guagetrigger / card text "(배틀 페이즈 종료시)" …): silent
    const C = duel.C;
    if (e.code === C.EVENT_PHASE + C.PHASE_BATTLE) return;
    say(activateVoiceKind(e), e.card.code);
  }
  // Pre-Remove wave from Duel.AnnounceHpHits (Kirafan6.damageeff): one voice, defeat preferred
  else if (e.type === "hpDamageWave") {
    playHpDamageWave(e, say);
  }
  else if (e.type === "hpDamage") {
    // Standby Dotteeop / rule chip dump: never voice defeat/damage voices
    if (duel.phase === duel.C.PHASE_STANDBY) return;
    if (hpSoundCovered.has(e.card)) return;
    const cur = hpSoundBatch.get(e.card) || { code: e.card.code, lethal: false };
    if (e.lethal) cur.lethal = true;
    cur.code = e.card.code;
    hpSoundBatch.set(e.card, cur);
    scheduleHpSoundFlush(say);
  }
  // Fall fallback when not pre-announced (AnnounceHpHits covers normal damageeff paths)
  else if (e.type === "destroyed" && !isSummoner(e.card)) {
    // Standby: send battle creamate to 돗테오키 존 (pendulum may pass EXTRA) — not a real fall
    if (duel.phase === duel.C.PHASE_STANDBY) return;
    if (hpSoundCovered.has(e.card) || defeatFromHp.has(e.card)) return;
    const cur = hpSoundBatch.get(e.card) || { code: e.card.code, lethal: false };
    cur.lethal = true;
    cur.code = e.card.code;
    hpSoundBatch.set(e.card, cur);
    scheduleHpSoundFlush(say);
  }
  else if (e.type === "chainEnd") {
    flushHpSoundsNow();
  }
}

async function start() {
  ({ cards } = await loadCards());
  setupTextSize(); // 카드 정보 · 기록 · 대화 share --card-text-size
  setupTabs();
  setupChat();
  setupVolume();
  setupLang();
  await loadSounds();
  setupPhaseButtons();
  document.getElementById("pile-list-close").addEventListener("click", closePile);
  const params = new URLSearchParams(location.search);
  if (params.has("replay")) return viewReplay(params.get("replay"));
  if (params.has("puzzle")) return playPuzzle(params.get("puzzle"));
  const match = await loadMatch();
  if (!match) return toast(t("duel.noMatchDeck"));
  document.getElementById("surrender").addEventListener("click", async () => {
    const btn = document.getElementById("surrender");
    if (btn?.disabled) return;
    const toLobby = !!match.roomId || !!match.pvp;
    if (!confirm(toLobby ? t("duel.resignConfirmLobby") : t("duel.resignConfirmAi"))) return;
    if (surrendering) await surrendering();
    // PvP: 듀얼 파일에 항복을 남긴 뒤 방만 지움 — 상대가 승리 알림을 받도록
    await clearMatchRoom(match, { keepDuel: toLobby });
    location.href = toLobby ? "server.html" : "ai.html";
  });
  const first = cards.get(match.me.summoner);
  if (first) show(first);
  try {
    await playMatch(match);
  } catch (err) {
    console.error(err);
    toast(t("duel.startFailMsg", { msg: err?.message || err }));
    await askPrompt(t("common.error"), t("duel.startFailBody", { msg: err?.message || err }), [
      { label: t("common.confirm"), value: 0, primary: true },
    ]);
    location.href = match.roomId || match.pvp ? "server.html" : "ai.html";
  }
}

applyI18n();
start();
