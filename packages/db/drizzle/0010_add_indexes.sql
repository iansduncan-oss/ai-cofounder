-- Add indexes on hot query paths for performance

-- Memories: most frequent hot path (recall by user)
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories (user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON memories (user_id, category);

-- Memories: vector search (pgvector HNSW index for cosine distance)
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);

-- Goals: filtered by conversation
CREATE INDEX IF NOT EXISTS idx_goals_conversation_id ON goals (conversation_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals (status);
CREATE INDEX IF NOT EXISTS idx_goals_milestone_id ON goals (milestone_id);

-- Tasks: filtered by goal and status
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks (goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_status ON tasks (goal_id, status);

-- LLM usage: range queries on created_at for usage summaries
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage (created_at);

-- Events: polled for unprocessed events
CREATE INDEX IF NOT EXISTS idx_events_processed ON events (processed) WHERE processed = false;

-- Schedules: polled every 60s for due schedules
CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run ON schedules (enabled, next_run_at) WHERE enabled = true;

-- Approvals: filtered by status for pending check
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);

-- Messages: filtered by conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);

-- Milestones: filtered by conversation
CREATE INDEX IF NOT EXISTS idx_milestones_conversation_id ON milestones (conversation_id);
