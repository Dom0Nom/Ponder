CREATE TABLE micro_steps (
  id TEXT PRIMARY KEY,
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  session_id TEXT,
  goal TEXT,
  text TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX micro_steps_space ON micro_steps(space_id, position);
