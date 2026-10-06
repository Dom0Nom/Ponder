CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'book',
  color TEXT NOT NULL DEFAULT 'blue',
  tutor_style TEXT NOT NULL DEFAULT 'mixed',
  strict_grounding INTEGER NOT NULL DEFAULT 0,
  model_override TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  recap TEXT
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  summary TEXT,
  use_in_chat INTEGER NOT NULL DEFAULT 1,
  progress REAL NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sources_space ON sources(space_id);

-- pages: JSON array of [page_number, start_char_offset], ascending
CREATE TABLE source_texts (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  pages TEXT
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  page INTEGER,
  heading TEXT
);
CREATE INDEX chunks_source ON chunks(source_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE vec_chunks USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  space_id TEXT PARTITION KEY,
  embedding float[384] distance_metric=cosine
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  DELETE FROM vec_chunks WHERE chunk_id = old.id;
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX threads_space ON threads(space_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT,
  citations TEXT,
  meta TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_thread ON messages(thread_id, created_at);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  technique TEXT NOT NULL,
  config TEXT NOT NULL,
  goal TEXT,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  focus_ms INTEGER NOT NULL DEFAULT 0,
  break_ms INTEGER NOT NULL DEFAULT 0,
  pauses INTEGER NOT NULL DEFAULT 0,
  summary TEXT
);
CREATE INDEX focus_sessions_space ON focus_sessions(space_id, started_at);

CREATE TABLE focus_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  data TEXT
);
CREATE INDEX focus_events_session ON focus_events(session_id, at);

CREATE TABLE parking_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES focus_sessions(id) ON DELETE SET NULL,
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX journal_space ON journal_entries(space_id, created_at);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
