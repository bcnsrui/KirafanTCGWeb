import { toast } from "./ui.js";
import { applyI18n, attrLabel, classLabel, t } from "./ui-i18n.js?v=i18n9";
import {
  ATTRIBUTE_ICONS, CLASS_ICONS, FIRST_DECK, LEVELS, OLD_STORE, STORE, aiRecipeLabel, classCounts, classRank, cleanDeck,
  deckOrder, deckProblems, handOrder, loadAiDecks, loadCards, readJson, setupTextSize, writeCardInfo,
} from "./decks.js";
import { loadSounds, playBgm, voice } from "./sound.js";

let rules = { maxCopies: 3, mainSize: 60 };
let cards = new Map();          // id -> card (data/cards.json)
let library = { current: FIRST_DECK, decks: {} };   // the player's saved decks
let aiDecks = new Map();                   // name -> the level bots' recipe (data/ai_decks.json), never changed
let aiBots = {};                           // level -> the level bot's name
let viewing = null;                        // the AI recipe open instead of library.current, or null
let deck = { summoner: null, main: [] };   // the one being edited, a copy of the open deck until saved
let dirty = false;                         // deck differs from the open deck
// the list shows a card when it has one of the chosen of each row (a row with none chosen lets all through)
const filters = { attribute: new Set(), class: new Set(), level: new Set() };

// ---- the decks kept in the browser -------------------------------------
function clean(saved) {
  return cleanDeck(cards, saved);
}

function loadStored() {
  const saved = readJson(STORE);
  if (saved && saved.decks && Object.keys(saved.decks).length) {
    library = { current: saved.current, decks: {} };
    for (const [name, d] of Object.entries(saved.decks)) library.decks[name] = clean(d);
    dropSeeded(saved.seeded || []);
  } else {
    library = { current: FIRST_DECK, decks: { [FIRST_DECK]: clean(readJson(OLD_STORE)) } };
  }
  if (!library.decks[library.current]) library.current = Object.keys(library.decks)[0];
  deck = copyOf(library.decks[library.current]);
}

/** (an earlier version put the AI recipes among the player's decks: the ones still as handed out go) */
function dropSeeded(seeded) {
  if (!seeded.length) return;
  for (const key of seeded) {
    const name = key.replace(/^\d+:/, "");
    const recipe = aiDecks.get(name);
    if (recipe && same(library.decks[name], recipe)) delete library.decks[name];
  }
  if (!Object.keys(library.decks).length) library.decks[FIRST_DECK] = { summoner: null, main: [] };
  persist();
}

function sortMainInPlace(main) {
  main.sort((a, b) => handOrder(cards.get(a), cards.get(b)));
  return main;
}

function copyOf(d) {
  return { summoner: d.summoner, main: sortMainInPlace([...d.main]) };
}

function same(a, b) {
  return !!a && !!b && a.summoner === b.summoner && a.main.join() === b.main.join();
}

function persist() {
  localStorage.setItem(STORE, JSON.stringify(library));
}

/** the name the deck shows under: the AI recipe's or the player's deck's */
function openName() {
  return viewing || library.current;
}

function edited() {
  sortMainInPlace(deck.main);
  dirty = !same(deck, viewing ? aiDecks.get(viewing) : library.decks[library.current]);
  render();
}

/** into the player's deck, renamed to the typed name when it was changed;
 *  an AI recipe is saved as a deck of the player's under the typed name */
function saveDeck() {
  if (viewing) return saveAs();
  const old = library.current;
  const name = typedName() || old;
  if (name !== old) {
    if (library.decks[name] && !confirm(t("deck.alreadyExists", { name }))) return;
    delete library.decks[old];
    library.current = name;
  }
  library.decks[name] = copyOf(deck);
  dirty = false;
  persist();
  render();
  toast(name === old ? t("deck.saved", { name }) : t("deck.renamed", { old, name }));
}

/** true when there is nothing unsaved, or the player agrees to drop it */
function leaveOk() {
  return !dirty || confirm(t("deck.unsavedConfirm", { name: openName() }));
}

