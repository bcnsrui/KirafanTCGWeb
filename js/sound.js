/* Sound: the background music by situation and the creamates' voices (EDOPro's sound/, listed in
 * data/sounds.json), each with its own volume kept in localStorage. */

import { loadJson, mediaUrl } from "./local-assets.js";

const VOLUME_STORE = { bgm: "kirafan.volume.bgm", voice: "kirafan.volume.voice" };
const VOLUME_START = { bgm: 0.5, voice: 0.8 };

let manifest = null;
let music = null;          // the background music playing: { audio, situation }
let waiting = null;        // music the browser would not start before a click

export async function loadSounds() {
  if (!manifest) {
    try {
      manifest = await loadJson("data/sounds.json");
    } catch {
      manifest = { bgm: {}, voice: {}, effects: [] };
    }
  }
  return manifest;
}

/** 0..1 */
export function volume(kind) {
  const v = localStorage.getItem(VOLUME_STORE[kind]);
  return v === null ? VOLUME_START[kind] : Math.min(1, Math.max(0, Number(v)));
}

export function setVolume(kind, v) {
  localStorage.setItem(VOLUME_STORE[kind], String(v));
  if (kind === "bgm" && music) music.audio.volume = v;
}

function start(audio) {
  audio.play().catch(() => {
    // (autoplay refused until the page is clicked: start then)
    if (waiting) return;
    waiting = () => {
      document.removeEventListener("pointerdown", waiting);
      waiting = null;
      if (music && music.audio === audio) audio.play().catch(() => {});
    };
    document.addEventListener("pointerdown", waiting);
  });
}

/** a random piece of the situation's music (duel, advantage, disadvantage, win, lose, menu, deck), looping
 *  but for a win or a loss; the same situation again keeps the piece that plays */
export function playBgm(situation) {
  if (music && music.situation === situation) return;
  stopBgm();
  const files = manifest?.bgm[situation];
  if (!files || !files.length) return;
  const name = files[Math.floor(Math.random() * files.length)];
  const rel = `sound/BGM/${situation}/${name}`;
  const audio = new Audio();
  audio.loop = situation !== "win" && situation !== "lose";
  audio.volume = volume("bgm");
  music = { audio, situation };
  mediaUrl(rel).then((url) => {
    if (music?.audio !== audio) return;
    audio.src = url;
    start(audio);
  }).catch(() => {
    audio.src = rel;
    start(audio);
  });
}

export function stopBgm() {
  if (!music) return;
  music.audio.pause();
  music = null;
}

function playFile(rel) {
  const v = volume("voice");
  if (v <= 0) return Promise.resolve(false);
  return mediaUrl(rel).then((url) => new Promise((resolve) => {
    const audio = new Audio(url);
    audio.volume = v;
    audio.addEventListener("ended", () => resolve(true));
    audio.addEventListener("error", () => resolve(false));
    audio.play().catch(() => resolve(false));
  })).catch(() => Promise.resolve(false));
}

/** Folder on disk for a voice kind (defeat→destroy/, alchemist→Alchemist/). */
function voiceDir(kind) {
  if (kind === "defeat") return "destroy";
  if (kind === "alchemist") return "Alchemist";
  return kind;
}

/** a creamate's line when it is summoned / activates / totteoki / attacks / falls (silent if missing);
 *  resolves once it has been said (at once when there is none or it cannot play) */
export function voice(kind, code) {
  if (!manifest?.voice[kind]?.includes(code)) return Promise.resolve(false);
  return playFile(`sound/${voiceDir(kind)}/${code}.mp3`);
}

/** duel SFX helper (legacy EDOPro filenames). Unused in play — voices only. */
export function sfx(name) {
  const files = manifest?.effects || [];
  const want = String(name || "").toLowerCase();
  if (!want) return Promise.resolve(false);
  const file = files.find((f) => {
    const lower = f.toLowerCase();
    return lower === want || lower.startsWith(`${want}.`) || lower.replace(/\.[^.]+$/, "") === want;
  });
  if (!file) return Promise.resolve(false);
  return playFile(`sound/${file}`);
}

/** creamate / summoner chant only — no EDOPro default wav fallback when a line is missing */
export function playCue(kind, code) {
  return voice(kind, code);
}
