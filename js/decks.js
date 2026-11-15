// Cards, the player's saved decks and the AI recipes, shared by the deck editor and the AI match screen.
import { cardsDataUrl, seriesLabel } from "./lang.js";
import { attrLabel, classLabel, t } from "./ui-i18n.js?v=i18n9";

export const STORE = "kirafan.decks";       // { current: name, decks: { name: { summoner, main } } }
export const OLD_STORE = "kirafan.deck";     // (the single deck of the first version)
export const FIRST_DECK = "내 덱";
export const CLASS_ORDER = ["전사", "마법사", "나이트", "승려", "알케미스트", "소환사"];
// filter / list icons (assets/icons)
export const ATTRIBUTE_ICONS = { 땅: "earth", 물: "water", 불: "fire", 바람: "wind", 해: "sun", 달: "moon" };
export const CLASS_ICONS = { 전사: "fighter", 마법사: "magician", 나이트: "knight", 승려: "priest", 알케미스트: "alchemist" };
export const LEVELS = [1, 2, 3];

/** -> { rules: { maxCopies, mainSize }, cards: Map id -> card } (data/cards.json or data/en/) */
export async function loadCards() {
  const data = await (await fetch(cardsDataUrl())).json();
  return { rules: { maxCopies: data.maxCopies, mainSize: data.mainSize }, cards: new Map(data.cards.map((c) => [c.id, c])) };
}

/** -> { bots: level -> the level bot's name, decks: Map name -> recipe { name, level, summoner, main } },
 *  each recipe's cards in deck order; empty when no AI recipes were built (data/ai_decks.json) */
export async function loadAiDecks(cards) {
  try {
    const ai = await (await fetch("data/ai_decks.json")).json();
    return {
      bots: ai.bots || {},
      decks: new Map((ai.decks || []).map((d) => {
        const recipe = { ...cleanDeck(cards, d), name: d.name, level: d.level };
        recipe.main.sort((a, b) => deckOrder(cards.get(a), cards.get(b)));
        return [d.name, recipe];
      })),
    };
  } catch {
    return { bots: {}, decks: new Map() };
  }
}

/** a saved deck with the cards this version does not know dropped; main is hand-sorted */
export function cleanDeck(cards, saved) {
  const main = ((saved && saved.main) || []).filter((id) => cards.has(id));
  main.sort((a, b) => handOrder(cards.get(a), cards.get(b)));
  return {
    summoner: saved && cards.has(saved.summoner) ? saved.summoner : null,
    main,
  };
}

export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** the player's saved decks as stored (read only): { current, decks: { name: deck } } */
export function readLibrary(cards) {
  const saved = readJson(STORE);
  const decks = {};
  if (saved && saved.decks) {
    for (const [name, d] of Object.entries(saved.decks)) decks[name] = cleanDeck(cards, d);
  } else if (readJson(OLD_STORE)) {
    decks[FIRST_DECK] = cleanDeck(cards, readJson(OLD_STORE));
  }
  return { current: saved && decks[saved.current] ? saved.current : Object.keys(decks)[0] || null, decks };
}

export function classRank(card) {
  const i = CLASS_ORDER.indexOf(card?.class);
  return i < 0 ? CLASS_ORDER.length : i;
}

/** 패·마을·덱 공통: 클래스(전사→…→알케미스트) → 레벨 3→2→1 → 속성(불 물 땅 바람 해 달) → 카드 번호 */
export const HAND_ATTRIBUTE_ORDER = { 불: 0, 물: 1, 땅: 2, 바람: 3, 해: 4, 달: 5 };

export function handOrder(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return classRank(a) - classRank(b)
    || (b.level || 0) - (a.level || 0)
    || (HAND_ATTRIBUTE_ORDER[a.attribute] ?? 9) - (HAND_ATTRIBUTE_ORDER[b.attribute] ?? 9)
    || (a.id || 0) - (b.id || 0);
}

/** @deprecated use handOrder — kept as alias for AI/덱 정렬 */
export function deckOrder(a, b) {
  return handOrder(a, b);
}

/** 카드 번호 배열을 패 정렬 방식으로 정렬한 새 배열 */
export function sortCodesLikeHand(codes, cardMap) {
  return [...codes].sort((idA, idB) => handOrder(cardMap.get(idA), cardMap.get(idB)));
}

