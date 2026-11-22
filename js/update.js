/* Fetch remote manifest, verify sha-256, download into browser cache or exe data folder. */

import { assetUrl, dataUrl, shellFileUrl, shellManifestUrl } from "./config.js";
import { CACHE_NAME, cacheKey } from "./update-cache.js";
import { isTauri, invoke } from "./runtime.js";
import {
  getDataPath,
  readStored,
  storedHash,
  writeStored,
} from "./storage.js";

const SHELL_META_KEY = "kirafan-shell-manifest-meta";

export { CACHE_NAME, cacheKey } from "./update-cache.js";

const META_KEY = "kirafan-manifest-meta";

/** raw.githubusercontent.com CDN often serves stale blobs; bust with a query param. */
function bustRemoteCache(url) {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!/githubusercontent\.com$/i.test(u.hostname) && u.hostname !== "cdn.jsdelivr.net") {
      return url;
    }
    u.searchParams.set("_kb", String(Date.now()));
    return u.href;
  } catch {
    return url;
  }
}

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

function metaSet(manifest, extra = {}) {
  const prev = metaGet() || {};
  localStorage.setItem(META_KEY, JSON.stringify({
    generatedAt: manifest.generatedAt,
    count: Object.keys(manifest.files || {}).length,
    hashes: Object.fromEntries(
      Object.entries(manifest.files || {}).map(([k, v]) => [k, v.sha256]),
    ),
    packs: extra.packs !== undefined ? extra.packs : (prev.packs || {}),
  }));
}

/** Live / exe / force-remote: prefer zip packs. Localhost disk stays file-by-file skip. */
function useAssetPacks(forceRemote) {
  if (isTauri()) return true;
  if (forceRemote) return true;
  return !isLocalDevHost();
}

function packNameForPath(path) {
  if (path.startsWith("sound/")) return "sound";
  if (path.startsWith("pics/small/")) return "data";
  if (path.startsWith("pics/")) return "pics";
  if (path.startsWith("data/")) return "data";
  return null;
}

