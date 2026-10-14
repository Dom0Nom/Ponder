-- How each source goes into the model's context: auto (map + retrieved passages), summary, full.
-- "Off" stays the existing use_in_chat switch.
ALTER TABLE sources ADD COLUMN context_mode TEXT NOT NULL DEFAULT 'auto';

-- Conversation compaction: a summary of the messages up to summary_until (created_at, inclusive)
-- replaces them in what's sent to the model; the messages themselves stay.
ALTER TABLE threads ADD COLUMN summary TEXT;
ALTER TABLE threads ADD COLUMN summary_until INTEGER;
ALTER TABLE threads ADD COLUMN auto_compact INTEGER NOT NULL DEFAULT 1;

-- Table of contents per source, from PDF bookmarks, chunk headings or heading-like lines.
CREATE TABLE source_outlines (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  outline TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
