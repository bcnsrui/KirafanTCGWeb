/** 탭/창마다 sessionStorage 를 공유하므로, 닉네임별로 매치 정보를 나눠 저장합니다. */
const MATCH_STORE = "kirafan.match";
const NICK_STORE = "kirafan.server.nick";

export function currentNick() {
  return (
    sessionStorage.getItem(NICK_STORE) ||
    localStorage.getItem(NICK_STORE) ||
    ""
  ).trim();
}

export function saveMatch(match, nick = currentNick()) {
  const key = nick || "_";
  let all = {};
  try {
    all = JSON.parse(sessionStorage.getItem(MATCH_STORE) || "{}");
    if (!all || typeof all !== "object" || Array.isArray(all)) all = {};
    // 예전 형식(단일 매치 객체)이면 비움
    if (all.me && all.ai && !all.byNick) all = {};
  } catch {
    all = {};
  }
  if (!all.byNick || typeof all.byNick !== "object") all.byNick = {};
  const payload = { ...match, localNick: match.localNick || nick || match.localNick };
  all.byNick[key] = payload;
  all.lastNick = key;
  sessionStorage.setItem(MATCH_STORE, JSON.stringify(all));
  // 하위 호환: AI 대전 등 단일 키도 유지
  sessionStorage.setItem(`${MATCH_STORE}.one`, JSON.stringify(payload));
  return payload;
}

export function loadMatchData(nick = currentNick()) {
  try {
    const raw = sessionStorage.getItem(MATCH_STORE);
    if (!raw) {
      const one = sessionStorage.getItem(`${MATCH_STORE}.one`);
      return one ? JSON.parse(one) : null;
    }
    const data = JSON.parse(raw);
    if (data?.me && data?.ai && !data.byNick) return data; // 예전 형식
    const key = nick || data.lastNick || "_";
    const match = data?.byNick?.[key] || data?.byNick?.[data.lastNick];
    if (match?.me && match?.ai) return match;
    const one = sessionStorage.getItem(`${MATCH_STORE}.one`);
    return one ? JSON.parse(one) : null;
  } catch {
    return null;
  }
}
