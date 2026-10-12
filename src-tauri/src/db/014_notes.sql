-- Markdown notes per space. When use_as_source is on, source_id points at a source row that mirrors the body.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  use_as_source INTEGER NOT NULL DEFAULT 0,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_space ON notes(space_id, updated_at);

-- Auto glossary for a source or a note (subject_id). text_hash says which text it was made from.
CREATE TABLE glossaries (
  subject_id TEXT PRIMARY KEY,
  text_hash TEXT NOT NULL,
  entries TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Reading-level rewrites and translations of passages. kind is "level:simpler", "level:advanced" or "lang:<name>".
CREATE TABLE passage_rewrites (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  text_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, kind, start_offset, end_offset)
);
