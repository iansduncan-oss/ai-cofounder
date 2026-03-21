-- Episodic memory: conversation-level summaries with semantic search
CREATE TABLE IF NOT EXISTS episodic_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_decisions JSONB DEFAULT '[]',
  tools_used TEXT[] DEFAULT '{}',
  goals_worked_on JSONB DEFAULT '[]',
  emotional_context TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodic_memories_conversation ON episodic_memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_episodic_memories_importance ON episodic_memories(importance DESC);
