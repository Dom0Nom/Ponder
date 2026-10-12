-- Sources and notes other apps hand over through the MCP server. The app imports pending rows while it's open.
CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'url', 'file', 'note')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  target TEXT,
  use_as_source INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
  error TEXT,
  result_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX inbox_status ON inbox(status, created_at);
