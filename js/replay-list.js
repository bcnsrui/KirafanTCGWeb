import { toast } from "./ui.js";
import { deleteReplay, isReplay, listReplays, saveReplay } from "./replays.js";
import { loadSounds, playBgm } from "./sound.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n20";
import { loadCards, readLibraryAsync, saveLibraryAsync } from "./decks.js";
import { currentNick } from "./match-store.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, primary = false) {
  const b = el("button", `menu-button small${primary ? " primary" : ""}`, label);
  b.addEventListener("click", onClick);
  return b;
}

/** 24-hour local stamp: 2026.11.12 13:45:20 */
function formatStamp(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** list date: same 24h style (no AM/PM) */
function formatListDate(date) {
  return formatStamp(date) || String(date || "");
}

/** the replay as a file of its own */
function download(replay) {
  const blob = new Blob([JSON.stringify(replay)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date(replay.date);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
    + `-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  a.href = URL.createObjectURL(blob);
  a.download = `kirafan-replay-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isKnownAiBot(bot) {
  const b = String(bot || "").trim();
  if (!b) return false;
  const key = `ai.bot.${b}`;
  return t(key) !== key;
}

function isAiReplay(r) {
  // vsAi / pvp 가 정식. 옛 사람전은 bot 에 닉이 들어가 AI전으로 오인되던 것 보정
  if (r?.pvp) return false;
  if (r?.vsAi === true) return true;
  if (r?.vsAi === false) return false;
  return isKnownAiBot(r?.bot);
}

function looksLikeBoardLabel(s) {
  const t0 = String(s || "").trim();
  return !t0 || / · /.test(t0) || /^(나|상대|自分|相手|Me|Opponent)\b/i.test(t0);
}

/** 목록 vs 줄: 사람이면 닉, AI면 덱/단계 라벨 */
function replayVsMeLabel(r) {
  const nick = String(r.decks?.me?.name || "").trim();
  if (nick && !looksLikeBoardLabel(nick)) return nick;
  const deck = String(r.myDeck || "").trim();
  if (deck && !looksLikeBoardLabel(deck)) return deck;
  return nick || deck || t("game.me");
}

function replayVsOppLabel(r) {
  if (isAiReplay(r)) {
    const deck = String(r.aiDeck || "").trim();
    if (deck) return deck;
    const botKey = r.bot ? `ai.bot.${r.bot}` : "";
    const botLabel = botKey && t(botKey) !== botKey ? t(botKey) : (r.bot || "");
    const level = r.level ? t("ai.levelN", { n: r.level }) : "";
    if (level && botLabel) return `AI ${level} ${botLabel}`.trim();
    if (level) return `AI ${level}`;
    return botLabel || t("game.opp");
  }
  const nick = String(r.decks?.op?.name || "").trim();
  if (nick && !looksLikeBoardLabel(nick)) return nick;
  const deck = String(r.aiDeck || "").trim();
  if (deck && !looksLikeBoardLabel(deck)) return deck;
  return nick || deck || t("game.opp");
}

function askDeckSide(replay) {
  const box = document.getElementById("replay-prompt");
  const title = document.getElementById("replay-prompt-title");
  const text = document.getElementById("replay-prompt-text");
  const opts = document.getElementById("replay-prompt-options");
  if (!box || !opts) return Promise.resolve(null);

  title.textContent = t("replay.saveDeckAsk");
  if (text) text.textContent = "";


  const meName = deckSaveNick(replay, "me", replay.decks?.me || {});
  const opName = deckSaveNick(replay, "op", replay.decks?.op || {});

  return new Promise((resolve) => {
    const finish = (side) => {
      box.hidden = true;
      resolve(side);
    };
    const row = el("div", "row");
    row.append(
      button(meName, () => finish("me"), true),
      button(opName, () => finish("op")),
      button(t("replay.cancel"), () => finish(null)),
    );
    opts.replaceChildren(row);
    box.hidden = false;
  });
}

/** 덱 저장 이름용 닉만 (옛 리플의 "나 · AI 4단계 · …" 라벨은 버림) */
function deckSaveNick(replay, side, pack) {
  const raw = String(pack?.name || "").trim();
  const looksLong = / · /.test(raw) || /^나\b|^自分\b|^Me\b/i.test(raw);
  if (side === "me") {
    if (raw && !looksLong) return raw;
    return (currentNick() || t("game.me")).trim() || t("game.me");
  }
  if (raw && !looksLong) return raw;
  if (isAiReplay(replay)) {
    return String(replay.aiDeck || t("game.opp")).trim() || t("game.opp");
  }
  const fromNames = String(replay.names?.[1] || "").trim();
  if (fromNames && !/ · /.test(fromNames)) return fromNames;
  return t("game.opp");
}

async function saveDeckFromReplay(replay, side) {
  const pack = replay.decks?.[side];
  if (!pack || (!pack.summoner && !(pack.main && pack.main.length))) {
    toast(t("replay.noDeck"));
    return;
  }
  const stamp = formatStamp(replay.date);
  const nick = deckSaveNick(replay, side, pack);
  let name = stamp ? `${nick}(${stamp})` : nick;
  const { cards } = await loadCards();
  const library = await readLibraryAsync(cards);
  let n = 2;
  const base = name;
  while (library.decks[name]) name = `${base} (${n++})`;
  library.decks[name] = {
    summoner: pack.summoner ?? null,
    main: [...(pack.main || [])],
  };
  if (!library.current) library.current = name;
  await saveLibraryAsync(library);
  toast(t("replay.saveDeckDone", { name }));
}

async function onSaveDeck(replay) {
  if (!replay.decks?.me && !replay.decks?.op) {
    toast(t("replay.noDeck"));
    return;
  }
  let side = "me";
  if (!isAiReplay(replay)) {
    side = await askDeckSide(replay);
    if (!side) return;
  }
  await saveDeckFromReplay(replay, side);
}

async function showList() {
  const replays = await listReplays();
  document.getElementById("replay-count").textContent = t("replay.count", { n: replays.length });
  const list = document.getElementById("replay-list");
  if (!replays.length) {
    list.replaceChildren(el("li", "replay-empty", t("replay.empty")));
    return;
  }
  list.replaceChildren(...replays.map((r) => {
    const row = el("li", "replay-item");
    const info = el("div", "replay-info");
    let outcome = String(r.result || "").replace("!", "");
    if (outcome === "항복" || outcome === "패배" || outcome === "Defeat" || outcome === "敗北" || outcome === "Loss"
      || outcome === "Surrender" || outcome === "降参") outcome = t("replay.lose");
    else if (outcome === "승리" || outcome === "Victory" || outcome === "勝利" || outcome === "Win") outcome = t("replay.win");
    const kind = outcome === t("replay.win") ? "win" : outcome === t("replay.lose") ? "lose" : "";
    const line1 = el("div", "replay-line");
    line1.append(
      el("b", `replay-result ${kind}`, outcome || "?"),
      el("span", "replay-date", formatListDate(r.date)),
    );
    const vs = t("replay.vs", {
      deck: replayVsMeLabel(r),
      opp: replayVsOppLabel(r),
    });
    const line2 = el("div", "replay-line replay-match", `${vs} ${t("replay.turns", { n: r.turns })}`);
    info.append(line1, line2);
    const actions = el("div", "replay-actions");
    actions.append(
      button(t("replay.view"), () => (location.href = `game.html?replay=${r.id}`), true),
      button(t("replay.saveFile"), () => download(r)),
      button(t("replay.saveDeck"), () => void onSaveDeck(r)),
      button(t("replay.delete"), async () => {
        await deleteReplay(r.id);
        showList();
      }),
    );
    row.append(info, actions);
    return row;
  }));
}

applyI18n();
document.getElementById("back").addEventListener("click", () => (location.href = "index.html?v=i18n3"));
document.getElementById("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const replay = JSON.parse(await file.text());
    if (!isReplay(replay)) return toast(t("replay.notFile"));
    await saveReplay(replay);
    toast(t("replay.imported"));
    showList();
  } catch (err) {
    console.error(err);
    toast(t("replay.readFail"));
  }
});

showList();
loadSounds().then(() => playBgm("deck"));