function open(name) {
  library.current = name;
  viewing = null;
  deck = copyOf(library.decks[name]);
  dirty = false;
  persist();
  render();
}

function openAi(name) {
  if (!leaveOk()) return render();
  viewing = name;
  deck = copyOf(aiDecks.get(name));
  dirty = false;
  render();
}

/** name, or name (2), name (3)... when the library already has it */
function freeName(name) {
  let n = 2;
  let out = name;
  while (library.decks[out]) out = `${name} (${n++})`;
  return out;
}

function switchTo(name) {
  if (leaveOk()) open(name);
  else render();
}

function newDeck(name, content = { summoner: null, main: [] }) {
  library.decks[name] = content;
  open(name);
}

function typedName() {
  return document.getElementById("deck-name").value.trim();
}

/** the edited deck saved under the typed name; the deck it came from stays as last saved */
function saveAs() {
  const name = typedName();
  if (!name) return toast(t("deck.needName"));
  if (library.decks[name] && !confirm(t("deck.overwrite", { name }))) return;
  library.decks[name] = copyOf(deck);
  library.current = name;
  viewing = null;
  dirty = false;
  persist();
  render();
  toast(t("deck.savedAs", { name }));
}

function deleteDeck() {
  if (viewing) return toast(t("deck.cannotDeleteAi"));
  if (!confirm(t("deck.deleteConfirm", { name: library.current }))) return;
  delete library.decks[library.current];
  const left = Object.keys(library.decks);
  if (left.length) open(left[0]);
  else newDeck(FIRST_DECK);
}

/** Copies of a card in the main deck, an alias and its key card together. */
function copies(card) {
  return deck.main.filter((id) => cards.get(id).key === card.key).length;
}

function add(card) {
  if (deck.main.length >= rules.mainSize) {
    return toast(t("deck.mainFull", { n: rules.mainSize }));
  } else if (copies(card) >= rules.maxCopies) {
    return toast(t("deck.maxCopies", { n: rules.maxCopies }));
  } else {
    deck.main.push(card.id);
  }
  edited();
}

function remove(card) {
  const i = deck.main.lastIndexOf(card.id);
  if (i >= 0) deck.main.splice(i, 1);
  edited();
}

// ---- .ydk files (EDOPro's deck format) --------------------------------
function toYdk() {
  const lines = ["#created by Kirafan Web", "#main", ...deck.main, "#extra"];
  if (deck.summoner) lines.push(deck.summoner);
  lines.push("!side", "");
  return lines.join("\n");
}

function fromYdk(text) {
  const main = [];
  let summoner = null;
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "#main" || line === "#extra" || line === "!side") {
      section = line;
    } else if (/^\d+$/.test(line)) {
      const card = cards.get(Number(line));
      if (!card) continue;
      if (card.kind === "summoner" && !summoner) summoner = card.id;
      else if (card.kind === "creamate" && section === "#main") main.push(card.id);
    }
  }
  return { summoner, main };
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---- drawing ------------------------------------------------------------
const SORTS = {
  "level-asc": (a, b) => a.level - b.level || classRank(a) - classRank(b) || a.id - b.id,
  "level-desc": (a, b) => b.level - a.level || classRank(a) - classRank(b) || a.id - b.id,
  class: deckOrder,
  name: (a, b) => a.name.localeCompare(b.name, "ko"),
};

function thumb(card, onClick) {
  const img = document.createElement("img");
  img.className = "card";
  img.src = `pics/small/${card.id}.jpg`;
  img.alt = card.name;
  img.title = card.name;
  img.addEventListener("mouseenter", () => show(card));
  img.addEventListener("click", onClick);
  img.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    onClick();
  });
  return img;
}

function show(card) {
  document.getElementById("preview").src = `pics/${card.id}.jpg`;
  writeCardInfo(document.getElementById("card-info"), card);
}

function chooseSummoner(card) {
  if (deck.summoner === card.id) {
    deck.summoner = null;
  } else {
    deck.summoner = card.id;
    voice("summon", card.id);
  }
  edited();
}

function option(value, text = value) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

