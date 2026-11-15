/* First-run download UI + exe data-folder setup.
 * Integrity check runs once per data revision (manifest generatedAt), not every time
 * you return to the main menu from deck / AI / server / replay / etc. */

import {
  checkAndApplyUpdates, ensureServiceWorker, installDataFetchHook, manifestRevisionToken, metaGet,
} from "./update.js?v=i18n32";
import { isTauri } from "./runtime.js";
import {
  defaultDataPath,
  ensureDataPathReady,
  pickDataFolder,
  setDataPath,
} from "./storage.js";

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

async function ensureExePath() {
  if (!isTauri()) return true;
  const state = await ensureDataPathReady();
  if (state.path) return true;

  showSetup(true);
  return new Promise((resolve) => {
    const defPromise = defaultDataPath();
    defPromise.then((def) => {
      $("boot-path-suggest").textContent = def || "";
    });

    const onDefault = async () => {
      const path = (await defPromise) || (await defaultDataPath());
      if (!path) return;
      await setDataPath(path);
      cleanup();
      showSetup(false);
      resolve(true);
    };
    const onPick = async () => {
      const path = await pickDataFolder();
      if (!path) return;
      await setDataPath(path);
      cleanup();
      showSetup(false);
      resolve(true);
    };
    const cleanup = () => {
      $("boot-use-default").removeEventListener("click", onDefault);
      $("boot-pick-folder").removeEventListener("click", onPick);
    };
    $("boot-use-default").addEventListener("click", onDefault);
    $("boot-pick-folder").addEventListener("click", onPick);
  });
}

/**
 * Path setup (exe, first time) + integrity download once per data revision.
 * Returning to the main menu from any submenu reuses the same skip flag.
 * @returns {Promise<{ status: string, message: string }>}
 */
export async function runBootSequence() {
  const overlay = $("boot-overlay");

  if (isTauri()) {
    const state = await ensureDataPathReady();
    if (!state.path) {
      overlay?.classList.remove("hidden");
      if (overlay) overlay.hidden = false;
      document.documentElement.classList.remove("boot-skip");
      showSetup(false);
      startDots();
      await ensureExePath();
    }
  }

  const bootParam = new URLSearchParams(location.search).get("boot");
  const forceBoot = bootParam !== null;
  const designBoot = bootParam === "design";
  if (forceBoot) clearCheckedFlag();

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
          $("boot-status").textContent = `다운로드 ${idx} / ${total}`;
          $("boot-detail").textContent = `${samples[i % samples.length]} · ${(pct * 0.478).toFixed(1)} MB / 47.8 MB`;
          if (i >= steps) {
            setProgress(100);
            $("boot-status").textContent = "완료";
            $("boot-detail").textContent = "";
            setTimeout(resolve, 450);
            return;
          }
          setTimeout(tick, 70);
        };
        setProgress(0);
        $("boot-status").textContent = "다운로드 0 / 528";
        $("boot-detail").textContent = samples[0];
        setTimeout(tick, 80);
      });
      markCheckedThisSession(await manifestRevisionToken());
      hideBootUi();
      return { status: "ok", message: "데모 완료" };
    }

    setProgress(24);
    $("boot-status").textContent = "다운로드 128 / 528";
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
  $("boot-status").textContent = "파일 목록 확인 중…";
  $("boot-detail").textContent = "";

  try {
    const result = await checkAndApplyUpdates((info) => {
      if (info.status === "downloading") {
        if (info.total) {
          $("boot-status").textContent = `다운로드 ${info.index} / ${info.total}`;
          const byCount = (info.index / info.total) * 100;
          const byBytes = info.bytesTotal ? (info.bytesDone / info.bytesTotal) * 100 : byCount;
          setProgress(Math.max(byCount, byBytes));
        } else {
          $("boot-status").textContent = "다운로드 중…";
        }
        $("boot-detail").textContent = [info.current || info.message, info.sizeLabel]
          .filter(Boolean)
          .join(" · ");
      } else if (info.status === "ok") {
        $("boot-status").textContent = info.message || "완료";
        $("boot-detail").textContent = "";
        setProgress(100);
      } else {
        $("boot-status").textContent = info.message || "";
      }
    });
    setProgress(100);
    const rev = result.revision || revisionFromMeta();
    if (result.status === "ok" || result.status === "offline" || rev || metaGet()) {
      markCheckedThisSession(rev);
    }
    await new Promise((r) => setTimeout(r, result.status === "error" ? 1200 : 320));
    return result;
  } catch (err) {
    markSessionOk();
    await new Promise((r) => setTimeout(r, 1600));
    return { status: "error", message: err.message || String(err) };
  } finally {
    hideBootUi();
  }
}
