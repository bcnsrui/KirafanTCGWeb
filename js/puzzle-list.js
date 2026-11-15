import { toast } from "./ui.js";
import { loadSounds, playBgm } from "./sound.js";
import { puzzlesDataUrl } from "./lang.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n4";

const CLEARED_STORE = "kirafan.puzzles.cleared";   // (game.js keeps the ids of the puzzles solved here)

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function cleared() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLEARED_STORE)) || []);
  } catch {
    return new Set();
  }
}

async function showList() {
  let puzzles;
  try {
    puzzles = await (await fetch(puzzlesDataUrl())).json();
  } catch {
    return toast(t("puzzle.loadFail"));
  }
  const done = cleared();
  document.getElementById("puzzle-count").textContent = t("puzzle.clearedCount", {
    cleared: puzzles.filter((p) => done.has(p.id)).length,
    total: puzzles.length,
  });
  const groups = new Map();
  for (const p of puzzles) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  }
  // CSS kinds: tutorial / normal / hard (KO or EN category from data)
  const KINDS = {
    튜토리얼: "tutorial", Tutorial: "tutorial", "チュートリアル": "tutorial",
    노말모드: "normal", Normal: "normal", "ノーマル": "normal",
    하드모드: "hard", Hard: "hard", "ハード": "hard",
  };
  document.getElementById("puzzle-groups").replaceChildren(...[...groups].map(([category, list]) => {
    const kind = KINDS[category] || "normal";
    const box = el("section", `puzzle-group ${kind}`);
    const head = el("h2", "puzzle-category");
    head.append(
      el("span", "", category),
      el("small", "", `${list.filter((p) => done.has(p.id)).length} / ${list.length}`),
    );
    box.append(head);
    const column = el("div", "puzzle-list");
    column.append(...list.map((p) => {
      const b = el("button", `puzzle-item${done.has(p.id) ? " cleared" : ""}`);
      b.title = done.has(p.id) ? `${p.title} (${t("puzzle.cleared")})` : p.title;
      b.append(el("span", "puzzle-number", p.number), el("span", "puzzle-title", p.title));
      if (done.has(p.id)) {
        const crown = el("img", "puzzle-crown");
        crown.src = "assets/puzzle/crown.png";
        crown.alt = t("puzzle.cleared");
        b.append(crown);
      }
      b.addEventListener("click", () => (location.href = `game.html?puzzle=${p.id}`));
      return b;
    }));
    box.append(column);
    return box;
  }));
}

applyI18n();
document.getElementById("back").addEventListener("click", () => (location.href = "index.html?v=i18n3"));
showList();
loadSounds().then(() => playBgm("deck"));
