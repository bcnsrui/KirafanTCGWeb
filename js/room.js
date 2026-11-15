import { toast } from "./ui.js";
import { loadSounds, playBgm } from "./sound.js";
import { aiRecipeLabel, classCounts, deckProblems, loadAiDecks, loadCards, readLibrary } from "./decks.js";
import { deleteRoom, fetchRooms, upsertRoom } from "./lobby-rooms.js";
import { saveMatch } from "./match-store.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n21";

const NICK_STORE = "kirafan.server.nick";
const ROOM_ID_STORE = "kirafan.room.id";
const ROOM_NAME_STORE = "kirafan.room.name";
const NICK_MAX = 10;
const ROOM_NAME_MAX = 20;
const STATUS_WAITING = "대기중";
const STATUS_PLAYING = "게임중";

function defaultNick() {
  return t("common.defaultNick");
}
function defaultRoomName() {
  return t("server.defaultRoom");
}
function emptySeat() {
  return t("room.waitingSeat");
}

const me = (
  sessionStorage.getItem(NICK_STORE) ||
  localStorage.getItem(NICK_STORE) ||
  defaultNick()
).trim().slice(0, NICK_MAX) || defaultNick();
let host = me;
let roomId = sessionStorage.getItem(ROOM_ID_STORE) || `room-${Date.now()}`;
let roomName = (sessionStorage.getItem(ROOM_NAME_STORE) || defaultRoomName()).slice(0, ROOM_NAME_MAX);
sessionStorage.setItem(ROOM_ID_STORE, roomId);
const seats = { 1: null, 2: null };
/** @type {Map<number, { level: number, deck: string }>} */
const aiSeats = new Map();
const spectators = [];
/** 게임 시작 전에 관전 중이던 닉네임 (비허용 시 중도 관전 예외) */
const preGameSpectators = new Set();
let spectating = false;
let spectateAllowed = true;
let gameStarted = false;
let ready = false;
/** @type {Set<string>} */
const readyPlayers = new Set();
/** @type {Set<string>} */
const kickedPlayers = new Set();
let cards = new Map();
let rules = { maxCopies: 3, mainSize: 20 };
let library = { current: null, decks: {} };
let ai = { bots: {}, decks: new Map() };
let activeSource = "mine"; // "mine" | "ai"
/** @type {Record<string, { name: string, summoner: number, main: number[] }>} */
let playerDecks = {};
/** @type {any} */
let roomMatch = null;
let applyingRemote = false;
let leavingRoom = false;
let enteringDuel = false;

function roomNameInput() {
  return document.getElementById("room-name");
}

function lobbyStatus() {
  return gameStarted ? STATUS_PLAYING : STATUS_WAITING;
}

function spectatePolicySelect() {
  return document.getElementById("spectate-policy");
}

function syncRoomHeaderControls() {
  const input = roomNameInput();
  const saveBtn = document.getElementById("save-room-name");
  const policy = spectatePolicySelect();
  input.value = roomName;
  input.disabled = !isHost();
  saveBtn.disabled = !isHost();
  saveBtn.title = isHost() ? "" : t("room.hostOnlyRename");
  policy.value = spectateAllowed ? "allow" : "deny";
  policy.disabled = !isHost();
  policy.title = isHost() ? "" : t("room.hostOnlySpectate");
  syncSpectateButton();
}

function syncSpectateButton() {
  const btn = document.getElementById("spectate");
  if (spectating) {
    btn.disabled = false;
    btn.title = "";
    return;
  }
  const blocked = !canJoinAsSpectator(me);
  btn.disabled = blocked;
  btn.title = blocked ? t("room.spectateBlockedMid") : "";
}

function canJoinAsSpectator(name) {
  if (spectateAllowed || !gameStarted) return true;
  return preGameSpectators.has(name);
}

/** @type {any[]} */
let lobbyRoomsCache = [];

function seatSnapshot() {
  return { 1: seats[1], 2: seats[2] };
}

function aiSnapshot() {
  const slot = [...aiSeats.keys()][0];
  if (!slot) return null;
  const info = aiSeats.get(slot);
  return { slot, level: info.level, deck: info.deck, label: seats[slot] };
}

/** 서버/캐시에 있는 남의 덱은 유지하고, 내 덱만 로컬 선택으로 갱신 */
function mergePlayerDecks(remoteDecks = {}) {
  const next = { ...(remoteDecks || {}), ...playerDecks };
  const pack = packSelectedDeck();
  if (pack) next[me] = pack;
  else delete next[me];
  // 좌석에 없는 사람 덱은 정리하지 않음(잠깐 비동기 공백 방지). 내 키만 보장.
  playerDecks = next;
  return next;
}

