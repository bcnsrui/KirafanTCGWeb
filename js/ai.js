import { toast } from "./ui.js";
import {
  aiRecipeLabel, classCounts, deckProblems, loadAiDecks, loadCards, readLibraryAsync, setupTextSize, writeCardInfo,
} from "./decks.js";
import { loadSounds, playBgm } from "./sound.js";
import { saveMatch } from "./match-store.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n27";
import { mediaUrl } from "./local-assets.js";
import { bindFhdStage } from "./stage-scale.js?v=14";
import { clearLocalDevCaches } from "./dev-cache.js?v=1";
import { setupSideSettings } from "./side-settings.js";

bindFhdStage();
await clearLocalDevCaches();

function setPic(el, rel) {
  if (!el) return;
  mediaUrl(rel).then((url) => { el.src = url; }).catch(() => { el.src = rel; });
}

const CHOICE_STORE = "kirafan.aiMatch";   // { level, aiDeck, myDeck, deckSource, randomOpp }
const MY_DECK = "mine:";                  // option values: "mine:<name>" or "ai:<name>"
const AI_DECK = "ai:";
const CUSTOM = "custom";

function levelText(level) {
  return t(`ai.level.${level}`);
}

let rules = { maxCopies: 3, mainSize: 60 };
let cards = new Map();
let ai = { bots: {}, decks: new Map() };
let library = { current: null, decks: {} };
let step = 1;
const choice = { level: null, aiDeck: null, myDeck: null, deckSource: 4, randomOpp: false };

function aiLevels() {
  return [...new Set([...ai.decks.values()].map((d) => d.level))].sort((a, b) => a - b);
}

function recipesOf(level) {
  return [...ai.decks.values()].filter((d) => d.level === level);
}

function customNames() {
  return Object.keys(library.decks).sort((a, b) => a.localeCompare(b, "ko"));
}

function deckSourceTabs() {
  return [...aiLevels(), CUSTOM];
}

function isCustomSource(source = choice.deckSource) {
  return source === CUSTOM;
}

function normalizeDeckSource(raw, fallbackLevel = choice.level) {
  if (raw === CUSTOM || raw === "custom") return CUSTOM;
  const n = Number(raw);
  if (aiLevels().includes(n)) return n;
  if (raw === "level" || raw === "all" || raw == null) {
    return aiLevels().includes(fallbackLevel) ? fallbackLevel : (aiLevels()[0] ?? CUSTOM);
  }
  return aiLevels().includes(fallbackLevel) ? fallbackLevel : (aiLevels()[0] ?? CUSTOM);
}

function botName(level) {
  const raw = ai.bots[level] || "";
  if (!raw) return "";
  const key = `ai.bot.${raw}`;
  const translated = t(key);
  return translated === key ? raw : translated;
}

function botLabel(level) {
  const name = botName(level);
  return `${t("ai.levelN", { n: level })}${name ? ` ${name}` : ""}`;
}

function normalizeOppKey(raw) {
  if (!raw) return null;
  const value = String(raw);
  if (value.startsWith("random:")) return null; // legacy random-in-list keys
  if (value.startsWith(MY_DECK) || value.startsWith(AI_DECK)) return value;
  if (ai.decks.has(value)) return AI_DECK + value;
  if (library.decks[value]) return MY_DECK + value;
  return null;
}

/** Deck-tab level used for random (not AI difficulty). */
function randomDeckLevel() {
  const n = Number(choice.deckSource);
  return aiLevels().includes(n) ? n : null;
}

function isRandomOpp() {
  return !!choice.randomOpp && randomDeckLevel() != null;
}

/** Opponent deck picked in step 1: { key, name, deck, kind, level? } or null */
function oppDeck() {
  if (isRandomOpp()) {
    const level = randomDeckLevel();
    if (!recipesOf(level).length) return null;
    return { key: `random:${level}`, name: t("ai.randomDeck"), deck: null, kind: "random", level };
  }
  const key = normalizeOppKey(choice.aiDeck);
  if (!key) return null;
  if (key.startsWith(MY_DECK)) {
    const name = key.slice(MY_DECK.length);
    const deck = library.decks[name];
    return deck ? { key, name, deck, kind: "mine" } : null;
  }
  const name = key.slice(AI_DECK.length);
  const deck = ai.decks.get(name);
  return deck ? { key, name, deck, kind: "ai" } : null;
}

/** Resolve random at match start so the preview stays hidden until then. */
function resolveOppDeck() {
  const picked = oppDeck();
  if (!picked) return null;
  if (picked.kind !== "random") return picked;
  const pool = recipesOf(picked.level);
  if (!pool.length) return null;
  const recipe = pool[Math.floor(Math.random() * pool.length)];
  return { key: AI_DECK + recipe.name, name: recipe.name, deck: recipe, kind: "ai" };
}

