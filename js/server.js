import { toast } from "./ui.js";
import { loadSounds, playBgm } from "./sound.js";
import { fetchRooms, normalizeRooms, upsertRoom } from "./lobby-rooms.js";
import { applyI18n, roomStatusLabel, t } from "./ui-i18n.js?v=i18n4";

const NICK_STORE = "kirafan.server.nick";
const ROOM_ID_STORE = "kirafan.room.id";
const ROOM_NAME_STORE = "kirafan.room.name";
const NICK_MAX = 10;
const STATUS_WAITING = "대기중";

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
      enterSelectedRoom();
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

function enterSelectedRoom() {
  persistNick();
  const room = selectedRoom();
  if (!room) {
    toast(t("server.toast.noRooms"));
    return;
  }
  sessionStorage.setItem(ROOM_ID_STORE, room.id);
  sessionStorage.setItem(ROOM_NAME_STORE, room.name);
  location.href = "room.html";
}

async function createRoom() {
  const nick = persistNick();
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
document.getElementById("enter").addEventListener("click", enterSelectedRoom);
document.getElementById("create-room").addEventListener("click", () => {
  createRoom().catch(() => toast(t("server.toast.createFail")));
});

loadNick();
refreshRooms({ quiet: true }).catch(() => {
  roomsCache = [];
  renderRooms();
});
loadSounds().then(() => playBgm("deck"));
