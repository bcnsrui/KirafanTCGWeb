import { API_BASE } from "./config.js";

const ROOMS_STORE = "kirafan.server.rooms";
const MAX_ROOMS = 30;

function roomTime(room) {
  return Number(room?.updatedAt) || Number(String(room?.id || "").replace(/\D/g, "")) || 0;
}

function normalizeSeats(seats, host, summoners) {
  const next = { 1: null, 2: null };
  if (seats && typeof seats === "object") {
    if (seats[1] || seats["1"]) next[1] = String(seats[1] || seats["1"]);
    if (seats[2] || seats["2"]) next[2] = String(seats[2] || seats["2"]);
  }
  if (!next[1] && host) next[1] = String(host);
  if (!next[1] && summoners) {
    const parts = String(summoners).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts[0]) next[1] = parts[0];
    if (parts[1]) next[2] = parts[1];
  }
  return next;
}

/** @param {any[]} list */
export function normalizeRooms(list) {
  const byId = new Map();
  for (const room of list) {
    if (!room || !room.id) continue;
    const status = room.status === "게임중" ? "게임중" : "대기중";
    const host = room.host || String(room.summoners || "").split(",")[0].trim() || "";
    const seats = normalizeSeats(room.seats, host, room.summoners);
    const humans = [seats[1], seats[2]].filter(Boolean);
    const next = {
      id: String(room.id),
      banlist: room.banlist || "없음",
      name: String(room.name || "키라판의 방").slice(0, 20),
      summoners: humans.length ? humans.join(", ") : host || "-",
      host,
      seats,
      ready: Array.isArray(room.ready) ? room.ready.map(String) : [],
      spectators: Array.isArray(room.spectators) ? room.spectators.map(String) : [],
      kicked: Array.isArray(room.kicked) ? room.kicked.map(String) : [],
      ai: room.ai && typeof room.ai === "object" ? room.ai : null,
      playerDecks: room.playerDecks && typeof room.playerDecks === "object" ? room.playerDecks : {},
      match: room.match && typeof room.match === "object" ? room.match : null,
      status,
      locked: !!room.locked,
      spectateAllowed: room.spectateAllowed !== false,
      updatedAt: roomTime(room) || Date.now(),
    };
    const prev = byId.get(next.id);
    if (!prev || next.updatedAt >= prev.updatedAt) byId.set(next.id, next);
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ROOMS);
}

function readLocal() {
  try {
    const list = JSON.parse(sessionStorage.getItem(ROOMS_STORE) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(rooms) {
  sessionStorage.setItem(ROOMS_STORE, JSON.stringify(normalizeRooms(rooms)));
}

async function api(path, init) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`rooms api ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

/** 공유 API에서 방 목록을 가져옵니다. 실패 시 로컬 캐시. */
export async function fetchRooms() {
  try {
    const data = await api("/rooms");
    const rooms = normalizeRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    writeLocal(rooms);
    return rooms;
  } catch {
    return normalizeRooms(readLocal());
  }
}

/** 방 하나를 공유 목록에 올리거나 갱신합니다. */
export async function upsertRoom(room) {
  const next = normalizeRooms([room])[0];
  if (!next) return normalizeRooms(readLocal());
  try {
    const data = await api("/rooms", {
      method: "POST",
      body: JSON.stringify({ room: next }),
    });
    const rooms = normalizeRooms(Array.isArray(data?.rooms) ? data.rooms : [next, ...readLocal()]);
    writeLocal(rooms);
    return rooms;
  } catch {
    const rooms = normalizeRooms([next, ...readLocal().filter((r) => r.id !== next.id)]);
    writeLocal(rooms);
    return rooms;
  }
}

/** 공유 목록에서 방을 삭제합니다. */
export async function deleteRoom(id) {
  const roomId = String(id || "");
  try {
    const data = await api(`/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
    const rooms = normalizeRooms(Array.isArray(data?.rooms) ? data.rooms : readLocal().filter((r) => r.id !== roomId));
    writeLocal(rooms);
    return rooms;
  } catch {
    const rooms = normalizeRooms(readLocal().filter((r) => r.id !== roomId));
    writeLocal(rooms);
    return rooms;
  }
}