/** the player's decks; blank while an AI recipe is open */
function renderDeckSelect() {
  const select = document.getElementById("deck-select");
  const names = Object.keys(library.decks).sort((a, b) => a.localeCompare(b, "ko"));
  select.replaceChildren(...names.map((name) => option(name)));
  select.value = viewing ? "" : library.current;
}

/** the AI recipes by level, strongest first; blank while a deck of the player's is open */
function renderAiSelect() {
  const select = document.getElementById("ai-deck-select");
  const levels = [...new Set([...aiDecks.values()].map((d) => d.level))].sort((a, b) => b - a);
  const placeholder = option("", aiDecks.size ? t("deck.aiBrowse") : t("deck.aiNone"));
  placeholder.disabled = true;
  select.replaceChildren(placeholder, ...levels.map((level) => {
    const group = document.createElement("optgroup");
    const botKey = aiBots[level] ? `ai.bot.${aiBots[level]}` : "";
    const bot = botKey ? (t(botKey) === botKey ? aiBots[level] : t(botKey)) : "";
    group.label = `${t("deck.aiLevel", { n: level })}${bot ? ` (${bot})` : ""}`;
    group.append(...[...aiDecks.values()].filter((d) => d.level === level)
      .map((d) => option(d.name, aiRecipeLabel(d, cards))));
    return group;
  }));
  select.value = viewing || "";
}

let shownName = null;   // the deck whose name sits in the name box (a typed name stays while editing)

function render() {
  const summoners = [...cards.values()].filter((c) => c.kind === "summoner").sort((a, b) => a.id - b.id);
  document.getElementById("summoners").replaceChildren(...summoners.map((card) => {
    const img = thumb(card, () => chooseSummoner(card));
    img.classList.toggle("selected", deck.summoner === card.id);
    return img;
  }));

  renderDeckSelect();
  renderAiSelect();
  if (shownName !== openName()) {
    document.getElementById("deck-name").value = shownName = openName();
  }
  document.getElementById("delete-deck").disabled = !!viewing;
  const unsaved = document.getElementById("unsaved");
  unsaved.hidden = !dirty;
  unsaved.textContent = dirty ? t("deck.unsaved") : "";

  sortMainInPlace(deck.main);
  const main = deck.main.map((id) => cards.get(id));
  document.getElementById("main-deck").replaceChildren(...main.map((card) => thumb(card, () => remove(card))));
  document.getElementById("main-count").textContent = main.length;
  document.getElementById("class-counts").textContent = classCounts(cards, deck);
  const battle = main.filter((c) => c.battle).length;
  const note = document.getElementById("deck-note");
  const problems = deckProblems(deck, rules);
  note.textContent = problems.length ? problems.join(" · ") : t("deck.battleSupport", { b: battle, s: main.length - battle });
  note.classList.toggle("bad", problems.length > 0);
}

function icon(src, title, className = "") {
  const img = document.createElement("img");
  img.src = src;
  img.alt = title;
  img.title = title;
  if (className) img.className = className;
  return img;
}

function passes(card) {
  return (!filters.attribute.size || filters.attribute.has(card.attribute)) &&
    (!filters.class.size || filters.class.has(card.class)) &&
    (!filters.level.size || filters.level.has(card.level));
}

function renderFilters() {
  const rows = [
    ["attribute", Object.keys(ATTRIBUTE_ICONS), (v) => `assets/icons/attr-${ATTRIBUTE_ICONS[v]}.png`, (v) => t("deck.attrTitle", { name: attrLabel(v) }), ""],
    ["class", Object.keys(CLASS_ICONS), (v) => `assets/icons/class-${CLASS_ICONS[v]}.png`, (v) => classLabel(v), ""],
    ["level", LEVELS, (v) => `assets/icons/level-${v}.png`, (v) => t("deck.levelN", { n: v }), "level"],
  ];
  for (const [key, values, src, title, kind] of rows) {
    const row = document.getElementById(`filter-${key}`);
    row.replaceChildren(...values.map((value) => {
      const button = document.createElement("button");
      button.className = `filter-button ${kind}`;
      button.classList.toggle("on", filters[key].has(value));
      button.title = title(value);
      button.setAttribute("aria-pressed", filters[key].has(value));
      button.append(icon(src(value), title(value)));
      button.addEventListener("click", () => {
        filters[key].has(value) ? filters[key].delete(value) : filters[key].add(value);
        renderFilters();
        renderList();
      });
      return button;
    }));
  }
  const reset = document.createElement("button");
  reset.className = "filter-reset";
  reset.textContent = t("deck.resetFilters");
  reset.addEventListener("click", () => {
    Object.values(filters).forEach((s) => s.clear());
    renderFilters();
    renderList();
  });
  document.getElementById("filter-level").append(reset);
}

