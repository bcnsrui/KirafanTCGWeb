/* Deploy / share settings. Override at runtime via localStorage keys of the same name,
 * or by editing this file before a release. */

import { isTauri } from "./runtime.js";

const stored = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === "" ? fallback : v;
  } catch {
    return fallback;
  }
};

/** App shell version (exe / menu). Data version lives in data/manifest.json. */
export const VERSION = "0.1.0";

/**
 * GitHub raw bases (bcnsrui). Large packs download from here into Cache Storage / exe data folder.
 * - data: web-built JSON/model — upload to KirafanTCG/web/ (see DEPLOY.md)
 * - pics / sound: already on GitHub
 */
export const REPOS = {
  data: stored(
    "updateBaseData",
    "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main/web",
  ),
  pics: stored(
    "updateBasePics",
    "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
  ),
  sound: stored(
    "updateBaseSound",
    "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main",
  ),
};

/**
 * Base URL for data/ updates (no trailing slash).
 * Empty: same origin. Default: KirafanTCG/web on GitHub.
 */
export const UPDATE_BASE = stored("updateBase", REPOS.data);

/**
 * Match-record / auth / lobby / duel API base (no trailing slash).
 * Local: tools/api_server.py on 8787. Production (Railway): same origin ("").
 */
function defaultApiBase() {
  try {
    const h = location.hostname;
    if (h === "127.0.0.1" || h === "localhost" || h === "[::1]") {
      return "http://127.0.0.1:8787";
    }
  } catch {
    /* ignore */
  }
  return "";
}
export const API_BASE = stored("apiBase", defaultApiBase());

/** Google Identity Services client id (OAuth web client). Empty: login button explains setup. */
export const GOOGLE_CLIENT_ID = stored("googleClientId", "");

/**
 * Windows exe installer / portable download (Google Drive etc.).
 * Empty: header icon shows “준비 중”. Set via localStorage exeDownloadUrl or this default.
 */
export const EXE_DOWNLOAD_URL = stored("exeDownloadUrl", "");

/** Resolve a manifest path (e.g. data/cards.json, pics/10051111.jpg, sound/BGM/…) to a fetch URL. */
export function assetUrl(relPath, source) {
  const path = relPath.replace(/^\//, "");
  const kind = source || guessSource(path);
  if (kind === "local" || !REPOS[kind]) {
    return path;
  }
  // Override: localStorage updateUseLocal=1 (force same-origin) or =0 (force remote).
  // Exe always pulls from GitHub unless forced local. Browser localhost keeps disk files.
  const useLocalFlag = stored("updateUseLocal", "");
  if (useLocalFlag === "1") return path;
  if (!isTauri() && useLocalFlag !== "0") {
    try {
      const h = location.hostname;
      if (h === "127.0.0.1" || h === "localhost" || h === "[::1]") return path;
    } catch { /* ignore */ }
  }

  const base = (kind === "data" ? UPDATE_BASE : REPOS[kind]).replace(/\/$/, "");
  if (!base) return path;

  if (kind === "data") {
    // web-built data/, and web-only pics/small/ (thumbnails not on KirafanTCGpics)
    if (path.startsWith("pics/")) return `${base}/${path}`;
    const rest = path.replace(/^data\//, "");
    return `${base}/data/${rest}`;
  }
  if (kind === "pics") {
    // KirafanTCGpics root already contains pics/
    const rest = path.startsWith("pics/") ? path : `pics/${path}`;
    return `${base}/${rest}`;
  }
  if (kind === "sound") {
    // repo root IS the sound folder contents (BGM/, summon/, *.wav)
    const rest = path.replace(/^sound\//, "");
    return `${base}/${rest}`;
  }
  return `${base}/${path}`;
}

function guessSource(path) {
  if (path.startsWith("pics/") || path.startsWith("pics\\")) return "pics";
  if (path.startsWith("sound/") || path.startsWith("sound\\")) return "sound";
  if (path.startsWith("data/") || path.startsWith("data\\") || !path.includes("/")) return "data";
  return "local";
}

/** @deprecated use assetUrl — kept for older calls */
export function dataUrl(relPath) {
  const path = relPath.replace(/^\//, "");
  const full = path.startsWith("data/") ? path : `data/${path}`;
  return assetUrl(full, "data");
}