function oppTitle(picked, { short = false } = {}) {
  if (!picked) return "";
  if (picked.kind === "random") return t("ai.randomPreview", { n: picked.level });
  if (picked.kind === "ai") return aiRecipeLabel(picked.deck, cards, { short });
  return short ? picked.name : t("ai.customDeck", { name: picked.name });
}

function oppProblems(picked) {
  if (!picked) return [t("ai.pickDeck")];
  if (picked.kind === "random") return recipesOf(picked.level).length ? [] : [t("ai.pickDeck")];
  return deckProblems(picked.deck, rules);
}

/** the deck the player picked in step 2: { name, deck } or null */
function myDeck() {
  const value = choice.myDeck || "";
  if (value.startsWith(MY_DECK)) {
    const name = value.slice(MY_DECK.length);
    return library.decks[name] ? { name, deck: library.decks[name] } : null;
  }
  if (!value.startsWith(AI_DECK)) return null;
  const name = value.slice(AI_DECK.length);
  return ai.decks.has(name) ? { name, deck: ai.decks.get(name) } : null;
}

function entriesForSource(source) {
  if (isCustomSource(source)) {
    return customNames().map((name) => ({
      key: MY_DECK + name,
      summoner: library.decks[name]?.summoner,
      title: name,
      sub: t("ai.deckSource.custom"),
      full: t("ai.customDeck", { name }),
    }));
  }
  return recipesOf(Number(source)).map((recipe) => {
    const short = aiRecipeLabel(recipe, cards, { short: true });
    const [number, ...rest] = short.split(" · ");
    return {
      key: AI_DECK + recipe.name,
      summoner: recipe.summoner,
      title: number,
      sub: rest.join(" · ") || "",
      full: aiRecipeLabel(recipe, cards),
    };
  });
}

function firstKeyForSource(source) {
  return entriesForSource(source)[0]?.key || null;
}

function ensureOppInSource() {
  if (isRandomOpp()) return;
  const keys = new Set(entriesForSource(choice.deckSource).map((e) => e.key));
  const current = normalizeOppKey(choice.aiDeck);
  if (current && keys.has(current)) {
    choice.aiDeck = current;
    return;
  }
  choice.aiDeck = firstKeyForSource(choice.deckSource);
}

// ---- drawing ------------------------------------------------------------
function show(card) {
  setPic(document.getElementById("preview"), `pics/${card.id}.jpg`);
  writeCardInfo(document.getElementById("card-info"), card);
}

function thumb(card) {
  const img = document.createElement("img");
  img.className = "card";
  setPic(img, `pics/small/${card.id}.jpg`);
  img.alt = card.name;
  img.title = card.name;
  img.addEventListener("mouseenter", () => show(card));
  return img;
}

function renderRecipe(title, deck, { random = false, level = null } = {}) {
  const recipe = document.querySelector(".recipe");
  const summoner = document.getElementById("recipe-summoner");
  const grid = document.getElementById("recipe-grid");
  recipe?.classList.toggle("recipe-is-random", random);
  if (random) {
    document.getElementById("recipe-title").textContent = "";
    document.getElementById("recipe-counts").textContent = "";
    summoner.replaceChildren();
    const msg = document.createElement("p");
    msg.className = "recipe-random";
    msg.textContent = t("ai.randomPreview", { n: level ?? randomDeckLevel() ?? choice.level });
    grid.replaceChildren(msg);
    return;
  }
  document.getElementById("recipe-title").textContent = title;
  if (!deck) {
    document.getElementById("recipe-counts").textContent = "";
    summoner.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "recipe-empty";
    empty.textContent = t("ai.pickDeck");
    grid.replaceChildren(empty);
    return;
  }
  document.getElementById("recipe-counts").textContent = `${t("ai.deckCount", { n: deck.main.length })} ${classCounts(cards, deck)}`;
  summoner.replaceChildren(...(cards.has(deck.summoner) ? [thumb(cards.get(deck.summoner))] : []));
  grid.replaceChildren(...deck.main.map((id) => thumb(cards.get(id))));
}

function renderLevels() {
  document.getElementById("level-choices").replaceChildren(...aiLevels().map((level) => {
    const button = document.createElement("button");
    button.className = "choice level-choice";
    button.classList.toggle("on", choice.level === level);
    const lv = document.createElement("b");
    lv.textContent = t("ai.levelN", { n: level });
    const bot = document.createElement("span");
    bot.textContent = botName(level);
    button.append(lv, bot);
    button.addEventListener("click", () => {
      if (choice.level === level) return;
      choice.level = level;
      choice.deckSource = level;
      if (!choice.randomOpp) choice.aiDeck = firstKeyForSource(level);
      render();
    });
    return button;
  }));
  document.getElementById("level-desc").textContent = choice.level ? levelText(choice.level) : "";
}

