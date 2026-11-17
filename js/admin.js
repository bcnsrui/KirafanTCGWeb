import { apiFetch, getSession, loginWithGoogle, logout, refreshSession } from "./auth.js";
import { toast } from "./ui.js";

const gate = document.getElementById("admin-gate");
const panel = document.getElementById("admin-panel");
const gateError = document.getElementById("admin-gate-error");
const listEl = document.getElementById("admin-replays");
const emptyEl = document.getElementById("admin-empty");
const errorEl = document.getElementById("admin-error");

function showGate(msg = "") {
  gate.hidden = false;
  panel.hidden = true;
  if (msg) {
    gateError.hidden = false;
    gateError.textContent = msg;
  } else {
    gateError.hidden = true;
    gateError.textContent = "";
  }
}

function showPanel(session) {
  gate.hidden = true;
  panel.hidden = false;
  document.getElementById("admin-user").textContent =
    `${session.name || session.email || "admin"}${session.email ? ` · ${session.email}` : ""}`;
}

async function loadStats() {
  const res = await apiFetch("/admin/stats");
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(res.status === 403 ? "허용된 관리자 계정이 아닙니다" : "로그인이 필요합니다"), { status: res.status });
  }
  if (!res.ok) throw new Error(await res.text() || `stats ${res.status}`);
  const data = await res.json();
  document.getElementById("stat-concurrent").textContent = String(data.concurrent ?? 0);
  document.getElementById("stat-24h").textContent = String(data.unique24h ?? 0);
  document.getElementById("stat-7d").textContent = String(data.unique7d ?? 0);
  document.getElementById("stat-total").textContent = String(data.uniqueTotal ?? 0);
}

function rowHtml(r) {
  const when = r.date ? new Date(r.date).toLocaleString("ko-KR") : "";
  const names = Array.isArray(r.names) ? r.names.join(" vs ") : "";
  const mode = r.mode || "?";
  const file = r.file || `${r.id}.json`;
  return `<li>
    <div>
      <div><b>${mode}</b> · ${r.result || "-"} · ${r.turns || 0}턴</div>
      <div class="sub">${when} · ${names || `${r.myDeck || ""} / ${r.aiDeck || ""}`}</div>
    </div>
    <button type="button" class="menu-button small" data-file="${file}">다운로드</button>
  </li>`;
}

async function loadReplays() {
  errorEl.hidden = true;
  const res = await apiFetch("/admin/replays");
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(res.status === 403 ? "허용된 관리자 계정이 아닙니다" : "로그인이 필요합니다"), { status: res.status });
  }
  if (!res.ok) throw new Error(await res.text() || `replays ${res.status}`);
  const data = await res.json();
  const replays = data.replays || [];
  listEl.innerHTML = replays.map(rowHtml).join("");
  emptyEl.hidden = replays.length > 0;
  listEl.querySelectorAll("button[data-file]").forEach((btn) => {
    btn.addEventListener("click", () => downloadReplay(btn.getAttribute("data-file")));
  });
}

async function downloadReplay(file) {
  try {
    const res = await apiFetch(`/admin/replays/${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error(await res.text() || String(res.status));
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.endsWith(".json") ? file : `${file}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    toast(err.message || "다운로드 실패");
  }
}

async function bootAdmin() {
  await refreshSession();
  let session = getSession();
  if (!session) {
    showGate();
    return;
  }
  try {
    await loadStats();
    await loadReplays();
    showPanel(session);
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      logout();
      showGate(err.message);
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = err.message || String(err);
    showPanel(session);
  }
}

document.getElementById("admin-login").addEventListener("click", async () => {
  try {
    const session = await loginWithGoogle();
    if (!session.admin) {
      // server is source of truth; try stats anyway
    }
    await loadStats();
    await loadReplays();
    showPanel(getSession() || session);
  } catch (err) {
    showGate(err.message || "로그인 실패");
  }
});

document.getElementById("admin-refresh")?.addEventListener("click", async () => {
  try {
    await loadStats();
    await loadReplays();
    toast("갱신했습니다");
  } catch (err) {
    toast(err.message || "갱신 실패");
    if (err.status === 401 || err.status === 403) {
      logout();
      showGate(err.message);
    }
  }
});

document.getElementById("admin-logout")?.addEventListener("click", () => {
  logout();
  showGate();
});

bootAdmin();
