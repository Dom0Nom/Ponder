-- Worksheets: data holds the sheet (options, tasks, key) and the learner's attempt as JSON.
-- Rich-question responses (kind + raw response) live inside exam_attempts.data, so that table needs no change.
CREATE TABLE worksheets (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX worksheets_space ON worksheets(space_id, updated_at);
