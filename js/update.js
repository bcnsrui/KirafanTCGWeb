/* Fetch remote manifest, verify sha-256, download into browser cache or exe data folder. */

import { assetUrl, dataUrl } from "./config.js";
import { CACHE_NAME, cacheKey } from "./update-cache.js";
import { isTauri } from "./runtime.js";
import {
  getDataPath,
  readStored,
  storedHash,
  writeStored,
} from "./storage.js";

export { CACHE_NAME, cacheKey } from "./update-cache.js";

const META_KEY = "kirafan-manifest-meta";

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(buf) {
  return hex(await crypto.subtle.digest("SHA-256", buf));
}

export function metaGet() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "null");
  } catch {
    return null;
  }
}

function metaSet(manifest) {
  localStorage.setItem(META_KEY, JSON.stringify({
    generatedAt: manifest.generatedAt,
    count: Object.keys(manifest.files || {}).length,
    hashes: Object.fromEntries(
      Object.entries(manifest.files || {}).map(([k, v]) => [k, v.sha256]),
    ),
  }));
}

async function loadManifestJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`매니페스트 ${res.status}`);
  const manifest = await res.json();
  if (!manifest || manifest.version !== 1 || !manifest.files) {
    throw new Error("매니페스트 형식 오류");
  }
  return manifest;
}

export async function fetchManifest() {
  const local = new URL("data/manifest.json", location.href).href;
  const remote = dataUrl("manifest.json");
  const remoteOk = remote && remote !== local && !remote.endsWith("data/manifest.json");

  // Exe: GitHub is the source of truth. Browser/dev: prefer same-origin, then remote.
  if (isTauri() && remoteOk) {
    try {
      return await loadManifestJson(remote);
    } catch { /* fall back to bundled stub if offline */ }
    try {
      return await loadManifestJson(local);
    } catch (err) {
      throw err;
    }
  }

  try {
    return await loadManifestJson(local);
  } catch { /* try remote */ }

  if (remoteOk) return loadManifestJson(remote);
  throw new Error("매니페스트를 찾지 못했습니다");
}

/** Current data revision token from the live manifest (not the last-applied meta). */
export async function manifestRevisionToken() {
  try {
    const manifest = await fetchManifest();
    if (manifest?.generatedAt) return `g:${manifest.generatedAt}`;
    if (manifest?.files) return `c:${Object.keys(manifest.files).length}`;
  } catch { /* ignore */ }
  return null;
}

function fileSource(rel, info) {
  return info?.source || (rel.startsWith("pics/") ? "pics" : rel.startsWith("sound/") ? "sound" : "data");
}

function normalizeRel(rel) {
  if (rel.startsWith("data/") || rel.startsWith("pics/") || rel.startsWith("sound/")) return rel;
  return `data/${rel}`;
}

