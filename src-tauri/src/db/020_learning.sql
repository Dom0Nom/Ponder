-- confidence: 0 guess, 1 unsure, 2 sure; NULL when skipped
ALTER TABLE practice_attempts ADD COLUMN confidence INTEGER;
ALTER TABLE review_logs ADD COLUMN confidence INTEGER;

-- state: learning | retest | mastered
CREATE TABLE mastery_evidence (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'learning',
  learned_at INTEGER NOT NULL,
  retest_due_at INTEGER,
  passed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, topic_key)
);
