"""Match-record / Google-auth / lobby / duel API (SQLite). Same routes as server/ Cloudflare Worker.

Local:
    set GOOGLE_CLIENT_ID=...
    set SESSION_SECRET=...
    python KirafanWeb/tools/api_server.py
    → http://127.0.0.1:8787  (API only)

Railway / production (static shell + API, same origin):
    HOST=0.0.0.0 PORT=… SERVE_STATIC=1 DATA_DIR=/data
    → serves *.html, css/, js/, assets/ and API routes on one port
"""
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import sqlite3
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(WEB, "data")).strip() or os.path.join(WEB, "data")
DB_PATH = os.path.join(DATA_DIR, "local_api.sqlite")
ROOMS_PATH = os.path.join(DATA_DIR, "lobby_rooms.json")
DUELS_DIR = os.path.join(DATA_DIR, "duels")
HOST = os.environ.get("HOST", "127.0.0.1").strip() or "127.0.0.1"
PORT = int(os.environ.get("PORT") or os.environ.get("API_PORT") or "8787")
SERVE_STATIC = os.environ.get("SERVE_STATIC", "").strip().lower() in ("1", "true", "yes", "on")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
SESSION_SECRET = os.environ.get("SESSION_SECRET", "kirafan-dev-secret-change-me").encode()
TOKEN_TTL = 60 * 60 * 24 * 30  # 30 days
MAX_ROOMS = 30