function guessType(rel) {
  if (rel.endsWith(".json")) return "application/json";
  if (rel.endsWith(".bin")) return "application/octet-stream";
  if (rel.endsWith(".jpg") || rel.endsWith(".jpeg")) return "image/jpeg";
  if (rel.endsWith(".png")) return "image/png";
  if (rel.endsWith(".mp3")) return "audio/mpeg";
  if (rel.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {(info: object) => void} onProgress
 * @returns {Promise<object>}
 */
export async function checkAndApplyUpdates(onProgress) {
  const report = (status, message, extra = {}) => {
    const info = { status, message, updated: 0, checked: 0, bytesDone: 0, bytesTotal: 0, ...extra };
    if (onProgress) onProgress(info);
    return info;
  };

  let manifest;
  try {
    manifest = await fetchManifest();
  } catch (err) {
    const prev = metaGet();
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    if (prev) {
      const rev = prev.generatedAt ? `g:${prev.generatedAt}` : prev.count != null ? `c:${prev.count}` : null;
      return report("offline", `갱신 확인 실패 — 이전 데이터로 진행 (${err.message || err})`, { revision: rev });
    }
    return report("error", `갱신 확인 실패: ${err.message || err}`);
  }

  const revision = manifest.generatedAt
    ? `g:${manifest.generatedAt}`
    : `c:${Object.keys(manifest.files || {}).length}`;
  const prev = metaGet();
  // Browser only: same revision → skip re-hash on main-menu returns.
  // Exe always compares file hashes to GitHub and overwrites mismatches.
  if (!isTauri() && prev?.generatedAt && manifest.generatedAt && prev.generatedAt === manifest.generatedAt) {
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    return report("ok", "데이터 최신 (이 브라우저 저장소)", {
      checked: Object.keys(manifest.files || {}).length,
      updated: 0,
      revision,
    });
  }
  const entries = Object.entries(manifest.files);
  if (!entries.length) {
    metaSet(manifest);
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    return report("ok", "받을 파일 없음", { checked: 0, updated: 0, revision });
  }

  const need = [];
  let bytesTotal = 0;
  for (const [rel, info] of entries) {
    const path = normalizeRel(rel);
    const have = await storedHash(path);
    if (!have || have !== info.sha256) {
      // header missing in old cache entries: fall back to re-hash once
      if (have == null) {
        const buf = await readStored(path);
        if (buf) {
          const h = await sha256(buf);
          if (h === info.sha256) {
            await writeStored(path, buf, h, guessType(path));
            continue;
          }
        }
      }
      need.push([path, info, rel]);
      bytesTotal += info.size || 0;
    }
  }

  if (!need.length) {
    metaSet(manifest);
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    const where = isTauri() ? (await getDataPath()) || "데이터 폴더" : "이 브라우저 저장소";
    return report("ok", `데이터 최신 (${where})`, { checked: entries.length, updated: 0, revision });
  }

  let updated = 0;
  let bytesDone = 0;
  for (let i = 0; i < need.length; i++) {
    const [path, info] = need[i];
    onProgress?.({
      status: "downloading",
      message: path,
      checked: entries.length,
      updated,
      current: path,
      index: i + 1,
      total: need.length,
      bytesDone,
      bytesTotal,
      sizeLabel: `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`,
    });
    const source = fileSource(path, info);
    try {
      let url = assetUrl(path, source);
      let res = await fetch(url, { cache: "no-store" });
      if (!res.ok) res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const hash = await sha256(buf);
      if (hash !== info.sha256) throw new Error("무결성 불일치");
      await writeStored(path, buf, hash, res.headers.get("Content-Type") || guessType(path));
      updated++;
      bytesDone += info.size || buf.byteLength;
    } catch (err) {
      if (source === "data" && path.startsWith("data/")) {
        throw new Error(`${path}: ${err.message || err}`);
      }
      console.warn("asset skip", path, err);
      onProgress?.({
        status: "downloading",
        message: `건너뜀 ${path}`,
        checked: entries.length,
        updated,
        index: i + 1,
        total: need.length,
        bytesDone,
        bytesTotal,
        sizeLabel: `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`,
      });
    }
  }

  metaSet(manifest);
  installDataFetchHook();
  await ensureServiceWorker().catch(() => null);
  return report("ok", updated ? `${updated}개 파일 저장 (${formatBytes(bytesDone)})` : "데이터 최신", {
    checked: entries.length,
    updated,
    bytesDone,
    bytesTotal,
    revision,
  });
}

export async function ensureServiceWorker() {
  if (isTauri()) return null; // WebView2 + custom protocol: SW optional
  if (!("serviceWorker" in navigator)) return null;
  // ?v= bumps the script URL so browsers pick up CACHE_NAME changes
  const reg = await navigator.serviceWorker.register("./sw.js?v=5", { scope: "./" });
  await navigator.serviceWorker.ready;
  if (reg.waiting) reg.waiting.postMessage?.({ type: "SKIP_WAITING" });
  return reg;
}

export async function fetchData(relPath, init) {
  const path = normalizeRel(relPath.replace(/^\//, ""));
  const buf = await readStored(path);
  if (buf) return new Response(buf);
  return fetch(assetUrl(path, fileSource(path, {})), init);
}

/** Serve stored packs for same-origin data/pics/sound requests (browser + img/audio via SW). */
export function installDataFetchHook() {
  if (window.__kirafanFetchHook) return;
  window.__kirafanFetchHook = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const u = new URL(url, location.href);
      if ((!init || !init.method || init.method === "GET") && u.origin === location.origin) {
        const p = u.pathname;
        if ((p.includes("/data/") || p.includes("/pics/") || p.includes("/sound/"))
          && !p.endsWith("/manifest.json")) {
          // pathname may be /data/... — map to relative key
          const rel = p.replace(/^.*\/(data|pics|sound)\//, (_, k) => `${k}/`);
          // Localhost: let pics hit the disk server (SW is also network-first for pics).
          // Cached packs still apply for data/sound and for Tauri.
          const isLocalHost = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
          if (isLocalHost && p.includes("/pics/")) return orig(input, init);
          if (isTauri()) {
            const buf = await readStored(rel);
            if (buf) return new Response(buf);
          } else {
            const cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(u.href) || await cache.match(u.href.split("?")[0]);
            if (hit) return hit;
          }
        }
      }
    } catch { /* fall through */ }
    return orig(input, init);
  };
}