/** what keeps a deck from being played: [] when it can */
export function deckProblems(deck, rules) {
  const problems = [];
  if (deck.summoner === null) problems.push(t("deck.noSummoner"));
  if (deck.main.length !== rules.mainSize) problems.push(t("deck.wrongSize", { n: rules.mainSize }));
  return problems;
}

/** "( Fighter: 21  Mage: 12 ... )" — class keys stay Korean; labels follow UI language */
export function classCounts(cards, deck) {
  const main = deck.main.map((id) => cards.get(id));
  return `( ${Object.keys(CLASS_ICONS).map((c) => `${classLabel(c)}: ${main.filter((card) => card.class === c).length}`).join("  ")} )`;
}

/** Summoner name without the "(소환사 카드)" / language suffix. */
export function summonerShortName(card) {
  if (!card?.name) return "";
  return card.name
    .replace(/\(소환사 카드\)$/u, "")
    .replace(/\(Main Character\)$/u, "")
    .replace(/\(召喚士カード\)$/u, "")
    .trim();
}

/** "물+바람" / "불" style tags from AI deck names → UI language. */
export function localizeAttrTag(tag) {
  if (!tag) return "";
  return tag.split("+").map((part) => attrLabel(part.trim())).join("+");
}

/**
 * Localized AI recipe title.
 * short: "13 アルシーヴ · 水+風"  /  full: "AI Lv.4 · 13 アルシーヴ · 水+風"
 * Recipe `name` stays the Korean key used in Map / storage.
 */
export function aiRecipeLabel(recipe, cards, { short = false } = {}) {
  if (!recipe) return "";
  const stripped = String(recipe.name || "")
    .replace(/^AI \d+(?:단계)?\s*[·.]\s*/u, "")
    .replace(/^AI Lv\.\d+\s*[·.]\s*/iu, "");
  const m = stripped.match(/^(\d+)\s+([^·]+?)(?:\s*·\s*(.+))?$/u);
  const num = (m?.[1] || "").trim();
  const summoner = summonerShortName(cards?.get?.(recipe.summoner)) || (m?.[2] || "").trim();
  const attrs = localizeAttrTag((m?.[3] || "").trim());
  const body = [num && summoner ? `${num} ${summoner}` : (summoner || num || stripped), attrs]
    .filter(Boolean)
    .join(" · ");
  if (short) return body;
  return `AI ${t("ai.levelN", { n: recipe.level })} · ${body}`;
}

const TEXT_SIZE_STORE = "kirafan.cardTextSize";   // the card info's text size, the same on every screen
const TEXT_SIZES = { min: 11, max: 24, start: 13 };

/** 가- / 가+ buttons (#<prefix>-smaller, #<prefix>-bigger, #<prefix>-size-value) sizing the text of #target
 *  (by default the card info box, the same size on every screen) */
export function setupTextSize({ target = "card-info", prefix = "text", store = TEXT_SIZE_STORE, variable = "--card-text-size" } = {}) {
  const set = (size) => {
    const px = Math.min(TEXT_SIZES.max, Math.max(TEXT_SIZES.min, size));
    document.getElementById(target).style.setProperty(variable, `${px}px`);
    document.getElementById(`${prefix}-size-value`).textContent = px;
    document.getElementById(`${prefix}-smaller`).disabled = px <= TEXT_SIZES.min;
    document.getElementById(`${prefix}-bigger`).disabled = px >= TEXT_SIZES.max;
    localStorage.setItem(store, px);
    return px;
  };
  let size = set(Number(localStorage.getItem(store)) || TEXT_SIZES.start);
  document.getElementById(`${prefix}-smaller`).addEventListener("click", () => (size = set(size - 1)));
  document.getElementById(`${prefix}-bigger`).addEventListener("click", () => (size = set(size + 1)));
  // (another screen open in another tab changes it too)
  window.addEventListener("storage", (e) => {
    if (e.key === store && e.newValue) size = set(Number(e.newValue));
  });
}

/** the card's name, its series and stats, then its text, into the card info box */
export function writeCardInfo(info, card) {
  const stats = card.kind === "summoner" ? "" : `[★${card.level}] ${card.atk}/${card.hp}\n`;
  info.innerHTML = "";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = card.name;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = (card.series ? `${seriesLabel()}${card.series}\n` : "") + stats;
  info.append(name, meta, document.createTextNode(card.desc));
}
