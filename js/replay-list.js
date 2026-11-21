import { toast } from "./ui.js";
import { deleteReplay, isReplay, listReplays, saveReplay } from "./replays.js";
import { loadSounds, playBgm } from "./sound.js";
import { applyI18n, t } from "./ui-i18n.js?v=i18n20";
import { getLang } from "./lang.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, primary = false) {
  const b = el("button", `menu-button small${primary ? " primary" : ""}`, label);
  b.addEventListener("click", onClick);
  return b;
}

/** the replay as a file of its own */
function download(replay) {
  const blob = new Blob([JSON.stringify(replay)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date(replay.date);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
    + `-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  a.href = URL.createObjectURL(blob);
  a.download = `kirafan-replay-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function showList() {
  const replays = await listReplays();
  document.getElementById("replay-count").textContent = t("replay.count", { n: replays.length });
  const list = document.getElementById("replay-list");
  if (!replays.length) {
    list.replaceChildren(el("li", "replay-empty", t("replay.empty")));
    return;
  }
  const locale = getLang() === "ja" ? "ja-JP" : getLang() === "en" ? "en-US" : "ko-KR";
  list.replaceChildren(...replays.map((r) => {
    const row = el("li", "replay-item");
    const info = el("div", "replay-info");
    let outcome = String(r.result || "").replace("!", "");
    if (outcome === "항복" || outcome === "패배" || outcome === "Defeat" || outcome === "敗北" || outcome === "Loss"
      || outcome === "Surrender" || outcome === "降参") outcome = t("replay.lose");
    else if (outcome === "승리" || outcome === "Victory" || outcome === "勝利" || outcome === "Win") outcome = t("replay.win");
    const kind = outcome === t("replay.win") ? "win" : outcome === t("replay.lose") ? "lose" : "";
    const line1 = el("div", "replay-line");
    line1.append(
      el("b", `replay-result ${kind}`, outcome || "?"),
      el("span", "replay-date", new Date(r.date).toLocaleString(locale)),
    );
    const botKey = r.bot ? `ai.bot.${r.bot}` : "";
    const botLabel = botKey && t(botKey) !== botKey ? t(botKey) : (r.bot || "");
    const vs = r.bot
      ? t("replay.vsAi", { deck: r.myDeck, level: r.level, bot: botLabel })
      : t("replay.vs", { deck: r.myDeck, opp: r.aiDeck || t("puzzle.opp") });
    const line2 = el("div", "replay-line replay-match", `${vs} ${t("replay.turns", { n: r.turns })}`);
    info.append(line1, line2);
    const actions = el("div", "replay-actions");
    actions.append(
      button(t("replay.view"), () => (location.href = `game.html?replay=${r.id}`), true),
      button(t("replay.saveFile"), () => download(r)),
      button(t("replay.delete"), async () => {
        await deleteReplay(r.id);
        showList();
      }),
    );
    row.append(info, actions);
    return row;
  }));
}

applyI18n();
document.getElementById("back").addEventListener("click", () => (location.href = "index.html?v=i18n3"));
document.getElementById("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const replay = JSON.parse(await file.text());
    if (!isReplay(replay)) return toast(t("replay.notFile"));
    await saveReplay(replay);
    toast(t("replay.imported"));
    showList();
  } catch (err) {
    console.error(err);
    toast(t("replay.readFail"));
  }
});

showList();
loadSounds().then(() => playBgm("deck"));
