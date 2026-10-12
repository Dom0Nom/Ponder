CREATE TABLE study_plans (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  weekly_minutes INTEGER NOT NULL,
  study_days TEXT NOT NULL,
  replanned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,
  topic_id TEXT,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  done_at INTEGER
);

CREATE INDEX idx_plan_tasks_space_date ON plan_tasks(space_id, date);
CREATE INDEX idx_plan_tasks_date ON plan_tasks(date);
