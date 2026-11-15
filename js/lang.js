/** Card/duel/UI language (settings → localStorage). */

export const LANG_STORE = "kirafan.lang";

export function getLang() {
  try {
    const v = localStorage.getItem(LANG_STORE) || "ko";
    if (v === "en" || v === "ja") return v;
    return "ko";
  } catch {
    return "ko";
  }
}

export function setLang(lang) {
  const v = lang === "en" ? "en" : lang === "ja" ? "ja" : "ko";
  localStorage.setItem(LANG_STORE, v);
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
