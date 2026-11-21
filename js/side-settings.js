/** Left-column tabs: card info + settings (volume / language). Shared by deck / AI pages. */
import { toast } from "./ui.js";
import { setVolume, volume } from "./sound.js";
import { getLang, setLang } from "./lang.js";
import { t } from "./ui-i18n.js";

export function setupSideTabs() {
  const tabs = document.querySelectorAll(".tabs .tab[data-tab]");
  if (!tabs.length) return;
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-page").forEach((page) => {
      page.hidden = page.dataset.page !== tab.dataset.tab;
    });
  }));
}

export function setupSideVolume() {
  for (const kind of ["voice", "bgm"]) {
    const slider = document.getElementById(`volume-${kind}`);
    const label = document.getElementById(`volume-${kind}-value`);
    if (!slider || !label) continue;
    const show = () => { label.textContent = `${slider.value}%`; };
    slider.value = Math.round(volume(kind) * 100);
    show();
    slider.addEventListener("input", () => {
      setVolume(kind, slider.value / 100);
      show();
    });
  }
}

function syncSettingsLangButtons(root) {
  const cur = getLang();
  root.querySelectorAll(".settings-lang-btn").forEach((btn) => {
    const on = btn.dataset.lang === cur;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/** Flag buttons (#settings-lang) — reload when language changes so packs match. */
export function setupSideLang() {
  const root = document.getElementById("settings-lang");
  if (!root) return;
  syncSettingsLangButtons(root);
  if (root.dataset.langBound === "1") return;
  root.dataset.langBound = "1";
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".settings-lang-btn");
    if (!btn || !root.contains(btn)) return;
    const prev = getLang();
    const next = setLang(btn.dataset.lang);
    syncSettingsLangButtons(root);
    if (next !== prev) {
      toast(next === "en" ? t("toast.langEn") : next === "ja" ? t("toast.langJa") : t("toast.langKo"));
      setTimeout(() => location.reload(), 450);
    } else {
      toast(t("toast.langSaved"));
    }
  });
}

export function setupSideSettings() {
  setupSideTabs();
  setupSideVolume();
  setupSideLang();
}
