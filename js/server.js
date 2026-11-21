import { toast } from "./ui.js";
import { loadSounds, playBgm } from "./sound.js";
import { fetchRooms, nickTakenInLobby, normalizeRooms, upsertRoom } from "./lobby-rooms.js";
import { beaconPvpAway, fetchPvpDuel } from "./pvp.js?v=awayNick1";
import { applyI18n, roomStatusLabel, t } from "./ui-i18n.js?v=i18n47";

const NICK_STORE = "kirafan.server.nick";
const ROOM_ID_STORE = "kirafan.room.id";
const ROOM_NAME_STORE = "kirafan.room.name";
const ROOM_GATE_STORE = "kirafan.room.gate"; // `${roomId}:${nick}` after a valid enter/create
const PVP_LIVE_KEY = "kirafan.pvp.live";
const PVP_SOFT_RESUME_KEY = "kirafan.pvp.softResume";
const PVP_LANG_RELOAD_KEY = "kirafan.pvp.langReload";
const NICK_MAX = 20;
const STATUS_WAITING = "대기중";

/** 대전 페이지를 떠나 로비로 온 경우: away 유지(재입장 가능), soft 플래그만 정리 */
function finalizeAbandonedDuel() {
  let roomId = "";
  try {
    roomId = sessionStorage.getItem(PVP_SOFT_RESUME_KEY)
      || sessionStorage.getItem(PVP_LANG_RELOAD_KEY)
      || sessionStorage.getItem(PVP_LIVE_KEY)
      || "";
  } catch { /* ignore */ }
  if (!roomId) return;
  const nick = clampNick(
    sessionStorage.getItem(NICK_STORE) || localStorage.getItem(NICK_STORE) || "",
  );
  if (nick) beaconPvpAway(roomId, nick);
  try {
    sessionStorage.removeItem(PVP_SOFT_RESUME_KEY);
    sessionStorage.removeItem(PVP_LANG_RELOAD_KEY);
    sessionStorage.removeItem(PVP_LIVE_KEY);
  } catch { /* ignore */ }
}

/** @type {any[]} */
let roomsCache = [];
/** @type {string | null} */
let selectedId = null;

function defaultNick() {
  return t("common.defaultNick");
}

function defaultRoomName() {
  return t("server.defaultRoom");
}

function nickInput() {
  return document.getElementById("nickname");
}

function clampNick(value) {
  return (value || "").trim().slice(0, NICK_MAX) || defaultNick();
}

function currentNick() {
  return clampNick(nickInput().value);
}

function loadNick() {
  const saved = localStorage.getItem(NICK_STORE);
  nickInput().value = clampNick(saved || nickInput().value);
}

function saveNick() {
  const nick = currentNick();
  nickInput().value = nick;
  localStorage.setItem(NICK_STORE, nick);
  toast(t("toast.nickSaved"));
}

