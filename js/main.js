import { API_BASE, EXE_DOWNLOAD_URL, VERSION } from "./config.js";
import { toast } from "./ui.js";
import { runBootSequence } from "./boot.js?v=i18n37";
import { isTauri } from "./runtime.js";
import { loadSounds, playBgm, setVolume, volume } from "./sound.js";
import "./local-assets.js";
import { LANG_STORE, getLang, setLang } from "./lang.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n34";
import "./presence.js";

const VISIT_KEY = "kirafan.visit.pinged";

/** Main-screen entry: server counts unique IP / 24h. sessionStorage avoids repeat spam. */
function pingVisit() {
  try {
    if (sessionStorage.getItem(VISIT_KEY) === "1") return;
    sessionStorage.setItem(VISIT_KEY, "1");
  } catch { /* ignore */ }
  const url = `${API_BASE}/visit`;
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .catch(() => {});
}

const PETALS = 18;
const NICK_STORE = "kirafan.server.nick";
const NICK_MAX = 20;

function defaultNick() {
  return t("common.defaultNick");
}

const SCREENS = {
  server: "server.html",
  ai: "ai.html",
  story: "puzzle.html",
  replay: "replay.html",
  deck: "deck.html",
};

function makePetals(layer) {
  for (let i = 0; i < PETALS; i++) {
    const petal = document.createElement("div");
    petal.className = "petal";
    const size = 0.6 + Math.random() * 0.8;
    petal.style.left = `${Math.random() * 100}vw`;
    petal.style.scale = String(size);
    petal.style.animationDuration = `${9 + Math.random() * 10}s`;
    petal.style.animationDelay = `${-Math.random() * 19}s`;
    petal.style.setProperty("--drift", `${-20 + Math.random() * 40}vw`);
    petal.style.setProperty("--spin", `${360 + Math.random() * 720}deg`);
    layer.appendChild(petal);
  }
}

function open(action) {
  const target = SCREENS[action];
  if (!target) return;
  location.href = target;
}

function clampNick(value) {
  return (value || "").trim().slice(0, NICK_MAX) || defaultNick();
}

function loadSettingsForm() {
  document.getElementById("settings-nick").value = clampNick(
    localStorage.getItem(NICK_STORE) || defaultNick(),
  );
  document.getElementById("settings-sfx").value = String(Math.round(volume("voice") * 100));
  document.getElementById("settings-bgm").value = String(Math.round(volume("bgm") * 100));
  document.getElementById("settings-lang").value = localStorage.getItem(LANG_STORE) || getLang();
}

function openSettings() {
  loadSettingsForm();
  document.getElementById("settings-backdrop").hidden = false;
  document.getElementById("settings-panel").hidden = false;
  document.getElementById("settings-button").setAttribute("aria-expanded", "true");
}

function closeSettings() {
  document.getElementById("settings-backdrop").hidden = true;
  document.getElementById("settings-panel").hidden = true;
  document.getElementById("settings-button").setAttribute("aria-expanded", "false");
}

function saveNick() {
  const nick = clampNick(document.getElementById("settings-nick").value);
  document.getElementById("settings-nick").value = nick;
  localStorage.setItem(NICK_STORE, nick);
  sessionStorage.setItem(NICK_STORE, nick);
  toast(t("toast.nickSaved"));
}

applyI18n();
document.getElementById("version").textContent = VERSION;
if (isTauri()) {
  const sub = document.querySelector(".home-brand-sub");
  if (sub) {
    const ver = document.getElementById("version");
    sub.replaceChildren(document.createTextNode(t("app.subtitlePc")), ver);
  }
  document.getElementById("exe-download")?.setAttribute("hidden", "");
} else {
  const exe = document.getElementById("exe-download");
  if (exe) {
    if (EXE_DOWNLOAD_URL) {
      exe.href = EXE_DOWNLOAD_URL;
      exe.target = "_blank";
    } else {
      exe.addEventListener("click", (e) => {
        e.preventDefault();
        toast(t("nav.exeSoon"));
      });
    }
  }
}
makePetals(document.getElementById("petals"));
document.querySelectorAll(".home-card[data-action]").forEach((el) => {
  el.addEventListener("click", () => open(el.dataset.action));
});

document.getElementById("settings-button").addEventListener("click", () => {
  const panel = document.getElementById("settings-panel");
  if (panel.hidden) openSettings();
  else closeSettings();
});
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-backdrop").addEventListener("click", closeSettings);
document.getElementById("settings-nick-save").addEventListener("click", saveNick);
document.getElementById("settings-nick").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveNick();
});
document.getElementById("settings-sfx").addEventListener("input", (e) => {
  setVolume("voice", Number(e.target.value) / 100);
});
document.getElementById("settings-bgm").addEventListener("input", (e) => {
  setVolume("bgm", Number(e.target.value) / 100);
});
document.getElementById("settings-lang").addEventListener("change", (e) => {
  const prev = getLang();
  const next = setLang(e.target.value);
  if (next !== prev) {
    toast(next === "en" ? t("toast.langEn") : next === "ja" ? t("toast.langJa") : t("toast.langKo"));
    setTimeout(() => location.reload(), 450);
  } else {
    toast(t("toast.langSaved"));
  }
});

runBootSequence().then(async (result) => {
  if (result?.status === "design") return;
  // 다운로드 실패/미완료면 오버레이에 머물고 메인 메뉴를 열지 않음
  if (result?.status === "error") return;
  document.getElementById("main-menu").classList.remove("booting");
  if (location.search.includes("boot=demo")) {
    history.replaceState(null, "", "index.html");
  }
  await loadSounds();
  playBgm("menu");
  pingVisit();
});
