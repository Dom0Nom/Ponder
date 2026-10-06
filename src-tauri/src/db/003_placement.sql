CREATE TABLE space_curricula (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  curriculum_id TEXT NOT NULL,
  title TEXT NOT NULL,
  topics TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE topic_levels (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  level TEXT NOT NULL,
  evidence TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, topic_id)
);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  topic_id TEXT,
  title TEXT NOT NULL,
  questions TEXT NOT NULL,
  answers TEXT,
  score REAL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX assessments_space ON assessments(space_id, created_at);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  score REAL,
  completed_at INTEGER
);
CREATE INDEX lessons_course ON lessons(course_id, ord);
