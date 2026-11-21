/** Card/duel/UI language.
 *  Tab language lives in sessionStorage so each window/player keeps its own lang
 *  (host changing Japanese must not flip a spectator tab on the same PC).
 *  localStorage is only the default for brand-new tabs. */

export const LANG_STORE = "kirafan.lang";
const LANG_TAB = "kirafan.lang.tab";

function normalizeLang(v) {
  if (v === "en" || v === "ja") return v;
  return "ko";
}

export function getLang() {
  try {
    let tab = sessionStorage.getItem(LANG_TAB);
    if (tab !== "en" && tab !== "ja" && tab !== "ko") {
      // First use in this tab: seed from local default, then lock to this tab
      tab = normalizeLang(localStorage.getItem(LANG_STORE) || "ko");
      sessionStorage.setItem(LANG_TAB, tab);
    }
    return normalizeLang(tab);
  } catch {
    return "ko";
  }
}

export function setLang(lang) {
  const v = normalizeLang(lang);
  try {
    sessionStorage.setItem(LANG_TAB, v);
  } catch { /* ignore */ }
  try {
    // Default for newly opened tabs only — existing tabs keep LANG_TAB
    localStorage.setItem(LANG_STORE, v);
  } catch { /* ignore */ }
  return v;
}

function packUrl(file) {
  const lang = getLang();
  if (lang === "en") return `data/en/${file}`;
  if (lang === "ja") return `data/ja/${file}`;
  return `data/${file}`;
}

/** data/cards.json or data/(en|ja)/cards.json */
export function cardsDataUrl() {
  return packUrl("cards.json");
}

/** data/engine.json or data/(en|ja)/engine.json */
export function engineDataUrl() {
  return packUrl("engine.json");
}

/** data/puzzles.json or data/(en|ja)/puzzles.json */
export function puzzlesDataUrl() {
  return packUrl("puzzles.json");
}

export function seriesLabel() {
  const lang = getLang();
  if (lang === "en") return "Series: ";
  if (lang === "ja") return "作品名: ";
  return "작품명: ";
}
