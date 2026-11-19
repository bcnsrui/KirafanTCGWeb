/** Fit a fixed FHD (1920×1080) stage into the viewport by uniform scale. */

export const FHD_W = 1920;
export const FHD_H = 1080;

/** Duel field design size (height fixed; width grows with the shell to avoid side letterbox). */
export const BOARD_W_MIN = 1482;
export const BOARD_W_MAX = 2000;
export const BOARD_W = BOARD_W_MIN; // baseline; runtime width is computed in bindBoardFit
export const BOARD_H = 1284;

/** Card width at which side-row content was designed (~content height below). */
export const BASE_CARD_W = 124;
/** Approx. side-row content height when --card-w is BASE_CARD_W. */
const BASE_FIELD_CONTENT_H = 360;

function scaleFor(vw, vh, w, h) {
  if (vw <= 0 || vh <= 0) return 1;
  return Math.min(vw / w, vh / h);
}

/**
 * Grow --card-w inside each .side-row so field contents fill the taller row
 * (hands / phase bar stay fixed; only the field chrome grows).
 */
export function fitFieldContent(root = document) {
  for (const row of root.querySelectorAll(".side-row")) {
    const h = row.clientHeight;
    if (h < 80) continue;
    const scale = Math.min(1.65, Math.max(1, (h * 0.96) / BASE_FIELD_CONTENT_H));
    row.style.setProperty("--card-w", `${Math.round(BASE_CARD_W * scale)}px`);
  }
}

/**
 * Keep every `.fhd-stage` letterboxed and scaled to the window.
 * Positions with top-left origin so pointer hit-tests line up with what you see.
 * @returns {() => void} dispose
 */
export function bindFhdStage(root = document) {
  const stages = [...root.querySelectorAll(".fhd-stage")];
  if (!stages.length) return () => {};

  const apply = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 2 || vh < 2) return;
    const s = scaleFor(vw, vh, FHD_W, FHD_H);
    const left = (vw - FHD_W * s) / 2;
    const top = (vh - FHD_H * s) / 2;
    document.documentElement.style.setProperty("--fhd-scale", String(s));
    for (const el of stages) {
      el.style.setProperty("--fhd-scale", String(s));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.classList.add("is-fitted");
    }
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
  };
}

/** Main-menu 5-card strip (frame art 664×1075 → 218px wide). */
export const HOME_CARD_W = 218;
export const HOME_CARD_GAP = 18;
export const HOME_CARDS_W = HOME_CARD_W * 5 + HOME_CARD_GAP * 4; // 1162
export const HOME_CARDS_H = Math.round(HOME_CARD_W * (1075 / 664)); // ~353
/** Fit scale multiplier — 1 fills the shell; 0.7 = 30% smaller. */
export const HOME_FIT = 0.7;

/**
 * Scale `.home-cards` uniformly inside `.home-cards-shell` (contain).
 * Keeps all 5 buttons in one row; they grow/shrink with the window like the duel field.
 * @returns {() => void} dispose
 */
export function bindHomeCardsFit(root = document) {
  const shell = root.querySelector(".home-cards-shell");
  const stage = root.querySelector(".home-cards");
  if (!shell || !stage) return () => {};

  const apply = () => {
    const rw = shell.clientWidth;
    const rh = shell.clientHeight;
    if (rw < 2 || rh < 2) return; // boot/overlay: shell not laid out yet — wait for RO/resize
    const s = scaleFor(rw, rh, HOME_CARDS_W, HOME_CARDS_H) * HOME_FIT;
    const left = (rw - HOME_CARDS_W * s) / 2;
    const top = (rh - HOME_CARDS_H * s) / 2;
    document.documentElement.style.setProperty("--home-scale", String(s));
    stage.style.setProperty("--home-scale", String(s));
    stage.style.width = `${HOME_CARDS_W}px`;
    stage.style.height = `${HOME_CARDS_H}px`;
    stage.style.left = `${left}px`;
    stage.style.top = `${top}px`;
    stage.style.transform = `scale(${s})`;
    stage.classList.add("is-fitted");
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
  ro?.observe(shell);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    ro?.disconnect();
  };
}

/**
 * Scale `#board` uniformly inside `.board-shell` (contain, never clip).
 * Design width tracks the shell aspect (clamped) so wide screens don't leave
 * huge empty margins on the left/right of the field.
 * @returns {() => void} dispose
 */
export function bindBoardFit(root = document) {
  const shell = root.querySelector(".board-shell");
  const board = root.querySelector("#board");
  if (!shell || !board) return () => {};

  const apply = () => {
    const rw = shell.clientWidth;
    const rh = shell.clientHeight;
    if (rw < 2 || rh < 2) return;
    const aspectW = Math.round(BOARD_H * (rw / rh));
    const designW = Math.min(BOARD_W_MAX, Math.max(BOARD_W_MIN, aspectW));
    const s = scaleFor(rw, rh, designW, BOARD_H);
    const left = (rw - designW * s) / 2;
    const top = (rh - BOARD_H * s) / 2;
    document.documentElement.style.setProperty("--board-scale", String(s));
    board.style.setProperty("--board-scale", String(s));
    board.style.width = `${designW}px`;
    board.style.height = `${BOARD_H}px`;
    board.style.left = `${left}px`;
    board.style.top = `${top}px`;
    board.style.transform = `scale(${s})`;
    board.classList.add("is-fitted");
    requestAnimationFrame(() => fitFieldContent(root));
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
  ro?.observe(shell);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    ro?.disconnect();
  };
}
