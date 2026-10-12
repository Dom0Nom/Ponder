-- One timed exam section attempt. data holds questions, answers, flags and the essay as JSON;
-- completed_at is NULL while the attempt is still running so it can be resumed.
CREATE TABLE exam_attempts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL,
  section TEXT NOT NULL,
  length TEXT NOT NULL,
  data TEXT NOT NULL,
  score REAL,
  scaled INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  time_used_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX exam_attempts_space ON exam_attempts(space_id, started_at);
