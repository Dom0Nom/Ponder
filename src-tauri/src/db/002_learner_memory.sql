CREATE TABLE learner_memory (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'user',
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX learner_memory_created ON learner_memory(created_at);
