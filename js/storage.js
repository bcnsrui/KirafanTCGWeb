/* Persistent game files.
 *
 * Browser: Cache Storage (origin-fixed). Real %AppData% is not writable from a web page.
 * Exe (Tauri): user-chosen folder (saved in AppData config); integrity checks that folder.
 */

import { CACHE_NAME, cacheKey } from "./update-cache.js";
import { isTauri, invoke } from "./runtime.js";

const CONFIG_KEY = "kirafan-data-path"; // mirror in localStorage for UI

export async function getStoreKind() {
  return isTauri() ? "tauri" : "browser";
}

/** @returns {Promise<string|null>} absolute data root for exe; null on browser */
export async function getDataPath() {
  if (!isTauri()) return null;
  try {
    const path = await invoke("get_data_path");
    if (path) localStorage.setItem(CONFIG_KEY, path);
    return path || null;
  } catch {
    return localStorage.getItem(CONFIG_KEY);
  }
}

export async function setDataPath(path) {
  if (!isTauri()) throw new Error("경로 선택은 프로그램(exe)에서만 가능합니다");
  await invoke("set_data_path", { path });
  localStorage.setItem(CONFIG_KEY, path);
}

export async function defaultDataPath() {
  if (!isTauri()) return null;
  return invoke("default_data_path");
}

/** Folder picker; returns absolute path or null if cancelled */
export async function pickDataFolder() {
  if (!isTauri()) throw new Error("폴더 선택은 프로그램(exe)에서만 가능합니다");
  return invoke("pick_data_folder");
}

export async function ensureDataPathReady() {
  if (!isTauri()) return { kind: "browser", path: null };
  let path = await getDataPath();
  if (path) return { kind: "tauri", path };
  return { kind: "tauri", path: null, needsPick: true };
}

function normalizeRel(rel) {
  const path = String(rel || "").replace(/^\//, "");
  if (path.startsWith("data/") || path.startsWith("pics/") || path.startsWith("sound/")) return path;
  return `data/${path}`;
}

/** @returns {Promise<ArrayBuffer|null>} */
export async function readStored(rel) {
  const path = normalizeRel(rel);
  if (isTauri()) {
    const root = await getDataPath();
    if (!root) return null;
    try {
      const bytes = await invoke("read_data_file", { root, rel: path });
      return new Uint8Array(bytes).buffer;
    } catch {
      return null;
    }
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(path));
    if (!hit) return null;
    return hit.arrayBuffer();
  } catch {
    return null;
  }
}

/** @returns {Promise<string|null>} sha256 hex if file exists */
export async function storedHash(rel) {
  const path = normalizeRel(rel);
  if (isTauri()) {
    const root = await getDataPath();
    if (!root) return null;
    try {
      return await invoke("data_file_sha256", { root, rel: path });
    } catch {
      return null;
    }
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(path));
    if (!hit) return null;
    return hit.headers.get("X-Kirafan-Sha256");
  } catch {
    return null;
  }
}

export async function writeStored(rel, buf, sha256, contentType) {
  const path = normalizeRel(rel);
  if (isTauri()) {
    const root = await getDataPath();
    if (!root) throw new Error("데이터 폴더가 없습니다");
    const bytes = [...new Uint8Array(buf)];
    await invoke("write_data_file", { root, rel: path, bytes });
    return;
  }
  const cache = await caches.open(CACHE_NAME);
  const headers = new Headers();
  headers.set("X-Kirafan-Sha256", sha256);
  headers.set("Content-Type", contentType || "application/octet-stream");
  await cache.put(cacheKey(path), new Response(buf, { status: 200, headers }));
}

export async function hasStored(rel) {
  return (await storedHash(rel)) != null || (await readStored(rel)) != null;
}
