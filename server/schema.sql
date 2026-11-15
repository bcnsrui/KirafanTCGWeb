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
