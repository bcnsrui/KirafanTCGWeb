/* First-run download UI + exe data-folder setup.
 * Integrity check runs once per data revision (manifest generatedAt), not every time
 * you return to the main menu from deck / AI / server / replay / etc. */

import {
  checkAndApplyShellUpdates,
  checkAndApplyUpdates,
  ensureServiceWorker,
  installDataFetchHook,
  isDiskShell,
  manifestRevisionToken,
  metaGet,
  reloadToDiskShell,
} from "./update.js?v=shellSync1";
import { isTauri } from "./runtime.js";
import {
  defaultDataPath,
  setDataPath,
} from "./storage.js";
import { getLang, setLang } from "./lang.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n34";

const BOOT_DONE_KEY = "kirafan-boot-done";
/** After one successful check, main-menu round-trips in this tab must not re-run. */
const BOOT_SESSION_OK = "kirafan-boot-session-ok";

function $(id) {
  return document.getElementById(id);
}

function showSetup(show) {
  $("boot-setup").hidden = !show;
  $("boot-progress").hidden = show;
}

function revisionFromMeta() {
  const meta = metaGet();
  if (meta?.generatedAt) return `g:${meta.generatedAt}`;
  if (meta?.count != null) return `c:${meta.count}`;
  return null;
}

function readDone() {
  try { return localStorage.getItem(BOOT_DONE_KEY); } catch { return null; }
}

function markSessionOk() {
  try { sessionStorage.setItem(BOOT_SESSION_OK, "1"); } catch { /* ignore */ }
  document.documentElement.classList.add("boot-skip");
}

function isSessionOk() {
  try {
    return sessionStorage.getItem(BOOT_SESSION_OK) === "1";
  } catch {
    return false;
  }
}

/**
 * Skip integrity UI when this tab already checked, or saved data revision
 * still matches the live manifest. Never show the overlay just to compare.
 */
async function alreadyCheckedCurrentRevision() {
  // Same tab (덱/AI 갔다 메인 복귀): 절대 다시 검사하지 않음
  if (isSessionOk()) return true;

  const metaRev = revisionFromMeta();
  const done = readDone();

  let live = null;
  try {
    live = await manifestRevisionToken();
  } catch { /* ignore */ }

  // 이 탭 첫 진입: 매니페스트 리비전이 이미 적용·표시된 것과 같으면 스킵 (화면 안 띄움)
  if (live && (live === metaRev || live === done)) {
    markCheckedThisSession(live);
    return true;
  }
  if (done === "ok" && metaRev && (!live || live === metaRev)) {
    markCheckedThisSession(metaRev);
    return true;
  }
  if (!live && (metaRev || (done && done !== "1"))) {
    markCheckedThisSession(metaRev || done);
    return true;
  }
  if (done === "1" && metaRev && (!live || live === metaRev)) {
    markCheckedThisSession(metaRev);
    return true;
  }

  return false;
}

function markCheckedThisSession(token) {
  // Set session flag first (sync) so a quick leave/return cannot race a second check
  markSessionOk();
  const value = token || revisionFromMeta();
  if (value && value !== "1") {
    try { localStorage.setItem(BOOT_DONE_KEY, value); } catch { /* ignore */ }
  } else if (!readDone()) {
    try { localStorage.setItem(BOOT_DONE_KEY, "ok"); } catch { /* ignore */ }
  }
}

function clearCheckedFlag() {
  try { sessionStorage.removeItem(BOOT_SESSION_OK); } catch { /* ignore */ }
  try { localStorage.removeItem(BOOT_DONE_KEY); } catch { /* ignore */ }
  document.documentElement.classList.remove("boot-skip");
}

function syncBootLangButtons() {
  const cur = getLang();
  document.querySelectorAll(".boot-lang-btn").forEach((btn) => {
    const on = btn.dataset.lang === cur;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

let bootLangBound = false;
function bindBootLangButtons() {
  if (bootLangBound) return;
  const root = document.querySelector(".boot-lang");
  if (!root) return;
  bootLangBound = true;
  syncBootLangButtons();
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".boot-lang-btn");
    if (!btn || !root.contains(btn)) return;
    const prev = getLang();
    const next = setLang(btn.dataset.lang);
    syncBootLangButtons();
    if (next === prev) return;
    // Keep ?boot=… so design/demo preview stays after reload
    location.reload();
  });
}

function hideBootUi() {
  const overlay = $("boot-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.hidden = true;
  }
  document.getElementById("main-menu")?.classList.remove("booting");
  document.documentElement.classList.add("boot-skip");
  stopDots();
}