function deckForPlayer(name) {
  if (!name) return null;
  if (playerDecks[name]) return playerDecks[name];
  const key = Object.keys(playerDecks).find((k) => k.trim() === String(name).trim());
  return key ? playerDecks[key] : null;
}

function buildLobbyPayload(status = lobbyStatus()) {
  const humans = [1, 2].filter((n) => seats[n] && !aiSeats.has(n)).map((n) => seats[n]);
  const current = lobbyRoomsCache.find((r) => r.id === roomId);
  const decks = mergePlayerDecks(current?.playerDecks || {});
  return {
    id: roomId,
    banlist: "없음",
    name: roomName,
    summoners: humans.length ? humans.join(", ") : host || me,
    host,
    seats: seatSnapshot(),
    ready: [...readyPlayers],
    spectators: [...spectators],
    kicked: [...kickedPlayers],
    ai: aiSnapshot(),
    playerDecks: { ...decks },
    match: roomMatch,
    status,
    locked: !!current?.locked,
    spectateAllowed,
    updatedAt: Date.now(),
  };
}

function forceLeaveRoom(message) {
  if (leavingRoom) return;
  leavingRoom = true;
  sessionStorage.removeItem(ROOM_ID_STORE);
  toast(message);
  location.href = "server.html";
}

function markKicked(name) {
  if (!name || name === host) return;
  kickedPlayers.add(name);
}

function syncLobbyRoom(status = lobbyStatus()) {
  if (applyingRemote) return Promise.resolve(lobbyRoomsCache);
  const next = buildLobbyPayload(status);
  lobbyRoomsCache = [next, ...lobbyRoomsCache.filter((r) => r.id !== roomId)];
  return upsertRoom(next).then((rooms) => {
    lobbyRoomsCache = rooms;
    return rooms;
  }).catch(() => lobbyRoomsCache);
}

function removeLobbyRoom() {
  sessionStorage.removeItem(ROOM_ID_STORE);
  return deleteRoom(roomId).then((rooms) => {
    lobbyRoomsCache = rooms;
  }).catch(() => {});
}

function applyAiFromRemote(remoteAi) {
  aiSeats.clear();
  if (!remoteAi || !remoteAi.slot) return;
  const slot = Number(remoteAi.slot);
  aiSeats.set(slot, { level: Number(remoteAi.level) || 4, deck: remoteAi.deck || "" });
  if (remoteAi.label) seats[slot] = remoteAi.label;
}

function applyRemoteRoom(remote, { join = false } = {}) {
  if (!remote) return false;
  applyingRemote = true;
  try {
    host = remote.host || host || me;
    if (remote.name) roomName = String(remote.name).slice(0, ROOM_NAME_MAX);
    spectateAllowed = remote.spectateAllowed !== false;
    gameStarted = remote.status === STATUS_PLAYING;

    kickedPlayers.clear();
    for (const name of remote.kicked || []) kickedPlayers.add(name);
    // 로비에서 다시 들어오면 강퇴 기록을 지우고 착석 가능하게 함
    if (join) kickedPlayers.delete(me);

    seats[1] = remote.seats?.[1] || null;
    seats[2] = remote.seats?.[2] || null;
    applyAiFromRemote(remote.ai);

    readyPlayers.clear();
    for (const name of remote.ready || []) readyPlayers.add(name);

    spectators.splice(0, spectators.length, ...(remote.spectators || []));
    spectating = spectators.includes(me);
    ready = readyPlayers.has(me) && !spectating;
    mergePlayerDecks(remote.playerDecks || {});
    roomMatch = remote.match || null;

    if (join && !spectating) {
      const alreadySeated = seats[1] === me || seats[2] === me;
      if (!alreadySeated) {
        if (me === host) {
          if (!seats[1]) seats[1] = me;
          else if (!seats[2] && seats[1] !== me) seats[2] = me;
        } else if (!seats[2] || seats[2] === me) {
          seats[2] = me;
        } else if (!seats[1] || seats[1] === me) {
          seats[1] = me;
        }
      }
    }

    if (gameStarted) {
      preGameSpectators.clear();
      for (const name of spectators) preGameSpectators.add(name);
    }

    const spectateBtn = document.getElementById("spectate");
    spectateBtn.classList.toggle("on", spectating);
    spectateBtn.textContent = spectating ? t("room.spectating") : t("room.toSpectate");
    return true;
  } finally {
    applyingRemote = false;
    syncReadyButton();
  }
}

function bothPlayersReady() {
  const a = seats[1];
  const b = seats[2];
  if (!a || !b) return false;
  return isSeatReady(1, a) && isSeatReady(2, b);
}

