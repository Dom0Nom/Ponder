-- theta: Rasch ability estimate per topic (logit scale), n: answered items
CREATE TABLE abilities (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  theta REAL NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, topic_key)
);

CREATE TABLE practice_items (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT,
  answer TEXT NOT NULL,
  solution TEXT NOT NULL,
  difficulty REAL NOT NULL,
  parent_id TEXT REFERENCES practice_items(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX practice_items_topic ON practice_items(space_id, topic_key);

CREATE TABLE practice_attempts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES practice_items(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  response TEXT NOT NULL,
  correct INTEGER NOT NULL,
  theta_before REAL NOT NULL,
  theta_after REAL NOT NULL,
  error_type TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX practice_attempts_space ON practice_attempts(space_id, created_at);

ALTER TABLE mistakes ADD COLUMN error_type TEXT;
