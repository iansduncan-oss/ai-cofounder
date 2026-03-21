-- Procedural memory: learned procedures from completed goals
CREATE TABLE IF NOT EXISTS procedural_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_pattern TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  preconditions JSONB DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used TIMESTAMPTZ,
  created_from_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  tags JSONB DEFAULT '[]',
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procedural_memories_success ON procedural_memories(success_count DESC);
