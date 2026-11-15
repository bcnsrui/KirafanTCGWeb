/* Cloudflare Worker + D1 — same routes as tools/api_server.py */

const TOKEN_TTL = 60 * 60 * 24 * 30;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });
}

function text(request, status, body) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(request) },
  });
}

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

async function makeToken(env, sub, name) {
  const payload = JSON.stringify({ sub, name, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL });
  const body = b64url(new TextEncoder().encode(payload));
  const sig = b64url(await hmacSign(env.SESSION_SECRET, body));
  return `${body}.${sig}`;
}

async function readToken(env, token) {
  try {
    const [body, sig] = token.split(".");
    const expect = b64url(await hmacSign(env.SESSION_SECRET, body));
    if (sig !== expect) return null;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if ((data.exp || 0) < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

async function auth(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return readToken(env, h.slice(7).trim());
}

async function verifyGoogle(env, idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) throw new Error("verify failed");
  const info = await res.json();
  if (env.GOOGLE_CLIENT_ID && info.aud !== env.GOOGLE_CLIENT_ID) throw new Error("aud");
  if (!info.sub) throw new Error("sub");
  return info;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return json(request, 200, { ok: true });
    }

    if (request.method === "POST" && path === "/auth/google") {
      try {
        const { idToken } = await request.json();
        if (!idToken) return text(request, 400, "idToken required");
        if (!env.GOOGLE_CLIENT_ID) return text(request, 500, "GOOGLE_CLIENT_ID not configured");
        const info = await verifyGoogle(env, idToken);
        const sub = info.sub;
        const name = info.name || info.email || "player";
        const picture = info.picture || "";
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO users(google_sub, name, picture, created_at, last_seen_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(google_sub) DO UPDATE SET
             name=excluded.name, picture=excluded.picture, last_seen_at=excluded.last_seen_at`,
        )
          .bind(sub, name, picture, now, now)
          .run();
        const token = await makeToken(env, sub, name);
        return json(request, 200, { token, sub, name, picture });
      } catch (e) {
        return text(request, 401, `google verify failed: ${e.message || e}`);
      }
    }

    if (request.method === "GET" && path === "/me") {
      const a = await auth(request, env);
      if (!a) return text(request, 401, "unauthorized");
      const row = await env.DB.prepare(
        "SELECT google_sub, name, picture FROM users WHERE google_sub=?",
      )
        .bind(a.sub)
        .first();
      if (!row) return text(request, 401, "unknown user");
      return json(request, 200, { sub: row.google_sub, name: row.name, picture: row.picture || "" });
    }

    if (request.method === "GET" && path === "/matches/summary") {
      const a = await auth(request, env);
      if (!a) return text(request, 401, "unauthorized");
      const { results } = await env.DB.prepare(
        "SELECT result, COUNT(*) AS c FROM matches WHERE google_sub=? GROUP BY result",
      )
        .bind(a.sub)
        .all();
      const counts = Object.fromEntries((results || []).map((r) => [r.result, r.c]));
      const wins = counts["승리"] || 0;
      const losses = (counts["패배"] || 0) + (counts["항복"] || 0);
      const draws = counts["무승부"] || 0;
      return json(request, 200, { total: wins + losses + draws, wins, losses, draws });
    }

    if (request.method === "GET" && path === "/matches") {
      const a = await auth(request, env);
      if (!a) return text(request, 401, "unauthorized");
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const { results } = await env.DB.prepare(
        `SELECT client_id AS clientId, result, level, bot, turns,
                played_at AS playedAt, my_deck AS myDeck, ai_deck AS aiDeck, deck_hash AS deckHash
         FROM matches WHERE google_sub=? ORDER BY played_at DESC LIMIT ?`,
      )
        .bind(a.sub, limit)
        .all();
      return json(request, 200, results || []);
    }

    if (request.method === "POST" && path === "/matches") {
      const a = await auth(request, env);
      if (!a) return text(request, 401, "unauthorized");
      try {
        const body = await request.json();
        const clientId = String(body.clientId || "").trim();
        const result = String(body.result || "").trim();
        if (!clientId || !result) return text(request, 400, "clientId and result required");
        try {
          await env.DB.prepare(
            `INSERT INTO matches(
               google_sub, client_id, result, level, bot, turns,
               played_at, my_deck, ai_deck, deck_hash
             ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          )
            .bind(
              a.sub,
              clientId,
              result,
              Number(body.level) || 0,
              String(body.bot || ""),
              Number(body.turns) || 0,
              String(body.playedAt || new Date().toISOString()),
              String(body.myDeck || ""),
              String(body.aiDeck || ""),
              String(body.deckHash || ""),
            )
            .run();
        } catch (e) {
          if (String(e.message || e).includes("UNIQUE")) {
            return json(request, 409, { ok: true, duplicate: true });
          }
          throw e;
        }
        return json(request, 201, { ok: true });
      } catch (e) {
        return text(request, 400, String(e.message || e));
      }
    }

    return text(request, 404, "not found");
  },
};
