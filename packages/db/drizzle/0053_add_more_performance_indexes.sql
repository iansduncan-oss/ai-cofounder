-- Additional performance indexes beyond 0052
-- These cover hot query paths identified in post-merge audit

-- Conversations: workspace-scoped user queries (route filters by workspaceId)
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_user ON conversations(workspace_id, user_id);

-- Goals: composite index for workspace + status filtering (listActiveGoals + analytics)
CREATE INDEX IF NOT EXISTS idx_goals_workspace_status ON goals(workspace_id, status, deleted_at);

-- Approvals: composite index for task + status lookups (listApprovalsByTask)
-- Complements existing idx_approvals_task_id + idx_approvals_status
CREATE INDEX IF NOT EXISTS idx_approvals_task_status ON approvals(task_id, status);

-- Events: timestamp-based queries (listEvents, timeline views)
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_processed_created ON events(processed, created_at DESC);

-- Work sessions: recent timeline views
CREATE INDEX IF NOT EXISTS idx_work_sessions_created ON work_sessions(created_at DESC);
