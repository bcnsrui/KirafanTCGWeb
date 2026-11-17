/* Google sign-in via Identity Services. Passwords are never stored — only a short-lived
 * session token from our API after verifying the Google ID token. */

import { API_BASE } from "./config.js";

const SESSION_KEY = "kirafan-session";
const CLIENT_KEY = "googleClientId";
const listeners = new Set();

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token) return null;
    return s;
  } catch {
    return null;
  }
}

function setSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  listeners.forEach((fn) => fn(session));
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function logout() {
  setSession(null);
}

/** Fresh read — config.js value is fixed at page load. */
export function getGoogleClientId() {
  try {
    return (localStorage.getItem(CLIENT_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setGoogleClientId(id) {
  localStorage.setItem(CLIENT_KEY, String(id || "").trim());
}

export async function refreshSession() {
  const s = getSession();
  if (!s?.token) return null;
  try {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    if (!res.ok) {
      setSession(null);
      return null;
    }
    const me = await res.json();
    const next = {
      ...s,
      name: me.name,
      picture: me.picture || "",
      email: me.email || s.email || "",
      admin: !!me.admin,
    };
    setSession(next);
    return next;
  } catch {
    return s;
  }
}

function waitForGoogle(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const t0 = Date.now();
    const id = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(id);
        resolve(window.google.accounts.id);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        reject(new Error("구글 로그인 스크립트를 불러오지 못했습니다"));
      }
    }, 50);
  });
}

function askClientId() {
  return new Promise((resolve, reject) => {
    let host = document.getElementById("google-setup-host");
    if (host) host.remove();
    host = document.createElement("div");
    host.id = "google-setup-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)";
    host.innerHTML = `
      <div style="width:min(420px,92vw);padding:16px;background:#1a1528;border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#eee;font:13px/1.45 sans-serif">
        <p style="margin:0 0 8px;font-size:14px">구글 로그인 설정</p>
        <p style="margin:0 0 10px;color:#bbb;font-size:12px">
          구글 클라우드 콘솔 → API 및 서비스 → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID(웹)<br>
          승인된 자바스크립트 원본에 <code>http://127.0.0.1:8123</code> 을 넣으세요.
        </p>
        <input id="google-setup-input" type="text" placeholder="….apps.googleusercontent.com"
          style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:10px;border-radius:3px;border:1px solid #555;background:#0e0b16;color:#eee">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" id="google-setup-cancel" style="font:inherit;cursor:pointer;padding:6px 10px">취소</button>
          <button type="button" id="google-setup-ok" style="font:inherit;cursor:pointer;padding:6px 10px">저장 후 로그인</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    const input = host.querySelector("#google-setup-input");
    input.value = getGoogleClientId();
    input.focus();
    host.querySelector("#google-setup-cancel").onclick = () => {
      host.remove();
      reject(new Error("설정을 취소했습니다"));
    };
    host.querySelector("#google-setup-ok").onclick = () => {
      const id = input.value.trim();
      if (!id.includes("apps.googleusercontent.com")) {
        input.style.borderColor = "#e09090";
        return;
      }
      setGoogleClientId(id);
      host.remove();
      resolve(id);
    };
  });
}

function showGoogleButton(clientId, resolve, reject) {
  let host = document.getElementById("google-btn-host");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "google-btn-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)";
  host.innerHTML = `<div style="padding:16px;background:#1a1528;border:1px solid rgba(255,255,255,.2);border-radius:4px;text-align:center">
      <p style="margin:0 0 10px;font-size:13px;color:#eee">구글 계정으로 계속</p>
      <div id="google-btn-slot"></div>
      <button type="button" id="google-btn-cancel" style="margin-top:10px;font:inherit;font-size:12px;cursor:pointer">취소</button>
    </div>`;
  document.body.appendChild(host);
  host.querySelector("#google-btn-cancel").onclick = () => {
    host.remove();
    reject(new Error("로그인을 취소했습니다"));
  };

  const accounts = window.google.accounts.id;
  accounts.initialize({
    client_id: clientId,
    callback: (response) => {
      host.remove();
      if (response?.credential) resolve(response.credential);
      else reject(new Error("구글 인증이 취소되었습니다"));
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  accounts.renderButton(document.getElementById("google-btn-slot"), {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    width: 280,
  });
}

/** Official Google button → API session. */
export async function loginWithGoogle() {
  let clientId = getGoogleClientId();
  if (!clientId) clientId = await askClientId();

  await waitForGoogle();
  const credential = await new Promise((resolve, reject) => {
    showGoogleButton(clientId, resolve, reject);
  });

  let res;
  try {
    res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: credential, clientId }),
    });
  } catch {
    throw new Error(`전적 서버에 연결하지 못했습니다 (${API_BASE})`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `로그인 실패 (${res.status})`);
  }
  const data = await res.json();
  const session = {
    token: data.token,
    name: data.name || "",
    picture: data.picture || "",
    sub: data.sub || "",
    email: data.email || "",
    admin: !!data.admin,
  };
  setSession(session);
  return session;
}

export async function apiFetch(path, init = {}) {
  const session = getSession();
  const headers = new Headers(init.headers || {});
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
