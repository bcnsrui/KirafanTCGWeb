import { API_BASE } from "./config.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function api(path, init) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`pvp api ${res.status}`);
  return res.json();
}

export async function clearPvpDuel(roomId) {
  try {
    await api(`/duels/${encodeURIComponent(roomId)}`, { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

/** 동전: 선후공을 고를 사람(chooser)만 먼저 공유합니다. */
export async function postPvpCoin(roomId, { seed, chooser, host, opp, matchId }) {
  return api(`/duels/${encodeURIComponent(roomId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "coin", seed, chooser, host, opp, matchId: matchId || "" }),
  });
}

export async function initPvpDuel(roomId, { seed, hostFirst, host, opp, matchId, chooser }) {
  return api(`/duels/${encodeURIComponent(roomId)}`, {
    method: "POST",
    body: JSON.stringify({
      action: "init",
      seed,
      hostFirst,
      host,
      opp,
      matchId: matchId || "",
      chooser: chooser || "",
    }),
  });
}

/** 동전 결과(chooser)가 올라올 때까지 기다립니다. */
export async function waitPvpCoin(roomId, { timeoutMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await api(`/duels/${encodeURIComponent(roomId)}`);
    if (data?.ok && data.seed != null && data.chooser) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("동전 결과를 기다리지 못했습니다");
}

/** 선후공까지 확정된 init 을 기다립니다. */
export async function waitPvpInit(roomId, { timeoutMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await api(`/duels/${encodeURIComponent(roomId)}`);
    if (data?.ok && data.seed != null && typeof data.hostFirst === "boolean") {
      if (!data.phase || data.phase === "ready") return data;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("상대 대전 시작을 기다리지 못했습니다");
}

export async function postPvpAnswer(roomId, step, answer) {
  return api(`/duels/${encodeURIComponent(roomId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "answer", step, answer }),
  });
}

/** 듀얼 전체(시드·답변·항복) — 새로고침 복구용 */
export async function fetchPvpDuel(roomId) {
  return api(`/duels/${encodeURIComponent(roomId)}`);
}

/** 항복하고 나갈 때: 상대가 승리 처리할 수 있도록 듀얼에 남긴다. */
export async function postPvpResign(roomId, nick) {
  return api(`/duels/${encodeURIComponent(roomId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "resign", nick: nick || "" }),
  });
}

/** 새로고침·탭 닫기용 — unload 중에도 전달되도록 beacon/keepalive.
 *  API 가 다른 포트(CORS)여도 되도록 text/plain beacon + keepalive fetch 둘 다 보냄. */
export function beaconPvpResign(roomId, nick) {
  const url = `${API_BASE}/duels/${encodeURIComponent(roomId)}`;
  const body = JSON.stringify({ action: "resign", nick: nick || "" });
  let sent = false;
  try {
    // keepalive: 대전 중 CORS preflight 캐시를 재사용할 수 있음
    fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      cache: "no-store",
      mode: "cors",
    });
    sent = true;
  } catch {
    /* fall through */
  }
  try {
    // application/json beacon 은 교차출처에서 막히는 경우가 많아 text/plain 사용
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      sent = true;
    }
  } catch {
    /* ignore */
  }
  return sent;
}

export class OppResignedError extends Error {
  constructor(resignedBy = "") {
    super("상대가 항복했습니다");
    this.name = "OppResignedError";
    this.resignedBy = resignedBy;
  }
}

/** 항복 감지 시 대기 중인 ask 를 즉시 끊기 위한 게이트 */
export function createResignGate() {
  let cancelled = false;
  let resignedBy = "";
  const listeners = new Set();
  const err = () => new OppResignedError(resignedBy);
  return {
    isCancelled: () => cancelled,
    trip(by = "") {
      cancelled = true;
      resignedBy = by == null ? "" : String(by);
      const e = err();
      for (const fn of [...listeners]) {
        try { fn(e); } catch { /* ignore */ }
      }
      listeners.clear();
    },
    /** Promise.race 용. finally 에서 cancel() 호출해 listener 누수 방지 */
    arm() {
      if (cancelled) {
        return { promise: Promise.reject(err()), cancel() {} };
      }
      let reject;
      const promise = new Promise((_, rej) => { reject = rej; });
      const listener = (e) => reject(e);
      listeners.add(listener);
      return {
        promise,
        cancel() { listeners.delete(listener); },
      };
    },
    async sleep(ms) {
      if (cancelled) throw err();
      const arm = this.arm();
      try {
        await Promise.race([
          new Promise((r) => setTimeout(r, ms)),
          arm.promise,
        ]);
      } finally {
        arm.cancel();
      }
      if (cancelled) throw err();
    },
  };
}

function resignFromPoll(data) {
  if (!data) return null;
  if (data.resigned || data.phase === "resigned" || data.resignedBy) {
    return String(data.resignedBy || "");
  }
  if (data.gone) return "";
  return null;
}

export async function waitPvpAnswer(roomId, step, {
  timeoutMs = 600000,
  isCancelled = null,
  resignGate = null,
} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (resignGate?.isCancelled() || isCancelled?.()) throw new OppResignedError();
    const data = await api(`/duels/${encodeURIComponent(roomId)}?step=${encodeURIComponent(String(step))}`);
    const by = resignFromPoll(data);
    if (by !== null) throw new OppResignedError(by);
    if (data?.ok) return data.answer;
    if (resignGate) await resignGate.sleep(200);
    else await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("상대 입력을 기다리지 못했습니다");
}

/** 상대 항복을 감시. 감지 시 onResign(resignedBy). 반환: stop() */
export function watchPvpResign(roomId, onResign, { intervalMs = 400 } = {}) {
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        const data = await api(`/duels/${encodeURIComponent(roomId)}`);
        const by = resignFromPoll(data);
        if (by !== null) {
          if (!stop) onResign(by);
          return;
        }
      } catch {
        /* ignore transient */
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => { stop = true; };
}

/** 양쪽이 같은 순서로 ask 를 소비합니다. 성전 선택은 모두 순차(선공→후공).
 *  human 은 양쪽 true — 상대를 AI 규칙으로 보면 ask 횟수가 갈라져 배틀 진입 시 kind 오류가 납니다.
 *  onRemoteWait / onRemoteDone: 상대 입력 대기 UI (알림창).
 *  resignGate: 항복 시 ask 즉시 중단. */
export function lockstepPlayers(roomId, localPlayer, remotePlayer, localIsPlayer0, {
  onRemoteWait = null,
  onRemoteDone = null,
  isCancelled = null,
  resignGate = null,
} = {}) {
  let step = 0;
  const cancelled = () => !!(resignGate?.isCancelled() || isCancelled?.());

  const wrap = (player, isLocal) => ({
    human: true,
    async ask(duel, decision) {
      const n = step++;
      if (cancelled()) throw new OppResignedError();
      if (isLocal) {
        const arm = resignGate?.arm();
        let answer;
        try {
          answer = arm
            ? await Promise.race([player.ask(duel, decision), arm.promise])
            : await player.ask(duel, decision);
        } finally {
          arm?.cancel();
        }
        if (cancelled()) throw new OppResignedError();
        await postPvpAnswer(roomId, n, answer);
        return answer;
      }
      onRemoteWait?.(decision);
      try {
        return await waitPvpAnswer(roomId, n, { isCancelled: cancelled, resignGate });
      } finally {
        onRemoteDone?.(decision);
      }
    },
  });
  const p0 = wrap(localIsPlayer0 ? localPlayer : remotePlayer, localIsPlayer0);
  const p1 = wrap(localIsPlayer0 ? remotePlayer : localPlayer, !localIsPlayer0);
  return { players: [p0, p1], rngSeed: null };
}

export function seededRng(seed) {
  return mulberry32(Number(seed) || 1);
}
