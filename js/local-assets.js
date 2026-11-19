/* Resolve data/pics/sound for browser (cache/SW) vs exe (disk next to .exe).
 * Import this early on every page so fetch() is hooked. */

import { installDataFetchHook, fetchData } from "./update.js?v=i18n39";
import { getDataPath } from "./storage.js";
import { isTauri } from "./runtime.js";
import { assetUrl } from "./config.js";

installDataFetchHook();

let rootCache = null;

export async function dataRoot() {
  if (!isTauri()) return null;
  if (rootCache) return rootCache;
  rootCache = await getDataPath();
  return rootCache;
}

function normalizeRel(rel) {
  const path = String(rel || "").replace(/^\//, "");
  if (path.startsWith("data/") || path.startsWith("pics/") || path.startsWith("sound/")) return path;
  return `data/${path}`;
}

/** URL for <img>/<audio>. Exe → convertFileSrc(disk). Web → relative (SW/cache). */
export async function mediaUrl(rel) {
  const path = normalizeRel(rel);
  if (!isTauri()) return path;
  const root = await dataRoot();
  if (!root) return assetUrl(path);
  const full = `${root.replace(/[/\\]+$/, "")}\\${path.replace(/\//g, "\\")}`;
  const convert = window.__TAURI__?.core?.convertFileSrc;
  if (typeof convert === "function") {
    try {
      return convert(full);
    } catch {
      /* fall through */
    }
  }
  const buf = await (await fetchData(path)).arrayBuffer();
  return URL.createObjectURL(new Blob([buf]));
}

export async function loadJson(rel) {
  const res = await fetchData(rel);
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}