function renderDeckSources() {
  const host = document.getElementById("deck-source-tabs");
  host.replaceChildren(...deckSourceTabs().map((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deck-source-tab";
    button.classList.toggle("on", choice.deckSource === source);
    button.textContent = source === CUSTOM ? t("ai.deckSource.custom") : t("ai.levelN", { n: source });
    button.addEventListener("click", () => {
      if (choice.deckSource === source) return;
      choice.deckSource = source;
      if (source === CUSTOM) choice.randomOpp = false;
      ensureOppInSource();
      render();
    });
    return button;
  }));
}

function renderAiDecks() {
  const entries = entriesForSource(choice.deckSource);
  const host = document.getElementById("ai-deck-choices");
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "recipe-empty";
    empty.textContent = isCustomSource() ? t("ai.noCustomDecks") : t("ai.pickDeck");
    host.replaceChildren(empty);
    return;
  }
  host.replaceChildren(...entries.map((entry) => {
    const button = document.createElement("button");
    button.className = "choice deck-choice";
    button.classList.toggle("on", !isRandomOpp() && choice.aiDeck === entry.key);
    button.disabled = isRandomOpp();
    button.title = entry.full;
    const face = document.createElement("img");
    face.alt = "";
    if (cards.has(entry.summoner)) setPic(face, `pics/small/${entry.summoner}.jpg`);
    const label = document.createElement("span");
    label.className = "label";
    label.append(entry.title);
    if (entry.sub) {
      const tag = document.createElement("small");
      tag.className = "deck-tag";
      tag.textContent = entry.sub;
      label.append(tag);
    }
    button.append(face, label);
    button.addEventListener("click", () => {
      if (isRandomOpp()) return;
      choice.aiDeck = entry.key;
      render();
    });
    return button;
  }));
}

function renderRandomButton() {
  const btn = document.getElementById("random-opp");
  const onStep1 = step === 1;
  btn.hidden = !onStep1;
  if (!onStep1) return;
  const custom = isCustomSource();
  btn.disabled = custom;
  btn.classList.toggle("on", isRandomOpp());
  btn.textContent = t("ai.randomToggle");
  btn.title = custom ? t("ai.deckSource.custom") : t("ai.randomToggle");
}