function packUrl(manifest, packInfo) {
  const base = (manifest.sources?.packs || REPOS_FALLBACK_PACKS).replace(/\/$/, "");
  const file = String(packInfo.file || "").replace(/^\//, "");
  return `${base}/${file}`;
}

const REPOS_FALLBACK_PACKS = "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main";

async function downloadAndApplyPack(manifest, name, packInfo, onProgress) {
  const { unzipSync } = await import("./vendor/fflate.js");
  const url = bustRemoteCache(packUrl(manifest, packInfo));
  onProgress?.({
    status: "downloading",
    message: `팩 다운로드 ${name}.zip`,
    current: packInfo.file,
    sizeLabel: formatBytes(packInfo.size || 0),
  });
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`pack ${name} HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const hash = await sha256(buf.buffer);
  if (packInfo.sha256 && hash !== packInfo.sha256) {
    throw new Error(`pack ${name} 무결성 불일치`);
  }
  onProgress?.({
    status: "downloading",
    message: `팩 압축 해제 ${name}.zip`,
    current: packInfo.file,
  });
  const files = unzipSync(buf);
  let written = 0;
  const entries = Object.entries(files);
  for (let i = 0; i < entries.length; i++) {
    const [nameInZip, data] = entries[i];
    if (!data || !data.length) continue; // skip dirs
    const path = normalizeRel(nameInZip.replace(/^\/+/, ""));
    if (!(path.startsWith("data/") || path.startsWith("pics/") || path.startsWith("sound/"))) {
      continue;
    }
    const expect = manifest.files?.[path];
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const fileHash = await sha256(ab);
    if (expect?.sha256 && fileHash !== expect.sha256) {
      throw new Error(`${path}: pack 내 무결성 불일치`);
    }
    await writeStored(path, ab, fileHash, guessType(path));
    written++;
    if (i % 20 === 0 || i + 1 === entries.length) {
      onProgress?.({
        status: "downloading",
        message: `팩 저장 ${name} ${i + 1}/${entries.length}`,
        current: path,
        updated: written,
      });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { written, hash };
}

async function loadManifestJson(url) {
  const res = await fetch(bustRemoteCache(url), { cache: "no-store" });
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
  // Absolute http(s) only. (이전 endsWith("data/manifest.json") 조건은
  // 깃허브 raw URL까지 remoteOk=false 로 막아 배포에서 매니페스트를 못 찾았음)
  const remoteOk = /^https?:\/\//i.test(remote || "") && remote !== local;

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
function isLocalDevHost() {
  try {
    const h = location.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
  } catch {
    return false;
  }
}

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
  // Always compare per-file hashes (web + exe). Skipping when generatedAt matched
  // left stale EN/JA cards.json in Cache Storage while KO looked current.
  const entries = Object.entries(manifest.files);
  if (!entries.length) {
    metaSet(manifest);
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    return report("ok", "받을 파일 없음", { checked: 0, updated: 0, revision });
  }

  // Local web_server: files are already on disk — don't fill Cache Storage / re-hash hundreds of pics.
  // (Force remote integrity with localStorage updateUseLocal=0.)
  let forceRemote = false;
  try { forceRemote = localStorage.getItem("updateUseLocal") === "0"; } catch { /* ignore */ }
  if (!isTauri() && isLocalDevHost() && !forceRemote) {
    metaSet(manifest);
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);
    return report("ok", "로컬 개발 — 디스크 파일 사용", {
      checked: entries.length,
      updated: 0,
      revision,
    });
  }

  const need = [];
  let bytesTotal = 0;
  for (let i = 0; i < entries.length; i++) {
    const [rel, info] = entries[i];
    if (i % 8 === 0 || i + 1 === entries.length) {
      onProgress?.({
        status: "checking",
        message: `파일 확인 중… ${i + 1} / ${entries.length}`,
        checked: i + 1,
        index: i + 1,
        total: entries.length,
        current: normalizeRel(rel),
      });
      // Yield so the boot UI can paint
      await new Promise((r) => setTimeout(r, 0));
    }
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
  const packHashes = { ...(prev?.packs || {}) };
  const packs = manifest.packs || {};
  /** Missing ≤ this many files in a pack → fetch those files one-by-one (not the whole zip). */
  const PACK_FILE_THRESHOLD = 20;

  // Live: zip pack only when many files in that pack are missing/outdated.
  // Small diffs (e.g. ≤20) stay per-file so a tiny update does not re-download 30–90MB.
  if (useAssetPacks(forceRemote) && Object.keys(packs).length) {
    const missingByPack = {};
    for (const [path] of need) {
      const pn = packNameForPath(path);
      if (!pn || !packs[pn]) continue;
      (missingByPack[pn] ||= []).push(path);
    }
    for (const [name, paths] of Object.entries(missingByPack)) {
      const packInfo = packs[name];
      if (!packInfo?.file || !packInfo?.sha256) continue;
      if (paths.length <= PACK_FILE_THRESHOLD) {
        onProgress?.({
          status: "downloading",
          message: `${name}: 변경 ${paths.length}개 → 개별 다운로드`,
          current: packInfo.file,
          updated,
        });
        continue;
      }
      try {
        const result = await downloadAndApplyPack(manifest, name, packInfo, onProgress);
        packHashes[name] = result.hash || packInfo.sha256;
        updated += result.written;
        bytesDone += packInfo.size || 0;
      } catch (err) {
        console.warn(`pack ${name} failed, falling back to files:`, err);
      }
    }
    // Recompute leftovers after packs
    const still = [];
    for (const row of need) {
      const [path, info] = row;
      const have = await storedHash(path);
      if (!have || have !== info.sha256) still.push(row);
    }
    need.length = 0;
    need.push(...still);
    bytesTotal = need.reduce((s, [, info]) => s + (info.size || 0), 0);
  }

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
    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let url = bustRemoteCache(assetUrl(path, source));
        let res = await fetch(url, { cache: "no-store" });
        if (!res.ok) res = await fetch(path, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const hash = await sha256(buf);
        if (hash !== info.sha256) throw new Error("무결성 불일치");
        await writeStored(path, buf, hash, res.headers.get("Content-Type") || guessType(path));
        updated++;
        bytesDone += info.size || buf.byteLength;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        onProgress?.({
          status: "downloading",
          message: attempt < maxAttempts ? `재시도 ${path}` : path,
          checked: entries.length,
          updated,
          current: path,
          index: i + 1,
          total: need.length,
          bytesDone,
          bytesTotal,
          sizeLabel: `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`,
        });
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (lastErr) {
      throw new Error(`${path}: ${lastErr.message || lastErr}`);
    }
  }

  metaSet(manifest, { packs: packHashes });
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

/** True when the window is already served from the on-disk shell overlay. */
export function isDiskShell() {
  try {
    const h = location.hostname || "";
    return h === "kirafanshell.localhost" || h.endsWith(".kirafanshell.localhost");
  } catch {
    return false;
  }
}

function shellMetaGet() {
  try {
    return JSON.parse(localStorage.getItem(SHELL_META_KEY) || "null");
  } catch {
    return null;
  }
}

function shellMetaSet(manifest) {
  localStorage.setItem(SHELL_META_KEY, JSON.stringify({
    generatedAt: manifest.generatedAt,
    count: Object.keys(manifest.files || {}).length,
    hashes: Object.fromEntries(
      Object.entries(manifest.files || {}).map(([k, v]) => [k, v.sha256]),
    ),
  }));
}

/**
 * Exe only: compare KirafanTCGWeb shell-manifest and write changed files under www/.
 * Returns { updated, checked, needReload, revision, status, message }.
 */
export async function checkAndApplyShellUpdates(onProgress) {
  const report = (status, message, extra = {}) => {
    const info = { status, message, updated: 0, checked: 0, needReload: false, ...extra };
    onProgress?.(info);
    return info;
  };
  if (!isTauri()) {
    return report("ok", "브라우저 — 껍데기는 배포 서버를 따름");
  }

  let manifest;
  try {
    const res = await fetch(bustRemoteCache(shellManifestUrl()), { cache: "no-store" });
    if (!res.ok) throw new Error(`shell-manifest ${res.status}`);
    manifest = await res.json();
    if (!manifest?.files || manifest.version !== 1) throw new Error("shell-manifest 형식 오류");
  } catch (err) {
    const prev = shellMetaGet();
    if (prev) {
      return report("offline", `껍데기 확인 실패 — 이전 파일 유지 (${err.message || err})`, {
        revision: prev.generatedAt ? `s:${prev.generatedAt}` : null,
      });
    }
    return report("error", `껍데기 확인 실패: ${err.message || err}`);
  }

  const revision = manifest.generatedAt ? `s:${manifest.generatedAt}` : `s:${Object.keys(manifest.files).length}`;
  const entries = Object.entries(manifest.files);
  const need = [];
  for (let i = 0; i < entries.length; i++) {
    const [rel, info] = entries[i];
    if (i % 10 === 0 || i + 1 === entries.length) {
      onProgress?.({
        status: "checking",
        message: `껍데기 확인 중… ${i + 1} / ${entries.length}`,
        index: i + 1,
        total: entries.length,
        current: rel,
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    const diskRel = `www/${rel}`;
    const have = await storedHash(diskRel);
    if (!have || have !== info.sha256) need.push([rel, info, diskRel]);
  }

  if (!need.length) {
    shellMetaSet(manifest);
    const haveIndex = await storedHash("www/index.html");
    return report("ok", "껍데기 최신", {
      checked: entries.length,
      updated: 0,
      needReload: !isDiskShell() && !!haveIndex,
      revision,
    });
  }

  let updated = 0;
  for (let i = 0; i < need.length; i++) {
    const [rel, info, diskRel] = need[i];
    onProgress?.({
      status: "downloading",
      message: `껍데기 다운로드 ${i + 1}/${need.length}`,
      current: rel,
      index: i + 1,
      total: need.length,
      updated,
    });
    const url = bustRemoteCache(shellFileUrl(rel));
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const hash = await sha256(buf);
    if (hash !== info.sha256) throw new Error(`${rel}: 무결성 불일치`);
    await writeStored(diskRel, buf, hash, guessType(rel));
    updated++;
  }

  shellMetaSet(manifest);
  return report("ok", updated ? `껍데기 ${updated}개 갱신` : "껍데기 최신", {
    checked: entries.length,
    updated,
    needReload: true,
    revision,
  });
}

/** Switch the webview to the on-disk www/ overlay (custom protocol).
 *  Already on disk shell: hard-reload so freshly written www/ files take effect. */
export async function reloadToDiskShell() {
  if (!isTauri()) return false;
  if (isDiskShell()) {
    try {
      location.reload();
      return true;
    } catch (err) {
      console.warn("disk shell reload", err);
      return false;
    }
  }
  try {
    return !!(await invoke("reload_to_disk_shell"));
  } catch (err) {
    console.warn("reload_to_disk_shell", err);
    return false;
  }
}

export async function ensureServiceWorker() {
  if (isTauri()) return null; // WebView2 + custom protocol: SW optional
  if (!("serviceWorker" in navigator)) return null;
  // ?v= bumps the script URL so browsers pick up CACHE_NAME changes
  const reg = await navigator.serviceWorker.register("./sw.js?v=7", { scope: "./" });
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
          // Localhost: prefer disk for pics+data (puzzle/script edits). Cache still for sound / Tauri.
          const isLocalHost = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
          if (isLocalHost && (p.includes("/pics/") || p.includes("/data/"))) return orig(input, init);
          if (isTauri()) {
            const buf = await readStored(rel);
            if (buf) {
              return new Response(buf, {
                status: 200,
                headers: { "Content-Type": guessType(rel) },
              });
            }
            // Disk miss: GitHub raw (not the empty embedded www/data).
            return orig(bustRemoteCache(assetUrl(rel, fileSource(rel, {}))), init);
          }
          const cache = await caches.open(CACHE_NAME);
          const hit = await cache.match(u.href) || await cache.match(u.href.split("?")[0]);
          if (hit) return hit;
        }
      }
    } catch { /* fall through */ }
    return orig(input, init);
  };
}