function renderList() {
  const order = SORTS[document.getElementById("sort").value];
  const all = [...cards.values()].filter((c) => c.kind === "creamate" && passes(c)).sort(order);
  document.getElementById("result-count").textContent = all.length;
  const list = document.getElementById("result-list");
  list.replaceChildren(...all.map((card) => {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.src = `pics/small/${card.id}.jpg`;
    img.alt = "";
    img.loading = "lazy";
    const text = document.createElement("span");
    text.className = "text";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = card.name;
    const sub = document.createElement("span");
    sub.className = "sub";
    if (ATTRIBUTE_ICONS[card.attribute]) {
      sub.append(icon(`assets/icons/attr-${ATTRIBUTE_ICONS[card.attribute]}.png`, t("deck.attrTitle", { name: attrLabel(card.attribute) })));
    }
    if (CLASS_ICONS[card.class]) sub.append(icon(`assets/icons/class-${CLASS_ICONS[card.class]}.png`, classLabel(card.class)));
    if (LEVELS.includes(card.level)) {
      sub.append(icon(`assets/icons/level-list-${card.level}.png`, t("deck.levelN", { n: card.level }), "level"));
    }
    text.append(title, sub);
    const stats = document.createElement("span");
    stats.className = "count";
    stats.title = t("deck.atkHp");
    stats.textContent = card.battle ? `${card.atk}/${card.hp}` : "";
    li.append(img, text, stats);
    li.addEventListener("mouseenter", () => show(card));
    li.addEventListener("click", () => add(card));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      add(card);
    });
    return li;
  }));
}

// ---- start --------------------------------------------------------------
async function start() {
  ({ rules, cards } = await loadCards());
  ({ bots: aiBots, decks: aiDecks } = await loadAiDecks(cards));
  loadStored();

  document.getElementById("exit").addEventListener("click", () => {
    if (!leaveOk()) return;
    dirty = false;
    location.href = "index.html?v=i18n6";
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
  document.getElementById("save-deck").addEventListener("click", saveDeck);
  document.getElementById("clear").addEventListener("click", () => {
    if (!deck.main.length && deck.summoner === null) return;
    deck.summoner = null;
    deck.main = [];
    edited();
  });
  document.getElementById("save").addEventListener("click", () => {
    download(`${openName()}.ydk`, toYdk());
    toast(t("deck.exported", { name: openName() }));
  });
  const file = document.getElementById("load-file");
  document.getElementById("load").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    if (!file.files.length) return;
    const picked = file.files[0];
    file.value = "";
    if (!leaveOk()) return;
    newDeck(freeName(picked.name.replace(/\.ydk$/i, "") || FIRST_DECK), fromYdk(await picked.text()));
    toast(t("deck.imported", { name: library.current }));
  });
  document.getElementById("deck-select").addEventListener("change", (e) => switchTo(e.target.value));
  document.getElementById("ai-deck-select").addEventListener("change", (e) => openAi(e.target.value));
  document.getElementById("new-deck").addEventListener("click", () => {
    if (leaveOk()) newDeck(freeName(t("deck.new")));
  });
  document.getElementById("save-as").addEventListener("click", saveAs);
  document.getElementById("delete-deck").addEventListener("click", deleteDeck);
  document.getElementById("sort").addEventListener("change", renderList);
  setupTextSize();

  renderFilters();
  render();
  renderList();
  const first = cards.get(deck.summoner) || cards.values().next().value;
  if (first) show(first);
  await loadSounds();
  playBgm("deck");
}

applyI18n();
start();
