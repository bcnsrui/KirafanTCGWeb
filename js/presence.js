/* Live concurrent presence: heartbeat while the tab is open; leave on close. */

import { API_BASE } from "./config.js";

const SID_KEY = "kirafan.presence.id";
const INTERVAL_MS = 20000;

function sessionId() {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (id) return id;
    id = (crypto.randomUUID && crypto.randomUUID())
      || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SID_KEY, id);
    return id;
  } catch {
    return `p${Date.now().toString(36)}`;
  }
}

function ping() {
  const id = sessionId();
  fetch(`${API_BASE}/presence/ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: id }),
    keepalive: true,
  }).catch(() => {});
}

function leave() {
  const id = sessionId();
  const body = JSON.stringify({ sessionId: id });
  const url = `${API_BASE}/presence/leave`;
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch { /* fall through */ }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

let started = false;

/** Start heartbeat on this page (idempotent per tab). */
export function startPresence() {
  if (started) return;
  started = true;
  ping();
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    ping();
  }, INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ping();
  });
  // pagehide is more reliable than unload on mobile / bfcache
  window.addEventListener("pagehide", leave);
  window.addEventListener("beforeunload", leave);
}

startPresence();
