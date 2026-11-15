/* Saved games for the replay viewer (replay.html, game.html?replay=<id>): what the board showed after every action
 * and the log's lines, nothing the rules engine works out again - a replay plays the same after the cards' scripts
 * change. A frame keeps only what changed since the one before (diff / apply). In IndexedDB, the newest MAX_KEPT. */

export const FORMAT = 1;
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

/** the saved replays, newest first */
export async function listReplays() {
  const all = await request("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export const getReplay = (id) => request("readonly", (s) => s.get(Number(id)));
export const deleteReplay = (id) => request("readwrite", (s) => s.delete(Number(id)));

/** keeps a replay (a new id if it has none, or its id is taken - an imported file); the oldest past MAX_KEPT go */
export async function saveReplay(replay) {
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