function setProgress(pct) {
  const p = Math.max(0, Math.min(100, pct));
  $("boot-overlay")?.style.setProperty("--boot-pct", `${p}%`);
  const bar = $("boot-bar");
  if (bar) bar.style.width = `${p}%`;
}

function startDots() {
  const el = $("boot-dots");
  if (!el || el.dataset.running) return;
  el.dataset.running = "1";
  const frames = [".", "..", "..."];
  let i = 0;
  el.textContent = frames[0];
  el._timer = setInterval(() => {
    i = (i + 1) % frames.length;
    el.textContent = frames[i];
  }, 420);
}

function stopDots() {
  const el = $("boot-dots");
  if (!el) return;
  if (el._timer) clearInterval(el._timer);
  delete el.dataset.running;
}

/** exe: always use folder next to the .exe (data/pics/sound). No picker. */
async function ensureExePath() {
  if (!isTauri()) return true;
  const path = await defaultDataPath();
  if (!path) throw new Error("실행 파일 폴더를 확인할 수 없습니다");
  await setDataPath(path);
  showSetup(false);
  return true;
}

/**
 * Path setup (exe, first time) + integrity download once per data revision.
 * Returning to the main menu from any submenu reuses the same skip flag.
 * @returns {Promise<{ status: string, message: string }>}
 */
