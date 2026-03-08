-- Reflections table for post-goal learning and pattern extraction

DO $$ BEGIN
  CREATE TYPE "reflection_type" AS ENUM ('goal_completion', 'failure_analysis', 'pattern_extraction', 'weekly_summary');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "reflections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "goal_id" uuid REFERENCES "goals"("id") ON DELETE SET NULL,
  "reflection_type" "reflection_type" NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(768),
  "lessons" jsonb,
  "agent_performance" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- HNSW index for fast cosine similarity search on reflection embeddings
CREATE INDEX IF NOT EXISTS idx_reflections_embedding
  ON reflections USING hnsw (embedding vector_cosine_ops);

-- B-tree indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reflections_goal_id
  ON reflections (goal_id);

CREATE INDEX IF NOT EXISTS idx_reflections_type
  ON reflections (reflection_type);

CREATE INDEX IF NOT EXISTS idx_reflections_created_at
  ON reflections (created_at DESC);