function syncGuestChrome() {
  document.querySelector(".room-page")?.classList.toggle("room-is-guest", !isHost());
  const start = document.getElementById("start");
  if (!isHost()) {
    start.disabled = true;
    start.title = t("room.hostOnlyStart");
    return;
  }
  const ok = bothPlayersReady();
  start.disabled = !ok;
  start.title = ok ? "" : t("room.needBothReady");
}

async function loadRoomSettingsFromLobby() {
  lobbyRoomsCache = await fetchRooms();
  let current = lobbyRoomsCache.find((r) => r.id === roomId);
  if (!current) {
    host = me;
    seats[1] = me;
    seats[2] = null;
    return;
  }
  applyRemoteRoom(current, { join: true });
  // 다시 들어오면 강퇴 목록에서 제외
  kickedPlayers.delete(me);
  current = buildLobbyPayload(lobbyStatus());
  lobbyRoomsCache = await upsertRoom(current);
}

function saveRoomName() {
  if (!isHost()) {
    toast(t("room.hostOnlyRename"));
    return;
  }
  const next = (roomNameInput().value.trim() || DEFAULT_ROOM_NAME).slice(0, ROOM_NAME_MAX);
  roomName = next;
  roomNameInput().value = next;
  sessionStorage.setItem(ROOM_NAME_STORE, next);
  syncLobbyRoom();
  toast(t("room.roomNameSaved"));
}

function setSpectatePolicy(allowed) {
  if (!isHost()) {
    toast(t("room.hostOnlySpectate"));
    syncRoomHeaderControls();
    return;
  }
  spectateAllowed = allowed;
  syncLobbyRoom();
  syncRoomHeaderControls();
  toast(allowed ? t("room.spectateAllowed") : t("room.spectateDenied"));
}

