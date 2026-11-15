import { getSession, refreshSession } from "./auth.js";
import { fetchMatchList, fetchMatchSummary, flushMatchQueue } from "./records.js";
import { toast } from "./ui.js";
import { t } from "./ui-i18n.js?v=i18n21";

function resultClass(result) {
  if (result === "승리") return "result-win";
  if (result === "패배" || result === "항복") return "result-lose";
  return "result-other";
}

function formatWhen(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso || "";
  }
}

async function main() {
  await refreshSession();
  const session = getSession();
  if (!session) {
    toast(t("toast.needLogin"));
    location.href = "index.html";
    return;
  }
  document.getElementById("records-user").textContent = session.name || "";

  try {
    await flushMatchQueue();
  } catch { /* ignore */ }

  try {
    const summary = await fetchMatchSummary();
    document.getElementById("stat-total").textContent = String(summary.total ?? 0);
    document.getElementById("stat-win").textContent = String(summary.wins ?? 0);
    document.getElementById("stat-lose").textContent = String(summary.losses ?? 0);
    const rate = summary.total ? Math.round((summary.wins / summary.total) * 1000) / 10 : 0;
    document.getElementById("stat-rate").textContent = summary.total ? `${rate}%` : "-";
  } catch (err) {
    document.getElementById("records-error").hidden = false;
    document.getElementById("records-error").textContent = err.message || "요약을 불러오지 못했습니다";
  }

  try {
    const list = await fetchMatchList(50);
    const ul = document.getElementById("records-list");
    const empty = document.getElementById("records-empty");
    if (!list.length) {
      empty.hidden = false;
      return;
    }
    for (const m of list) {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="${resultClass(m.result)}">${m.result}</span>
        <span class="meta">Lv${m.level} ${m.bot || ""} · ${m.turns}턴 · ${m.myDeck || "덱"} vs ${m.aiDeck || "AI"}</span>
        <span class="when">${formatWhen(m.playedAt)}</span>`;
      ul.appendChild(li);
    }
  } catch (err) {
    document.getElementById("records-error").hidden = false;
    document.getElementById("records-error").textContent = err.message || "목록을 불러오지 못했습니다";
  }
}

main();