export async function runBootSequence() {
  const overlay = $("boot-overlay");
  bindBootLangButtons();
  applyI18n(overlay || document);

  if (isTauri()) {
    await ensureExePath();
  }

  const bootParam = new URLSearchParams(location.search).get("boot");
  const forceBoot = bootParam !== null;
  const designBoot = bootParam === "design";
  if (forceBoot) clearCheckedFlag();

  // Exe: sync KirafanTCGWeb shell (html/js/css) before data packs, then switch to disk overlay.
  if (isTauri() && !designBoot && bootParam !== "demo") {
    document.documentElement.classList.remove("boot-skip");
    overlay?.classList.remove("hidden");
    if (overlay) overlay.hidden = false;
    showSetup(false);
    startDots();
    setProgress(0);
    $("boot-status").textContent = t("boot.checking");
    $("boot-detail").textContent = "";
    try {
      const shell = await checkAndApplyShellUpdates((info) => {
        if (info.status === "checking" || info.status === "downloading") {
          $("boot-status").textContent = info.message || t("boot.checking");
          $("boot-detail").textContent = info.current || "";
          if (info.total) setProgress(Math.min(25, (info.index / info.total) * 25));
        }
      });
      // Apply www/ changes: first switch to disk overlay, or hard-reload if already on it.
      // (Previously skipped reload when isDiskShell — updates sat on disk unused.)
      if (shell.needReload || (shell.updated | 0) > 0) {
        $("boot-status").textContent = shell.message || t("boot.checking");
        $("boot-detail").textContent = isDiskShell()
          ? "껍데기 갱신 적용 중…"
          : "껍데기 디스크 오버레이로 전환…";
        const ok = await reloadToDiskShell();
        if (ok) {
          return {
            status: "reload",
            message: isDiskShell() ? "껍데기 갱신 적용" : "껍데기 디스크 오버레이로 전환",
          };
        }
      }
    } catch (err) {
      console.warn("shell sync", err);
      // Continue with bundled shell + data integrity.
    }
  }

  if (designBoot || bootParam === "demo") {
    overlay?.classList.remove("hidden");
    if (overlay) overlay.hidden = false;
    document.documentElement.classList.remove("boot-skip");
    showSetup(false);
    startDots();
    document.getElementById("main-menu")?.classList.add("booting");

    if (bootParam === "demo") {
      const samples = [
        "data/cards.json",
        "data/ai/model.bin",
        "pics/10051111.jpg",
        "pics/small/10053332.jpg",
        "sound/BGM/duel/bgm_battle_1_0.mp3",
        "sound/summon/10051111.mp3",
        "data/scripts.json",
        "sound/activate.wav",
      ];
      const total = 528;
      await new Promise((resolve) => {
        let i = 0;
        const steps = 40;
        const tick = () => {
          i++;
          const pct = (i / steps) * 100;
          const idx = Math.min(total, Math.round((i / steps) * total));
          setProgress(pct);
          $("boot-status").textContent = t("boot.downloading", { index: idx, total });
          $("boot-detail").textContent = `${samples[i % samples.length]} · ${(pct * 0.478).toFixed(1)} MB / 47.8 MB`;
          if (i >= steps) {
            setProgress(100);
            $("boot-status").textContent = t("boot.done");
            $("boot-detail").textContent = "";
            setTimeout(resolve, 450);
            return;
          }
          setTimeout(tick, 70);
        };
        setProgress(0);
        $("boot-status").textContent = t("boot.downloading", { index: 0, total });
        $("boot-detail").textContent = samples[0];
        setTimeout(tick, 80);
      });
      markCheckedThisSession(await manifestRevisionToken());
      hideBootUi();
      return { status: "ok", message: "데모 완료" };
    }

    setProgress(24);
    $("boot-status").textContent = t("boot.downloading", { index: 128, total: 528 });
    $("boot-detail").textContent = "sound/BGM/duel/bgm_battle_1_0.mp3 · 12.4 MB / 47.8 MB";
    return { status: "design", message: "디자인 미리보기" };
  }

  // Web: skip if already checked this tab / applied. Exe: every process launch verifies vs GitHub;
  // only same-process main-menu returns reuse the session flag.
  const canSkip = isTauri()
    ? (!forceBoot && isSessionOk())
    : (!forceBoot && (isSessionOk() || metaGet() || await alreadyCheckedCurrentRevision()));

  if (canSkip) {
    const coldStart = !isSessionOk();
    hideBootUi();
    markSessionOk();
    const metaRev = revisionFromMeta();
    if (metaRev) markCheckedThisSession(metaRev);
    installDataFetchHook();
    await ensureServiceWorker().catch(() => null);

    // Browser: quiet revision sync on cold tab. Exe already did a full check at launch.
    if (!isTauri() && coldStart && metaGet()) {
      void (async () => {
        try {
          const live = await manifestRevisionToken();
          const cur = revisionFromMeta();
          if (live && cur && live !== cur) {
            const result = await checkAndApplyUpdates(() => {});
            markCheckedThisSession(result.revision || live);
          } else if (live) {
            markCheckedThisSession(live);
          }
        } catch { /* ignore background sync errors */ }
      })();
    }
    return { status: "ok", message: "이번 실행에서 이미 확인함" };
  }

  document.documentElement.classList.remove("boot-skip");
  overlay?.classList.remove("hidden");
  if (overlay) overlay.hidden = false;
  showSetup(false);
  startDots();
  setProgress(0);
  $("boot-status").textContent = t("boot.checking");
  $("boot-detail").textContent = "";

  try {
    const result = await checkAndApplyUpdates((info) => {
      if (info.status === "checking") {
        $("boot-status").textContent = info.total
          ? t("boot.checkingProgress", { index: info.index, total: info.total })
          : (info.message || t("boot.checking"));
        $("boot-detail").textContent = info.current || "";
        if (info.total) setProgress((info.index / info.total) * 30);
      } else if (info.status === "downloading") {
        if (info.total) {
          $("boot-status").textContent = t("boot.downloading", {
            index: info.index,
            total: info.total,
          });
          const byCount = (info.index / info.total) * 100;
          const byBytes = info.bytesTotal ? (info.bytesDone / info.bytesTotal) * 100 : byCount;
          setProgress(30 + Math.max(byCount, byBytes) * 0.7);
        } else {
          $("boot-status").textContent = t("boot.downloadingBusy");
        }
        $("boot-detail").textContent = [info.current || info.message, info.sizeLabel]
          .filter(Boolean)
          .join(" · ");
      } else if (info.status === "ok") {
        $("boot-status").textContent = info.message || t("boot.done");
        $("boot-detail").textContent = "";
        setProgress(100);
      } else {
        $("boot-status").textContent = info.message || "";
      }
    });
    setProgress(100);
    const rev = result.revision || revisionFromMeta();
    const ok = result.status === "ok" || result.status === "offline";
    if (ok) {
      markCheckedThisSession(rev);
      await new Promise((r) => setTimeout(r, 320));
      hideBootUi();
      return result;
    }
    // Incomplete / error: stay on overlay — do not enter main menu
    $("boot-status").textContent = result.message || t("boot.fail");
    $("boot-detail").textContent = t("boot.retryHint");
    stopDots();
    return result;
  } catch (err) {
    // Keep overlay visible so a failed first download is not a blank home screen.
    document.documentElement.classList.remove("boot-skip");
    overlay?.classList.remove("hidden");
    if (overlay) overlay.hidden = false;
    $("boot-status").textContent = err.message || String(err);
    $("boot-detail").textContent = t("boot.retryHint");
    stopDots();
    return { status: "error", message: err.message || String(err) };
  }
}