function option(value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function renderMyDecks() {
  const select = document.getElementById("my-deck");
  const mine = document.createElement("optgroup");
  mine.label = t("ai.myDeck");
  const names = customNames();
  mine.append(...names.map((name) => option(MY_DECK + name, name)));
  const levels = [...aiLevels()].reverse();
  const groups = levels.map((level) => {
    const group = document.createElement("optgroup");
    group.label = `AI ${botLabel(level)}`;
    group.append(...recipesOf(level).map((d) => option(AI_DECK + d.name, aiRecipeLabel(d, cards))));
    return group;
  });
  select.replaceChildren(...(names.length ? [mine] : []), ...groups);
  select.value = choice.myDeck || "";
}

function render() {
  document.querySelectorAll(".step").forEach((el) => el.classList.toggle("on", Number(el.dataset.step) === step));
  document.getElementById("step-1").hidden = step !== 1;
  document.getElementById("step-2").hidden = step !== 2;
  const back = document.getElementById("back");
  const next = document.getElementById("next");
  back.textContent = step === 1 ? t("common.exit") : t("ai.prev");
  next.textContent = step === 1 ? t("common.next") : t("ai.start");
  renderRandomButton();

  if (step === 1) {
    renderLevels();
    renderDeckSources();
    ensureOppInSource();
    renderAiDecks();
    const picked = oppDeck();
    if (picked?.kind === "random") {
      renderRecipe("", null, { random: true, level: picked.level });
    } else {
      renderRecipe(oppTitle(picked), picked?.deck || null);
    }
    const oppNote = document.getElementById("opp-deck-note");
    const problems = oppProblems(picked);
    if (problems.length) {
      oppNote.hidden = false;
      oppNote.textContent = t("ai.invalidDeck", { why: problems.join(" · ") });
      oppNote.classList.add("bad");
    } else {
      oppNote.hidden = true;
      oppNote.textContent = "";
      oppNote.classList.remove("bad");
    }
    next.disabled = problems.length > 0;
  } else {
    const pickedOpp = oppDeck();
    const opponent = document.getElementById("opponent");
    opponent.innerHTML = "";
    opponent.append(`${t("ai.oppLabel")} `);
    const who = document.createElement("b");
    who.textContent = `AI ${botLabel(choice.level)}`;
    opponent.append(who, ` · ${pickedOpp?.kind === "random" ? t("ai.randomDeck") : oppTitle(pickedOpp, { short: true })}`);
    renderMyDecks();
    const picked = myDeck();
    const pickedTitle = picked
      ? (ai.decks.has(picked.name) ? aiRecipeLabel(ai.decks.get(picked.name), cards) : picked.name)
      : "";
    renderRecipe(pickedTitle, picked && picked.deck);
    const problems = picked ? deckProblems(picked.deck, rules) : [t("ai.pickDeck")];
    const note = document.getElementById("my-deck-note");
    note.textContent = problems.length ? t("ai.invalidDeck", { why: problems.join(" · ") }) : "";
    note.classList.toggle("bad", problems.length > 0);
    next.disabled = problems.length > 0;
  }
}

function remember() {
  localStorage.setItem(CHOICE_STORE, JSON.stringify(choice));
}

function startGame() {
  const recipe = resolveOppDeck();
  const picked = myDeck();
  if (!recipe || !picked) return;
  if (deckProblems(recipe.deck, rules).length || deckProblems(picked.deck, rules).length) return;
  remember();
  saveMatch({
    level: choice.level,
    bot: ai.bots[choice.level] || "",
    ai: { name: recipe.name, summoner: recipe.deck.summoner, main: [...recipe.deck.main] },
    me: { name: picked.name, summoner: picked.deck.summoner, main: [...picked.deck.main] },
  });
  location.href = "game.html";
}

// ---- start --------------------------------------------------------------
async function start() {
  ({ rules, cards } = await loadCards());
  ai = await loadAiDecks(cards);
  library = await readLibraryAsync(cards);

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CHOICE_STORE)) || {};
  } catch {
    saved = {};
  }
  const levels = aiLevels();
  choice.level = levels.includes(saved.level) ? saved.level : levels[levels.length - 1] ?? levels[0] ?? null;
  choice.randomOpp = !!saved.randomOpp;
  choice.aiDeck = normalizeOppKey(saved.aiDeck);
  const savedKey = choice.aiDeck;
  if (String(saved.aiDeck || "").startsWith("random:") && levels.includes(Number(String(saved.aiDeck).slice(7)))) {
    choice.randomOpp = true;
    choice.level = Number(String(saved.aiDeck).slice(7));
    choice.deckSource = choice.level;
    choice.aiDeck = firstKeyForSource(choice.level);
  } else if (savedKey?.startsWith(MY_DECK) && library.decks[savedKey.slice(MY_DECK.length)]) {
    choice.deckSource = CUSTOM;
    choice.randomOpp = false;
  } else if (savedKey?.startsWith(AI_DECK) && ai.decks.has(savedKey.slice(AI_DECK.length))) {
    choice.deckSource = ai.decks.get(savedKey.slice(AI_DECK.length)).level;
  } else {
    choice.deckSource = normalizeDeckSource(saved.deckSource, choice.level);
    choice.aiDeck = firstKeyForSource(choice.deckSource);
  }
  if (isCustomSource()) choice.randomOpp = false;
  if (!choice.aiDeck || !entriesForSource(choice.deckSource).some((e) => e.key === choice.aiDeck)) {
    choice.aiDeck = firstKeyForSource(choice.deckSource);
  }
  choice.myDeck = saved.myDeck && (saved.myDeck.startsWith(MY_DECK)
    ? library.decks[saved.myDeck.slice(MY_DECK.length)] : ai.decks.has(saved.myDeck.slice(AI_DECK.length)))
    ? saved.myDeck : library.current ? MY_DECK + library.current : null;

  document.getElementById("back").addEventListener("click", () => {
    if (step === 1) {
      location.href = "index.html?v=i18n3";
    } else {
      step = 1;
      render();
    }
  });
  document.getElementById("random-opp").addEventListener("click", () => {
    if (isCustomSource()) return;
    choice.randomOpp = !choice.randomOpp;
    if (!choice.randomOpp) ensureOppInSource();
    render();
  });
  document.getElementById("next").addEventListener("click", () => {
    if (step === 1) {
      const picked = oppDeck();
      const problems = oppProblems(picked);
      if (problems.length) {
        toast(t("ai.invalidDeck", { why: problems.join(" · ") }));
        render();
        return;
      }
      remember();
      step = 2;
      render();
    } else {
      startGame();
    }
  });
  document.getElementById("my-deck").addEventListener("change", (e) => {
    choice.myDeck = e.target.value;
    render();
  });

  setupTextSize();
  setupSideSettings();
  render();
  const first = cards.get(oppDeck()?.deck?.summoner);
  if (first) show(first);
  if (!ai.decks.size) toast(t("ai.noAiDecks"));
  await loadSounds();
  playBgm("deck");
}

applyI18n();
start();
