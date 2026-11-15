/* Match records (전적) only — decks / settings / replays stay on this PC.
 *
 * Schema (MatchRecord):
 * {
 *   clientId: string,     // uuid from this device (dedupe)
 *   result: "승리" | "패배" | "무승부" | "항복",
 *   level: number,        // AI level (0 if unknown)
 *   bot: string,          // bot label
 *   turns: number,
 *   playedAt: string,     // ISO-8601
 *   myDeck: string,       // deck name only (not the card list)
 *   aiDeck: string,
 *   deckHash: string      // optional sha-256 of sorted main codes (privacy-light)
 * }
 */

import { apiFetch, getSession } from "./auth.js";

const QUEUE_KEY = "kirafan-record-queue";

export function makeMatchRecord({ result, level = 0, bot = "", turns = 0, myDeck = "", aiDeck = "", deckHash = "" }) {
  return {
    clientId: crypto.randomUUID(),
    result: String(result || ""),
    level: Number(level) || 0,
    bot: String(bot || ""),
    turns: Number(turns) || 0,
    playedAt: new Date().toISOString(),
    myDeck: String(myDeck || ""),
    aiDeck: String(aiDeck || ""),
    deckHash: String(deckHash || ""),
  };
}

/** SHA-256 hex of sorted main-deck codes (no full deck upload). */
export async function hashDeckCodes(codes) {
  const text = (codes || []).map(Number).filter(Boolean).sort((a, b) => a - b).join(",");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-40)));
}

/** Upload now if logged in; otherwise queue until next login flush. */
export async function submitMatchRecord(record) {
  if (!getSession()?.token) {
    const q = loadQueue();
    q.push(record);
    saveQueue(q);
    return { queued: true };
  }
  try {
    const res = await apiFetch("/matches", {
      method: "POST",
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(await res.text());
    return { queued: false, data: await res.json() };
  } catch (err) {
    const q = loadQueue();
    q.push(record);
    saveQueue(q);
    return { queued: true, error: err.message };
  }
}

export async function flushMatchQueue() {
  if (!getSession()?.token) return 0;
  const q = loadQueue();
  if (!q.length) return 0;
  const left = [];
  let ok = 0;
  for (const record of q) {
    try {
      const res = await apiFetch("/matches", {
        method: "POST",
        body: JSON.stringify(record),
      });
      if (res.ok || res.status === 409) ok++;
      else left.push(record);
    } catch {
      left.push(record);
    }
  }
  saveQueue(left);
  return ok;
}

export async function fetchMatchSummary() {
  const res = await apiFetch("/matches/summary");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMatchList(limit = 50) {
  const res = await apiFetch(`/matches?limit=${limit}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
