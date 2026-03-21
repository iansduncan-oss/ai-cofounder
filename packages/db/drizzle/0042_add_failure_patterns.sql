-- Failure patterns: track tool errors and resolutions for self-improvement
CREATE TABLE IF NOT EXISTS failure_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  error_category TEXT NOT NULL,
  error_message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  resolution TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_failure_patterns_tool_category ON failure_patterns(tool_name, error_category);