function renderRooms() {
  const rooms = normalizeRooms(roomsCache);
  document.getElementById("room-count").textContent = t("server.rooms", { n: rooms.length });
  const tbody = document.getElementById("room-list");
  if (!rooms.length) {
    selectedId = null;
    const empty = document.createElement("tr");
    empty.className = "room-empty";
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = t("server.empty");
    empty.append(td);
    tbody.replaceChildren(empty);
    return;
  }

  if (!rooms.some((room) => room.id === selectedId)) selectedId = rooms[0].id;

  tbody.replaceChildren(...rooms.map((room) => {
    const tr = document.createElement("tr");
    tr.dataset.id = room.id;
    tr.classList.toggle("on", room.id === selectedId);
    tr.title = t("server.dblclick");
    const ban = room.banlist === "없음" ? t("common.none") : room.banlist;
    const status = roomStatusLabel(room.status);
    for (const text of [ban, room.name, room.summoners, status]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tr.addEventListener("click", () => {
      selectedId = room.id;
      renderRooms();
    });
    tr.addEventListener("dblclick", () => {
      selectedId = room.id;
      enterSelectedRoom().catch(() => toast(t("server.toast.enterFail")));
    });
    return tr;
  }));
}

async function refreshRooms({ quiet = false } = {}) {
  roomsCache = await fetchRooms();
  renderRooms();
  if (!quiet) toast(t("server.toast.refreshed"));
}

function persistNick() {
  const nick = currentNick();
  nickInput().value = nick;
  localStorage.setItem(NICK_STORE, nick);
  sessionStorage.setItem(NICK_STORE, nick);
  return nick;
}

function selectedRoom() {
  return normalizeRooms(roomsCache).find((room) => room.id === selectedId) || null;
}

function roomGate(roomId, nick) {
  return `${roomId}:${nick}`;
}

function markRoomGate(roomId, nick) {
  sessionStorage.setItem(ROOM_GATE_STORE, roomGate(roomId, nick));
}

async function enterSelectedRoom() {
  const nick = persistNick();
  try {
    roomsCache = await fetchRooms();
    renderRooms();
  } catch { /* use cache */ }
  const room = selectedRoom();
  if (!room) {
    toast(t("server.toast.noRooms"));
    return;
  }
  const gateOk = sessionStorage.getItem(ROOM_GATE_STORE) === roomGate(room.id, nick);
  // 진행 중 이탈자(away) 닉만 플레이어 재입장 허용. 남아 있는 플레이어 닉 도용 금지.
  let awayNick = "";
  if (room.status === "게임중") {
    try {
      const duel = await fetchPvpDuel(room.id);
      awayNick = String(duel?.away || "").trim();
    } catch { /* ignore */ }
  }
  const awayReclaim = !!(awayNick && nick === awayNick);
  const canEnterAsPlayer = gateOk || awayReclaim;
  if (nickTakenInLobby(roomsCache, nick, { exceptRoomId: canEnterAsPlayer ? room.id : null })) {
    toast(t("server.toast.nickTaken"));
    return;
  }
  sessionStorage.setItem(ROOM_ID_STORE, room.id);
  sessionStorage.setItem(ROOM_NAME_STORE, room.name);
  markRoomGate(room.id, nick);
  // 진행 중: away 닉(또는 본인 gate)만 플레이어 / 그 외는 관전
  if (room.status === "게임중") {
    const q = new URLSearchParams({
      pvp: "1",
      room: String(room.id),
      nick,
    });
    if (!canEnterAsPlayer) q.set("spectate", "1");
    location.href = `game.html?${q}`;
    return;
  }
  location.href = "room.html";
}

async function createRoom() {
  const nick = persistNick();
  try {
    roomsCache = await fetchRooms();
    renderRooms();
  } catch { /* use cache */ }
  if (nickTakenInLobby(roomsCache, nick)) {
    toast(t("server.toast.nickTaken"));
    return;
  }
  const name = (sessionStorage.getItem(ROOM_NAME_STORE) || defaultRoomName()).slice(0, 20);
  const now = Date.now();
  const room = {
    id: `room-${now}`,
    banlist: "없음",
    name,
    summoners: nick,
    host: nick,
    seats: { 1: nick, 2: null },
    ready: [],
    spectators: [],
    ai: null,
    status: STATUS_WAITING,
    locked: false,
    spectateAllowed: true,
    updatedAt: now,
  };
  roomsCache = await upsertRoom(room);
  selectedId = room.id;
  sessionStorage.setItem(ROOM_ID_STORE, room.id);
  sessionStorage.setItem(ROOM_NAME_STORE, name);
  markRoomGate(room.id, nick);
  location.href = "room.html";
}

applyI18n();
document.getElementById("back").addEventListener("click", () => {
  location.href = "index.html?v=i18n3";
});

document.getElementById("save-nick").addEventListener("click", saveNick);
document.getElementById("refresh").addEventListener("click", () => {
  refreshRooms().catch(() => toast(t("server.toast.refreshFail")));
});
document.getElementById("enter").addEventListener("click", () => {
  enterSelectedRoom().catch(() => toast(t("server.toast.enterFail")));
});
document.getElementById("create-room").addEventListener("click", () => {
  createRoom().catch(() => toast(t("server.toast.createFail")));
});

finalizeAbandonedDuel();
loadNick();
refreshRooms({ quiet: true }).catch(() => {
  roomsCache = [];
  renderRooms();
});
loadSounds().then(() => playBgm("deck"));
