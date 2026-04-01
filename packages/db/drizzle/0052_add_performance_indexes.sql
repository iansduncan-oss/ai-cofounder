-- Performance indexes for frequently-queried columns missing coverage

-- Approvals: listPendingApprovals does full table scan on status
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approvals(task_id);

-- Conversations: listConversationsByUser filters (user_id, deleted_at)
CREATE INDEX IF NOT EXISTS idx_conversations_user_deleted ON conversations(user_id) WHERE deleted_at IS NULL;

-- Goals: listActiveGoals, listGoalsByConversation filter (status, deleted_at)
CREATE INDEX IF NOT EXISTS idx_goals_status_active ON goals(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_goals_conversation ON goals(conversation_id) WHERE deleted_at IS NULL;

-- Memories: recallMemories + vector search filter (user_id, workspace_id)
CREATE INDEX IF NOT EXISTS idx_memories_user_workspace ON memories(user_id, workspace_id);

-- User actions: pattern learning queries filter (user_id, created_at)
CREATE INDEX IF NOT EXISTS idx_user_actions_user_created ON user_actions(user_id, created_at DESC);

-- Deployments: health checks filter (status, created_at)
CREATE INDEX IF NOT EXISTS idx_deployments_status_created ON deployments(status, created_at DESC);

-- Agent messages: queue processing filter (status, created_at)
CREATE INDEX IF NOT EXISTS idx_agent_messages_status ON agent_messages(status, created_at);

-- Document chunks: RAG retrieval filter (source_type, source_id)
CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks(source_type, source_id);

-- Follow-ups: listFollowUps filters (status), listDueFollowUps filters (due_date)
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(due_date) WHERE status = 'pending';

-- LLM usage: cost analytics filter (created_at, workspace_id)
CREATE INDEX IF NOT EXISTS idx_llm_usage_workspace_created ON llm_usage(workspace_id, created_at DESC);

-- Episodic memories: vector search + conversation lookup
CREATE INDEX IF NOT EXISTS idx_episodic_memories_conversation ON episodic_memories(conversation_id);
