/* Saved games for the replay viewer (replay.html, game.html?replay=<id>): what the board showed after every action
 * and the log's lines, nothing the rules engine works out again - a replay plays the same after the cards' scripts
 * change. A frame keeps only what changed since the one before (diff / apply).
 * Browser: IndexedDB (newest MAX_KEPT). Exe: Replay/{id}.json beside the .exe. */

import { isTauri } from "./runtime.js";
import {
  deleteStored, listStoredDir, readStoredText, writeStoredText,
} from "./storage.js";

export const FORMAT = 1;
export const REPLAY_DIR = "Replay";
const DB_NAME = "kirafan-replays";
const STORE = "replays";
const MAX_KEPT = 50;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** one request on the store; its result once the transaction is done */
async function request(mode, make) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function listReplaysDisk() {
  const files = await listStoredDir(REPLAY_DIR);
  const out = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const text = await readStoredText(`${REPLAY_DIR}/${file}`);
    if (text == null) continue;
    try {
      const replay = JSON.parse(text);
      if (replay && typeof replay === "object") out.push(replay);
    } catch { /* skip bad file */ }
  }
  return out.sort((a, b) => Number(b.id) - Number(a.id));
}

async function getReplayDisk(id) {
  const text = await readStoredText(`${REPLAY_DIR}/${Number(id)}.json`);
  if (text == null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function deleteReplayDisk(id) {
  await deleteStored(`${REPLAY_DIR}/${Number(id)}.json`);
}

async function saveReplayDisk(replay) {
  const all = await listReplaysDisk();
  const taken = new Set(all.map((r) => Number(r.id)));
  let id = Number(replay.id) || Date.now();
  while (taken.has(id)) id++;
  const saved = { ...replay, id };
  await writeStoredText(`${REPLAY_DIR}/${id}.json`, JSON.stringify(saved));
  const next = await listReplaysDisk();
  for (const old of next.slice(MAX_KEPT)) await deleteReplayDisk(old.id);
  return id;
}

/** the saved replays, newest first */
export async function listReplays() {
  if (isTauri()) return listReplaysDisk();
  const all = await request("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export async function getReplay(id) {
  if (isTauri()) return getReplayDisk(id);
  return request("readonly", (s) => s.get(Number(id)));
}

export async function deleteReplay(id) {
  if (isTauri()) return deleteReplayDisk(id);
  return request("readwrite", (s) => s.delete(Number(id)));
}

/** keeps a replay (a new id if it has none, or its id is taken - an imported file); the oldest past MAX_KEPT go */
export async function saveReplay(replay) {
  if (isTauri()) return saveReplayDisk(replay);
  const taken = new Set((await listReplays()).map((r) => r.id));
  let id = Number(replay.id) || Date.now();
  while (taken.has(id)) id++;
  const saved = { ...replay, id };
  await request("readwrite", (s) => s.put(saved));
  const all = await listReplays();
  for (const old of all.slice(MAX_KEPT)) await deleteReplay(old.id);
  return id;
}

/** whether a file's content is a replay this viewer reads */
export function isReplay(x) {
  return !!x && x.format === FORMAT && Array.isArray(x.frames) && x.frames.length > 0;
}

// ---- frames ----------------------------------------------------------------------
const TOP = ["turn", "phase", "turnPlayer"];
const SIDES = ["me", "op"];

/** what changed from prev to state (state itself for the first frame); null: nothing */
export function diff(prev, state) {
  if (!prev) return state;
  const out = {};
  for (const k of TOP) if (prev[k] !== state[k]) out[k] = state[k];
  for (const side of SIDES) {
    const changed = {};
    for (const k of Object.keys(state[side])) {
      if (JSON.stringify(prev[side][k]) !== JSON.stringify(state[side][k])) changed[k] = state[side][k];
    }
    if (Object.keys(changed).length) out[side] = changed;
  }
  return Object.keys(out).length ? out : null;
}

function apply(prev, change) {
  if (!prev) return change;
  const out = { ...prev };
  for (const k of TOP) if (k in change) out[k] = change[k];
  for (const side of SIDES) out[side] = { ...prev[side], ...(change[side] || {}) };
  return out;
}

/** every frame's whole state, and its log lines */
export function unpack(replay) {
  const states = [];
  let state = null;
  for (const f of replay.frames) {
    state = apply(state, f.s);
    states.push(state);
  }
  return { states, lines: replay.frames.map((f) => f.l || []) };
}
