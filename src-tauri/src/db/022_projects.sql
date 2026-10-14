-- Projects: milestones linked to skill-graph topics and a dated build log.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX projects_space ON projects(space_id, updated_at);

CREATE TABLE project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic_ids TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX project_milestones_project ON project_milestones(project_id, position);

CREATE TABLE project_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  photo TEXT,
  code TEXT,
  code_result TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX project_log_project ON project_log(project_id, created_at);
