CREATE TABLE watched_folders (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (space_id, path)
);

-- removed = file is gone from disk; its source is kept
CREATE TABLE watched_files (
  folder_id TEXT NOT NULL REFERENCES watched_folders(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (folder_id, rel_path)
);
CREATE INDEX watched_files_source ON watched_files(source_id);