function option(value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function botLabel(level) {
  const raw = ai.bots[level] || "";
  const key = raw ? `ai.bot.${raw}` : "";
  const name = key ? (t(key) === key ? raw : t(key)) : "";
  return `${t("ai.levelN", { n: level })}${name ? ` ${name}` : ""}`;
}

function recipesOf(level) {
  return [...ai.decks.values()].filter((d) => d.level === level);
}

function thumb(card) {
  const img = document.createElement("img");
  img.className = "card";
  img.src = `pics/small/${card.id}.jpg`;
  img.alt = card.name;
  img.title = card.name;
  return img;
}

function selectedDeck() {
  if (activeSource === "ai") {
    const name = document.getElementById("ai-deck-select").value;
    return name ? ai.decks.get(name) : null;
  }
  const name = document.getElementById("deck-select").value;
  return name ? library.decks[name] : null;
}

function renderDeckStats(deck) {
  const bar = document.getElementById("deck-stats");
  if (!deck || !(deck.main || []).length) {
    bar.hidden = true;
    return;
  }
  const main = (deck.main || []).map((id) => cards.get(id)).filter(Boolean);
  const battle = main.filter((c) => c.battle).length;
  document.getElementById("deck-main-count").textContent = String(main.length);
  document.getElementById("deck-class-counts").textContent = classCounts(cards, deck);
  document.getElementById("deck-role-counts").textContent = t("room.battleSupport", { b: battle, s: main.length - battle });
  bar.hidden = false;
}

function renderDeck() {
  const summonerBox = document.getElementById("deck-summoner");
  const grid = document.getElementById("deck-grid");
  const deck = selectedDeck();
  if (!deck) {
    summonerBox.replaceChildren();
    renderDeckStats(null);
    const empty = document.createElement("p");
    empty.className = "room-deck-empty";
    empty.textContent = t("room.deckPickHint");
    grid.replaceChildren(empty);
    return;
  }
  summonerBox.replaceChildren(
    ...(cards.has(deck.summoner) ? [thumb(cards.get(deck.summoner))] : []),
  );
  const main = deck.main || [];
  if (!main.length) {
    renderDeckStats(null);
    const empty = document.createElement("p");
    empty.className = "room-deck-empty";
    empty.textContent = t("room.emptyMain");
    grid.replaceChildren(empty);
    return;
  }
  renderDeckStats(deck);
  grid.replaceChildren(...main.filter((id) => cards.has(id)).map((id) => thumb(cards.get(id))));
}

function packSelectedDeck() {
  const deck = selectedDeck();
  if (!deck || !deck.summoner || !(deck.main || []).length) return null;
  const name = activeSource === "ai"
    ? document.getElementById("ai-deck-select").value
    : document.getElementById("deck-select").value;
  return {
    name: name || t("nav.deck"),
    summoner: deck.summoner,
    main: [...(deck.main || [])],
  };
}

/** @returns {string[]} */
function myDeckProblems() {
  const pack = packSelectedDeck();
  if (!pack) return [t("room.pickDeck")];
  return deckProblems({ summoner: pack.summoner ?? null, main: pack.main || [] }, rules);
}

function syncDeckSelectLock() {
  const mine = document.getElementById("deck-select");
  const aiDeck = document.getElementById("ai-deck-select");
  const locked = ready || spectating;
  mine.disabled = locked;
  aiDeck.disabled = locked;
  const why = spectating ? t("room.deckLockedSpectate") : ready ? t("room.deckLockedReady") : "";
  mine.title = why;
  aiDeck.title = why;
}

function syncReadyButton() {
  const btn = document.getElementById("ready");
  const problems = myDeckProblems();
  const invalid = problems.length > 0;
  if (invalid && ready) {
    ready = false;
    setPlayerReady(me, false);
    syncLobbyRoom();
  }
  btn.classList.toggle("on", ready);
  btn.textContent = ready ? t("room.readyCancel") : t("room.ready");
  btn.disabled = spectating || (!ready && invalid);
  btn.title = spectating
    ? t("room.readyLockedSpectate")
    : (!ready && invalid ? t("room.deckInvalidReady", { list: problems.join(" · ") }) : "");
  syncDeckSelectLock();
}

function syncMyDeckToLobby() {
  const current = lobbyRoomsCache.find((r) => r.id === roomId);
  mergePlayerDecks(current?.playerDecks || {});
  syncReadyButton();
  syncLobbyRoom();
}

function pickMine() {
  if (ready || spectating) {
    toast(ready ? t("room.deckLockedReady") : t("room.deckLockedSpectate"));
    syncDeckSelectLock();
    return;
  }
  activeSource = "mine";
  document.getElementById("ai-deck-select").value = "";
  renderDeck();
  syncMyDeckToLobby();
}

function pickAi() {
  if (ready || spectating) {
    toast(ready ? t("room.deckLockedReady") : t("room.deckLockedSpectate"));
    syncDeckSelectLock();
    return;
  }
  activeSource = "ai";
  document.getElementById("deck-select").value = "";
  renderDeck();
  syncMyDeckToLobby();
}

function humanOpponentName() {
  return [1, 2]
    .map((n) => ({ n, name: seats[n] }))
    .find(({ n, name }) => name && name !== me && !aiSeats.has(n))
    ?.name || null;
}

function enterDuel(matchPayload) {
  if (enteringDuel || leavingRoom || spectating) return;
  if (!matchPayload?.me || !matchPayload?.ai) return;
  enteringDuel = true;
  const payload = { ...matchPayload, localNick: matchPayload.localNick || me, roomId: matchPayload.roomId || roomId };
  saveMatch(payload, me);
  const q = new URLSearchParams({
    pvp: "1",
    room: String(payload.roomId || roomId),
    nick: me,
  });
  location.href = `game.html?${q}`;
}

function matchForMe(remoteMatch) {
  if (!remoteMatch?.players) return null;
  const mine = remoteMatch.players[me];
  const oppKey = remoteMatch.host === me ? remoteMatch.opp : remoteMatch.host;
  const theirs = remoteMatch.players[oppKey];
  if (!mine || !theirs) return null;
  const pvp = remoteMatch.pvp === true || (!remoteMatch.vsAi && !!remoteMatch.host && !!remoteMatch.opp);
  return {
    pvp,
    roomId: remoteMatch.roomId || roomId,
    matchId: remoteMatch.matchId || "",
    host: remoteMatch.host,
    opp: remoteMatch.opp,
    localNick: me,
    players: remoteMatch.players,
    level: remoteMatch.level || 4,
    bot: remoteMatch.bot || "",
    me: mine,
    ai: theirs,
  };
}

async function startDuel() {
  if (!isHost()) {
    toast(t("room.hostOnlyStart"));
    return;
  }
  if (!bothPlayersReady()) {
    toast(t("room.needBothReadyToast"));
    syncGuestChrome();
    return;
  }

  // 시작 직전 서버 방 정보를 다시 읽어 상대 덱이 로컬 동기화에 덮어씌워지지 않게 함
  try {
    lobbyRoomsCache = await fetchRooms();
    const remote = lobbyRoomsCache.find((r) => r.id === roomId);
    if (remote) {
      applyRemoteRoom(remote);
      mergePlayerDecks(remote.playerDecks || {});
    }
  } catch {
    /* ignore */
  }

  const mine = packSelectedDeck();
  if (!mine) {
    toast(t("room.pickMyDeck"));
    return;
  }
  const problems = myDeckProblems();
  if (problems.length) {
    toast(t("room.checkDeck", { list: problems.join(" · ") }));
    syncReadyButton();
    return;
  }
  playerDecks[me] = mine;

  let oppPack = null;
  let level = 4;
  let bot = "";
  let oppName = "";
  let vsAi = false;

  const aiSlot = [...aiSeats.keys()][0];
  if (aiSlot) {
    const info = aiSeats.get(aiSlot);
    const recipe = resolveAiDeckPack(info.deck);
    if (!recipe) {
      toast(t("room.checkAiDeck"));
      return;
    }
    oppPack = { name: recipe.name, summoner: recipe.summoner, main: [...recipe.main] };
    const aiProblems = deckProblems({ summoner: oppPack.summoner ?? null, main: oppPack.main }, rules);
    if (aiProblems.length) {
      toast(t("room.checkAiDeckList", { list: aiProblems.join(" · ") }));
      return;
    }
    const aiRecipe = ai.decks.get(info.deck) || (String(info.deck).startsWith("ai:") ? ai.decks.get(String(info.deck).slice(3)) : null);
    level = info.level || aiRecipe?.level || 4;
    bot = ai.bots[level] || "";
    oppName = seats[aiSlot] || recipe.name;
    vsAi = true;
  } else {
    oppName = humanOpponentName();
    if (!oppName) {
      toast(t("room.noOpponent"));
      return;
    }
    oppPack = deckForPlayer(oppName);
    if (!oppPack) {
      toast(t("room.oppNoDeck"));
      return;
    }
    const oppProblems = deckProblems({ summoner: oppPack.summoner ?? null, main: oppPack.main || [] }, rules);
    if (oppProblems.length) {
      toast(t("room.oppDeckInvalid", { list: oppProblems.join(" · ") }));
      return;
    }
    bot = oppName;
  }

  playerDecks[me] = mine;
  if (oppName && !aiSlot) playerDecks[oppName] = oppPack;

  const matchId = `${roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const remoteMatch = {
    pvp: !vsAi,
    vsAi,
    roomId,
    matchId,
    level,
    bot,
    host: me,
    opp: oppName,
    players: {
      [me]: mine,
      [oppName]: oppPack,
    },
  };
  roomMatch = remoteMatch;
  gameStarted = true;
  preGameSpectators.clear();
  for (const name of spectators) preGameSpectators.add(name);
  await syncLobbyRoom(STATUS_PLAYING);
  enterDuel({
    pvp: !vsAi,
    roomId,
    matchId,
    host: me,
    opp: oppName,
    localNick: me,
    players: remoteMatch.players,
    level,
    bot,
    me: mine,
    ai: oppPack,
  });
}

function isHost() {
  return me === host;
}

function canKick(name) {
  return isHost() && !!name && name !== host;
}

function canSendToSpectate(slot, name) {
  return canKick(name) && !aiSeats.has(slot) && canJoinAsSpectator(name);
}

function hasHumanOpponent() {
  return [1, 2].some((n) => seats[n] && seats[n] !== me && !aiSeats.has(n));
}

function syncAiAddControls() {
  const setup = document.querySelector(".room-ai-setup");
  if (setup) setup.hidden = !isHost();
  const blocked = !isHost() || (hasHumanOpponent() && !aiSeats.size);
  const btn = document.getElementById("add-ai");
  btn.disabled = blocked;
  btn.title = !isHost()
    ? t("room.hostOnlyAddAi")
    : hasHumanOpponent() && !aiSeats.size
      ? t("room.humanBlocksAi")
      : "";
  document.getElementById("opp-ai-level").disabled = blocked;
  document.getElementById("opp-ai-deck").disabled = blocked;
}

function isSeatReady(slot, name) {
  if (!name) return false;
  if (aiSeats.has(slot)) return true;
  return readyPlayers.has(name);
}

function setPlayerReady(name, on) {
  if (!name) return;
  if (on) readyPlayers.add(name);
  else readyPlayers.delete(name);
}

function renderSeats() {
  for (const n of [1, 2]) {
    const name = seats[n];
    const el = document.getElementById(`seat-${n}`);
    const box = document.getElementById(`seat-box-${n}`);
    const mark = document.getElementById(`seat-ready-${n}`);
    const toSpectate = box.querySelector(".room-to-spectate");
    const kick = box.querySelector(".room-kick");
    if (name) {
      el.textContent = name;
      el.classList.remove("empty");
      box.classList.toggle("on", name === me && !spectating);
      mark.hidden = !isSeatReady(n, name);
      toSpectate.hidden = !canSendToSpectate(n, name);
      kick.hidden = !canKick(name);
    } else {
      el.textContent = emptySeat();
      el.classList.add("empty");
      box.classList.remove("on");
      mark.hidden = true;
      toSpectate.hidden = true;
      kick.hidden = true;
    }
  }
  syncAiAddControls();
  syncSpectateButton();
  syncGuestChrome();
}

function renderSpectators() {
  const label = document.querySelector(".room-spectators-label");
  const names = document.getElementById("spectator-names");
  const n = spectators.length;
  label.textContent = t("room.spectators", { n });
  names.replaceChildren(...spectators.map((name) => {
    const chip = document.createElement("span");
    chip.className = "room-spectator-chip";
    chip.append(name);
    if (canKick(name)) {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "room-kick";
      kick.title = t("room.kick");
      kick.setAttribute("aria-label", `${name} ${t("room.kick")}`);
      kick.textContent = "×";
      kick.addEventListener("click", () => kickSpectator(name));
      chip.append(kick);
    }
    return chip;
  }));
}

function aiSeatLabel(level, deckName) {
  const pack = resolveAiDeckPack(deckName);
  if (!pack) return `AI ${botLabel(level)}`;
  if (String(deckName).startsWith("mine:")) {
    return `AI ${botLabel(level)} · ${pack.name}`;
  }
  const recipe = ai.decks.get(pack.name);
  const short = recipe ? aiRecipeLabel(recipe, cards, { short: true }) : pack.name;
  return short ? `AI ${botLabel(level)} · ${short}` : `AI ${botLabel(level)}`;
}

function kickSeat(n) {
  const name = seats[n];
  if (!canKick(name)) {
    if (name === host) toast(t("room.cannotKickHost"));
    return;
  }
  seats[n] = null;
  aiSeats.delete(n);
  setPlayerReady(name, false);
  markKicked(name);
  const si = spectators.indexOf(name);
  if (si >= 0) spectators.splice(si, 1);
  renderSeats();
  renderSpectators();
  syncLobbyRoom();
  toast(t("room.kicked", { name }));
}

function sendSeatToSpectate(n) {
  const name = seats[n];
  if (!canKick(name) || aiSeats.has(n)) {
    if (name === host) toast(t("room.cannotSpectateHost"));
    else if (aiSeats.has(n)) toast(t("room.cannotSpectateAi"));
    return;
  }
  if (!canJoinAsSpectator(name)) {
    toast(t("room.spectateBlockedMid"));
    return;
  }
  seats[n] = null;
  setPlayerReady(name, false);
  if (!spectators.includes(name)) spectators.push(name);
  renderSeats();
  renderSpectators();
  syncLobbyRoom();
  toast(t("room.sentToSpectate", { name }));
}

function fillOppAiLevels() {
  const levelSelect = document.getElementById("opp-ai-level");
  const levels = [...new Set([...ai.decks.values()].map((d) => d.level))].sort((a, b) => a - b);
  const prev = Number(levelSelect.value) || levels[levels.length - 1] || 4;
  levelSelect.replaceChildren(...levels.map((level) => option(String(level), botLabel(level))));
  levelSelect.value = levels.includes(prev) ? String(prev) : String(levels[levels.length - 1] || "");
  fillOppAiDecks();
}

function resolveAiDeckPack(key) {
  if (!key) return null;
  if (String(key).startsWith("mine:")) {
    const name = String(key).slice(5);
    const deck = library.decks[name];
    return deck ? { name, summoner: deck.summoner, main: [...(deck.main || [])] } : null;
  }
  const recipe = ai.decks.get(key) || (String(key).startsWith("ai:") ? ai.decks.get(String(key).slice(3)) : null);
  return recipe ? { name: recipe.name, summoner: recipe.summoner, main: [...(recipe.main || [])] } : null;
}

function fillOppAiDecks() {
  const level = Number(document.getElementById("opp-ai-level").value);
  const deckSelect = document.getElementById("opp-ai-deck");
  const prev = deckSelect.value;
  const levelGroup = document.createElement("optgroup");
  levelGroup.label = botLabel(level);
  const levelRecipes = recipesOf(level);
  levelGroup.append(...levelRecipes.map((d) => option(d.name, aiRecipeLabel(d, cards, { short: true }) || d.name)));

  const otherLevels = [...new Set([...ai.decks.values()].map((d) => d.level))]
    .filter((n) => n !== level)
    .sort((a, b) => a - b);
  const otherGroups = otherLevels.map((n) => {
    const group = document.createElement("optgroup");
    group.label = botLabel(n);
    group.append(...recipesOf(n).map((d) => option(d.name, aiRecipeLabel(d, cards, { short: true }) || d.name)));
    return group;
  });

  const customNames = Object.keys(library.decks).sort((a, b) => a.localeCompare(b, "ko"));
  const nodes = [levelGroup, ...otherGroups];
  if (customNames.length) {
    const custom = document.createElement("optgroup");
    custom.label = t("ai.deckSource.custom");
    custom.append(...customNames.map((name) => option(`mine:${name}`, name)));
    nodes.push(custom);
  }
  deckSelect.replaceChildren(...nodes);

  const valid = new Set([...deckSelect.querySelectorAll("option")].map((o) => o.value));
  if (valid.has(prev)) deckSelect.value = prev;
  else if (levelRecipes[0]) deckSelect.value = levelRecipes[0].name;
  else if (customNames[0]) deckSelect.value = `mine:${customNames[0]}`;
}

function syncAiSeatFromControls(slot) {
  const level = Number(document.getElementById("opp-ai-level").value);
  const deck = document.getElementById("opp-ai-deck").value;
  const pack = resolveAiDeckPack(deck);
  if (!level || !pack) {
    toast(t("room.pickAiLevelDeck"));
    return false;
  }
  seats[slot] = aiSeatLabel(level, deck);
  aiSeats.set(slot, { level, deck });
  return true;
}

function addAi() {
  const existing = [...aiSeats.keys()][0];
  if (existing) {
    if (!syncAiSeatFromControls(existing)) return;
    renderSeats();
    syncLobbyRoom();
    toast(t("room.aiSettingsChanged", { name: seats[existing] }));
    return;
  }
  if (hasHumanOpponent()) {
    toast(t("room.humanBlocksAi"));
    return;
  }
  const slot = !seats[1] ? 1 : !seats[2] ? 2 : 0;
  if (!slot) {
    toast(t("room.noEmptySeat"));
    return;
  }
  if (!syncAiSeatFromControls(slot)) return;
  renderSeats();
  syncLobbyRoom();
  toast(t("room.aiAdded", { name: seats[slot] }));
}

function kickSpectator(name) {
  if (!canKick(name)) {
    if (name === host) toast(t("room.cannotKickHost"));
    return;
  }
  const i = spectators.indexOf(name);
  if (i < 0) return;
  spectators.splice(i, 1);
  markKicked(name);
  renderSpectators();
  renderSeats();
  syncLobbyRoom();
  toast(t("room.kickedFromSpectate", { name }));
}

function leaveDuelSeat() {
  for (const n of [1, 2]) {
    if (seats[n] === me) seats[n] = null;
  }
}

function takeDuelSeat() {
  if (seats[1] === me || seats[2] === me) return;
  if (!seats[1]) seats[1] = me;
  else if (!seats[2]) seats[2] = me;
}

function toggleSpectate() {
  const btn = document.getElementById("spectate");
  if (spectating) {
    const i = spectators.indexOf(me);
    if (i >= 0) spectators.splice(i, 1);
    spectating = false;
    btn.classList.remove("on");
    btn.textContent = t("room.toSpectate");
    takeDuelSeat();
    toast(t("room.leftSpectate"));
  } else {
    if (!canJoinAsSpectator(me)) {
      toast(t("room.spectateBlockedMid"));
      syncSpectateButton();
      return;
    }
    if (!spectators.includes(me)) spectators.push(me);
    spectating = true;
    ready = false;
    setPlayerReady(me, false);
    leaveDuelSeat();
    btn.classList.add("on");
    btn.textContent = t("room.spectating");
    toast(t("room.nowSpectating"));
  }
  renderSpectators();
  renderSeats();
  syncReadyButton();
  syncSpectateButton();
  syncLobbyRoom();
}

function toggleReady() {
  if (spectating) {
    toast(t("room.readyLockedSpectate"));
    return;
  }
  if (!ready) {
    const problems = myDeckProblems();
    if (problems.length) {
      toast(t("room.deckInvalidReady", { list: problems.join(" · ") }));
      syncReadyButton();
      return;
    }
    // 준비할 때 선택 덱을 반드시 방에 올려 둠
    const pack = packSelectedDeck();
    if (pack) playerDecks[me] = pack;
  }
  ready = !ready;
  setPlayerReady(me, ready);
  syncReadyButton();
  renderSeats();
  syncLobbyRoom();
  toast(ready ? t("room.readied") : t("room.unreadied"));
}

async function pollRoom() {
  if (leavingRoom) return;
  try {
    lobbyRoomsCache = await fetchRooms();
    const remote = lobbyRoomsCache.find((r) => r.id === roomId);
    if (!remote) {
      if (!isHost()) forceLeaveRoom(t("room.gone"));
      return;
    }
    if (!isHost() && (remote.kicked || []).includes(me)) {
      forceLeaveRoom(t("room.youWereKicked"));
      return;
    }
    const before = JSON.stringify({
      seats: seatSnapshot(),
      ready: [...readyPlayers].sort(),
      spectators: [...spectators],
      kicked: [...kickedPlayers].sort(),
      ai: aiSnapshot(),
      name: roomName,
      host,
      spectateAllowed,
      status: lobbyStatus(),
    });
    applyRemoteRoom(remote);
    if (
      remote.status === STATUS_PLAYING &&
      remote.match &&
      !spectating &&
      !enteringDuel &&
      (seats[1] === me || seats[2] === me)
    ) {
      const local = matchForMe(remote.match);
      if (local) {
        enterDuel(local);
        return;
      }
    }
    // 방장만 좌석이 비면 다시 앉음. 게스트는 강퇴/퇴장 후 자동 재입장하지 않음.
    let reseated = false;
    if (isHost() && !spectating && seats[1] !== me && seats[2] !== me) {
      seats[1] = me;
      reseated = true;
    }
    const after = JSON.stringify({
      seats: seatSnapshot(),
      ready: [...readyPlayers].sort(),
      spectators: [...spectators],
      kicked: [...kickedPlayers].sort(),
      ai: aiSnapshot(),
      name: roomName,
      host,
      spectateAllowed,
      status: lobbyStatus(),
    });
    if (before !== after) {
      syncRoomHeaderControls();
      renderSeats();
      renderSpectators();
    }
    if (reseated) await syncLobbyRoom();
  } catch {
    /* ignore poll errors */
  }
}

async function fillDecks() {
  const mineSelect = document.getElementById("deck-select");
  const aiSelect = document.getElementById("ai-deck-select");
  ({ cards, rules } = await loadCards());
  library = readLibrary(cards);
  ai = await loadAiDecks(cards);

  const mineNames = Object.keys(library.decks).sort((a, b) => a.localeCompare(b, "ko"));
  mineSelect.replaceChildren(
    option("", t("ai.myDeck")),
    ...mineNames.map((name) => option(name, name)),
  );

  const levels = [...new Set([...ai.decks.values()].map((d) => d.level))].sort((a, b) => b - a);
  aiSelect.replaceChildren(
    option("", t("room.aiDeck")),
    ...levels.flatMap((level) => {
      const group = document.createElement("optgroup");
      group.label = `AI ${botLabel(level)}`;
      group.append(...recipesOf(level).map((d) => option(d.name, aiRecipeLabel(d, cards))));
      return [group];
    }),
  );

  if (library.current && library.decks[library.current]) {
    mineSelect.value = library.current;
    activeSource = "mine";
    aiSelect.value = "";
  } else if (mineNames[0]) {
    mineSelect.value = mineNames[0];
    activeSource = "mine";
  }
  fillOppAiLevels();
  renderDeck();
  syncMyDeckToLobby();
  syncReadyButton();
}

document.getElementById("leave").addEventListener("click", () => {
  gameStarted = false;
  preGameSpectators.clear();
  const goLobby = () => {
    location.href = "server.html";
  };
  if (isHost()) {
    removeLobbyRoom().finally(goLobby);
  } else {
    for (const n of [1, 2]) {
      if (seats[n] === me) seats[n] = null;
    }
    const i = spectators.indexOf(me);
    if (i >= 0) spectators.splice(i, 1);
    setPlayerReady(me, false);
    spectating = false;
    sessionStorage.removeItem(ROOM_ID_STORE);
    Promise.resolve(syncLobbyRoom()).finally(goLobby);
  }
});

document.getElementById("save-room-name").addEventListener("click", saveRoomName);
roomNameInput().addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveRoomName();
});
spectatePolicySelect().addEventListener("change", () => {
  setSpectatePolicy(spectatePolicySelect().value === "allow");
});

document.getElementById("ready").addEventListener("click", toggleReady);
document.getElementById("start").addEventListener("click", () => {
  startDuel().catch((err) => {
    console.error(err);
    toast(t("room.startFail"));
  });
});
document.getElementById("spectate").addEventListener("click", toggleSpectate);
document.getElementById("add-ai").addEventListener("click", addAi);
document.getElementById("opp-ai-level").addEventListener("change", fillOppAiDecks);
document.getElementById("deck-select").addEventListener("change", pickMine);
document.getElementById("ai-deck-select").addEventListener("change", pickAi);

document.querySelectorAll("[data-kick-seat]").forEach((btn) => {
  btn.addEventListener("click", () => kickSeat(Number(btn.dataset.kickSeat)));
});

document.querySelectorAll("[data-to-spectate]").forEach((btn) => {
  btn.addEventListener("click", () => sendSeatToSpectate(Number(btn.dataset.toSpectate)));
});

loadRoomSettingsFromLobby()
  .then(() => {
    syncRoomHeaderControls();
    return syncLobbyRoom();
  })
  .finally(() => {
    syncRoomHeaderControls();
    renderSeats();
    renderSpectators();
    setInterval(() => {
      pollRoom();
    }, 1500);
  });
applyI18n();
fillDecks();
loadSounds().then(() => playBgm("deck"));
