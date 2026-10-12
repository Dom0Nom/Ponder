-- Generated Studio outputs (reports, cheat sheets, worksheets, timelines, tables, mind maps, diagrams, slides,
-- infographics). data is the kind's JSON.
CREATE TABLE studio_outputs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  focus TEXT,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX studio_outputs_space ON studio_outputs(space_id, updated_at);
