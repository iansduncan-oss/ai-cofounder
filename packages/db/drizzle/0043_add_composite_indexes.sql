-- Composite indexes for query performance
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_status ON tasks(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON memories(user_id, category);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_user ON llm_usage(created_at, user_id);
