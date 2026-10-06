-- kind: basic | cloze | occlusion | mcq; data holds kind-specific fields (cloze text, image + masks, options)
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  data TEXT,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  chunk_start INTEGER,
  chunk_end INTEGER,
  origin TEXT NOT NULL DEFAULT 'manual',
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX cards_space ON cards(space_id);

-- FSRS memory state as the scheduler's JSON; due/state duplicated for queries
CREATE TABLE card_state (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  due INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  fsrs TEXT
);
CREATE INDEX card_state_due ON card_state(due);

CREATE TABLE review_logs (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL,
  duration_ms INTEGER,
  log TEXT
);
CREATE INDEX review_logs_card ON review_logs(card_id, reviewed_at);

CREATE TABLE mistakes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  question TEXT NOT NULL,
  given TEXT,
  correct TEXT NOT NULL,
  explanation TEXT,
  topic TEXT,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX mistakes_space ON mistakes(space_id, created_at);
