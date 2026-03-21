-- Memory lifecycle: archival support for the memories table
ALTER TABLE memories ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_memories_not_archived ON memories(user_id) WHERE archived_at IS NULL;