# Paths that must never be served as static files
_STATIC_BLOCK = (
    "/data/local_api.sqlite",
    "/data/lobby_rooms.json",
    "/data/duels",
    "/tools/",
    "/server/",
    "/.vercel/",
)

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              google_sub TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              picture TEXT,
              created_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS matches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              google_sub TEXT NOT NULL,
              client_id TEXT NOT NULL,
              result TEXT NOT NULL,
              level INTEGER NOT NULL,
              bot TEXT NOT NULL,
              turns INTEGER NOT NULL,
              played_at TEXT NOT NULL,
              my_deck TEXT NOT NULL,
              ai_deck TEXT NOT NULL,
              deck_hash TEXT NOT NULL,
              UNIQUE(google_sub, client_id)
            );
            CREATE INDEX IF NOT EXISTS idx_matches_sub ON matches(google_sub, played_at DESC);
            """
        )


def b64url(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    import base64

    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def make_token(sub: str, name: str) -> str:
    payload = json.dumps(
        {"sub": sub, "name": name, "exp": int(time.time()) + TOKEN_TTL},
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    body = b64url(payload)
    sig = b64url(hmac.new(SESSION_SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str):
    try:
        body, sig = token.split(".", 1)
        expect = b64url(hmac.new(SESSION_SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return None
        data = json.loads(b64url_decode(body))
        if int(data.get("exp", 0)) < time.time():
            return None
        return data
    except Exception:
        return None


def read_rooms() -> list:
    try:
        with open(ROOMS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        rooms = data.get("rooms", data) if isinstance(data, dict) else data
        return rooms if isinstance(rooms, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def write_rooms(rooms: list) -> list:
    os.makedirs(os.path.dirname(ROOMS_PATH), exist_ok=True)
    cleaned = []
    seen = set()
    for room in rooms:
        if not isinstance(room, dict) or not room.get("id"):
            continue
        rid = str(room["id"])
        if rid in seen:
            continue
        seen.add(rid)
        cleaned.append(room)
        if len(cleaned) >= MAX_ROOMS:
            break
    with open(ROOMS_PATH, "w", encoding="utf-8") as f:
        json.dump({"rooms": cleaned}, f, ensure_ascii=False, indent=2)
    return cleaned


def upsert_room(room: dict) -> list:
    rooms = [r for r in read_rooms() if str(r.get("id")) != str(room.get("id"))]
    rooms.insert(0, room)
    return write_rooms(rooms)


def delete_room(room_id: str) -> list:
    return write_rooms([r for r in read_rooms() if str(r.get("id")) != str(room_id)])


def duel_path(room_id: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(room_id))
    return os.path.join(DUELS_DIR, f"{safe}.json")


def read_duel(room_id: str) -> dict:
    path = duel_path(room_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def write_duel(room_id: str, data: dict) -> dict:
    os.makedirs(DUELS_DIR, exist_ok=True)
    path = duel_path(room_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def verify_google_id_token(id_token: str, expected_aud: str = "") -> dict:
    url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + quote(id_token)
    with urllib.request.urlopen(url, timeout=10) as res:
        info = json.loads(res.read().decode())
    aud = expected_aud or GOOGLE_CLIENT_ID
    if aud and info.get("aud") != aud:
        raise ValueError("aud mismatch")
    if not info.get("sub"):
        raise ValueError("no sub")
    if not str(info.get("aud") or "").endswith(".apps.googleusercontent.com"):
        raise ValueError("unexpected aud")
    return info


def _safe_static_path(url_path: str) -> str | None:
    """Map URL path → absolute file under WEB, or None if blocked / missing."""
    raw = unquote(url_path.split("?", 1)[0])
    if not raw or raw == "/":
        raw = "/index.html"
    low = raw.lower()
    if ".." in raw or low.startswith(_STATIC_BLOCK) or any(low.startswith(b) for b in _STATIC_BLOCK):
        return None
    # Block hidden / server internals
    parts = [p for p in raw.replace("\\", "/").split("/") if p]
    if any(p.startswith(".") for p in parts):
        return None
    if parts and parts[0] in ("tools", "server", ".vercel", "node_modules"):
        return None
    if parts[:2] == ["data", "duels"] or (len(parts) >= 2 and parts[0] == "data" and parts[1] in (
        "local_api.sqlite",
        "lobby_rooms.json",
    )):
        return None
    candidate = os.path.normpath(os.path.join(WEB, *parts))
    if not candidate.startswith(os.path.normpath(WEB) + os.sep) and candidate != os.path.normpath(WEB):
        return None
    if os.path.isdir(candidate):
        candidate = os.path.join(candidate, "index.html")
    if not os.path.isfile(candidate):
        return None
    return candidate


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _cors(self):
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Vary", "Origin")

    def _json(self, code: int, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _text(self, code: int, text: str):
        raw = text.encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _file(self, code: int, path: str):
        ctype, _ = mimetypes.guess_type(path)
        if not ctype:
            ctype = "application/octet-stream"
        if path.endswith(".js"):
            ctype = "text/javascript; charset=utf-8"
        elif path.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        elif path.endswith(".html"):
            ctype = "text/html; charset=utf-8"
        elif path.endswith(".json"):
            ctype = "application/json; charset=utf-8"
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        ext = os.path.splitext(path)[1].lower()
        if ext in (".html", ".js", ".css", ".json", ".mjs") or path.endswith("sw.js"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(raw)

    def _serve_static(self, url_path: str):
        if not SERVE_STATIC:
            return self._text(404, "not found")
        file_path = _safe_static_path(url_path)
        if not file_path:
            return self._text(404, "not found")
        return self._file(200, file_path)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode())

    def _auth(self):
        h = self.headers.get("Authorization") or ""
        if not h.startswith("Bearer "):
            return None
        return read_token(h[7:].strip())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {"ok": True})

        if path == "/me":
            auth = self._auth()
            if not auth:
                return self._text(401, "unauthorized")
            with db() as conn:
                row = conn.execute(
                    "SELECT google_sub, name, picture FROM users WHERE google_sub=?",
                    (auth["sub"],),
                ).fetchone()
            if not row:
                return self._text(401, "unknown user")
            return self._json(
                200,
                {"sub": row["google_sub"], "name": row["name"], "picture": row["picture"] or ""},
            )

        if path == "/matches/summary":
            auth = self._auth()
            if not auth:
                return self._text(401, "unauthorized")
            with db() as conn:
                rows = conn.execute(
                    "SELECT result, COUNT(*) AS c FROM matches WHERE google_sub=? GROUP BY result",
                    (auth["sub"],),
                ).fetchall()
            counts = {r["result"]: r["c"] for r in rows}
            wins = counts.get("승리", 0)
            losses = counts.get("패배", 0) + counts.get("항복", 0)
            draws = counts.get("무승부", 0)
            total = wins + losses + draws
            return self._json(200, {"total": total, "wins": wins, "losses": losses, "draws": draws})

        if path == "/matches":
            auth = self._auth()
            if not auth:
                return self._text(401, "unauthorized")
            qs = parse_qs(urlparse(self.path).query)
            limit = min(100, max(1, int((qs.get("limit") or ["50"])[0])))
            with db() as conn:
                rows = conn.execute(
                    """
                    SELECT client_id AS clientId, result, level, bot, turns,
                           played_at AS playedAt, my_deck AS myDeck, ai_deck AS aiDeck,
                           deck_hash AS deckHash
                    FROM matches WHERE google_sub=?
                    ORDER BY played_at DESC LIMIT ?
                    """,
                    (auth["sub"], limit),
                ).fetchall()
            return self._json(200, [dict(r) for r in rows])

        if path == "/rooms":
            return self._json(200, {"rooms": read_rooms()})

        if path.startswith("/duels/"):
            room_id = path[len("/duels/") :]
            if not room_id:
                return self._text(400, "id required")
            qs = parse_qs(urlparse(self.path).query)
            step = qs.get("step")
            data = read_duel(room_id)
            if step is not None:
                if not data:
                    return self._json(200, {"ok": False, "gone": True})
                if data.get("phase") == "resigned" or data.get("resignedBy"):
                    return self._json(200, {
                        "ok": False,
                        "resigned": True,
                        "resignedBy": str(data.get("resignedBy") or ""),
                    })
                key = str(step[0])
                answers = data.get("answers") or {}
                if key in answers:
                    step_out = int(key) if key.lstrip("-").isdigit() else key
                    return self._json(200, {"ok": True, "step": step_out, "answer": answers[key]})
                step_out = int(key) if key.lstrip("-").isdigit() else key
                return self._json(200, {"ok": False, "step": step_out})
            if not data:
                return self._json(200, {"ok": False, "gone": True})
            return self._json(200, data)

        return self._serve_static(path)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/rooms/"):
            room_id = path[len("/rooms/") :]
            if not room_id:
                return self._text(400, "id required")
            rooms = delete_room(room_id)
            return self._json(200, {"rooms": rooms})
        if path.startswith("/duels/"):
            room_id = path[len("/duels/") :]
            path_file = duel_path(room_id)
            if os.path.exists(path_file):
                os.remove(path_file)
            return self._json(200, {"ok": True})
        self._text(404, "not found")

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/auth/google":
            try:
                body = self._body()
                id_token = body.get("idToken") or ""
                client_id = str(body.get("clientId") or "").strip()
                if not id_token:
                    return self._text(400, "idToken required")
                info = verify_google_id_token(id_token, client_id or GOOGLE_CLIENT_ID)
                sub = info["sub"]
                name = info.get("name") or info.get("email") or "player"
                picture = info.get("picture") or ""
                now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                with db() as conn:
                    conn.execute(
                        """
                        INSERT INTO users(google_sub, name, picture, created_at, last_seen_at)
                        VALUES(?,?,?,?,?)
                        ON CONFLICT(google_sub) DO UPDATE SET
                          name=excluded.name,
                          picture=excluded.picture,
                          last_seen_at=excluded.last_seen_at
                        """,
                        (sub, name, picture, now, now),
                    )
                token = make_token(sub, name)
                return self._json(200, {"token": token, "sub": sub, "name": name, "picture": picture})
            except urllib.error.HTTPError as e:
                return self._text(401, f"google verify failed: {e.code}")
            except Exception as e:
                return self._text(401, f"google verify failed: {e}")

        if path == "/matches":
            auth = self._auth()
            if not auth:
                return self._text(401, "unauthorized")
            try:
                body = self._body()
                client_id = str(body.get("clientId") or "").strip()
                result = str(body.get("result") or "").strip()
                if not client_id or not result:
                    return self._text(400, "clientId and result required")
                level = int(body.get("level") or 0)
                bot = str(body.get("bot") or "")
                turns = int(body.get("turns") or 0)
                played_at = str(body.get("playedAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                my_deck = str(body.get("myDeck") or "")
                ai_deck = str(body.get("aiDeck") or "")
                deck_hash = str(body.get("deckHash") or "")
                with db() as conn:
                    try:
                        conn.execute(
                            """
                            INSERT INTO matches(
                              google_sub, client_id, result, level, bot, turns,
                              played_at, my_deck, ai_deck, deck_hash
                            ) VALUES(?,?,?,?,?,?,?,?,?,?)
                            """,
                            (
                                auth["sub"],
                                client_id,
                                result,
                                level,
                                bot,
                                turns,
                                played_at,
                                my_deck,
                                ai_deck,
                                deck_hash,
                            ),
                        )
                    except sqlite3.IntegrityError:
                        return self._json(409, {"ok": True, "duplicate": True})
                return self._json(201, {"ok": True})
            except Exception as e:
                return self._text(400, str(e))

        if path == "/rooms":
            try:
                body = self._body()
                room = body.get("room")
                if not isinstance(room, dict) or not room.get("id"):
                    return self._text(400, "room.id required")
                rooms = upsert_room(room)
                return self._json(200, {"rooms": rooms})
            except Exception as e:
                return self._text(400, str(e))

        if path.startswith("/duels/"):
            room_id = path[len("/duels/") :]
            if not room_id:
                return self._text(400, "id required")
            try:
                body = self._body()
                action = str(body.get("action") or "").strip()
                data = read_duel(room_id)
                if action == "coin":
                    # 동전: 누가 선후공을 고를지만 공유 (hostFirst 아직 없음)
                    data = {
                        "ok": True,
                        "phase": "coin",
                        "seed": int(body.get("seed") or 0),
                        "chooser": str(body.get("chooser") or ""),
                        "host": str(body.get("host") or ""),
                        "opp": str(body.get("opp") or ""),
                        "matchId": str(body.get("matchId") or ""),
                        "answers": {},
                    }
                    write_duel(room_id, data)
                    return self._json(200, data)
                if action == "init":
                    prev = data if isinstance(data, dict) else {}
                    data = {
                        "ok": True,
                        "phase": "ready",
                        "seed": int(body.get("seed") or prev.get("seed") or 0),
                        "hostFirst": bool(body.get("hostFirst")),
                        "chooser": str(body.get("chooser") or prev.get("chooser") or ""),
                        "host": str(body.get("host") or prev.get("host") or ""),
                        "opp": str(body.get("opp") or prev.get("opp") or ""),
                        "matchId": str(body.get("matchId") or prev.get("matchId") or ""),
                        "answers": {},
                    }
                    write_duel(room_id, data)
                    return self._json(200, data)
                if action == "answer":
                    step = body.get("step")
                    if step is None:
                        return self._text(400, "step required")
                    key = str(step)
                    if key.lstrip("-").isdigit():
                        key = str(int(key))
                    answers = dict(data.get("answers") or {})
                    answers[key] = body.get("answer")
                    data["answers"] = answers
                    data["ok"] = True
                    write_duel(room_id, data)
                    step_out = int(key) if key.lstrip("-").isdigit() else key
                    return self._json(200, {"ok": True, "step": step_out})
                if action == "resign":
                    # 항복: 듀얼 파일은 남겨 상대가 승리 처리를 하도록 한다
                    if not isinstance(data, dict) or not data:
                        data = {"ok": True, "answers": {}}
                    data["ok"] = True
                    data["phase"] = "resigned"
                    data["resignedBy"] = str(body.get("nick") or "")
                    data.pop("resignSoft", None)
                    write_duel(room_id, data)
                    return self._json(200, {"ok": True, "phase": "resigned", "resignedBy": data["resignedBy"]})
                return self._text(400, "unknown action")
            except Exception as e:
                return self._text(400, str(e))

        self._text(404, "not found")


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(DUELS_DIR, exist_ok=True)
    init_db()
    if not GOOGLE_CLIENT_ID:
        print("warning: GOOGLE_CLIENT_ID is empty — /auth/google will reject until set")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = "static+api" if SERVE_STATIC else "api-only"
    print(f"Kirafan {mode} http://{HOST}:{PORT}  db={DB_PATH}  web={WEB}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
