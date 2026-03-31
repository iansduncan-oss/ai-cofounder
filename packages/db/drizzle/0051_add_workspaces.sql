-- Multi-workspace tenancy: add workspaces table and workspace_id to core tables

-- 1. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add nullable workspace_id columns to all scoped tables
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE user_actions ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE user_patterns ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE episodic_memories ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- 3. Insert a default workspace linked to the first admin user
INSERT INTO workspaces (name, slug, owner_id, is_default)
SELECT 'Default', 'default', id, true
FROM admin_users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (slug) DO NOTHING;

-- 4. Backfill all existing rows with the default workspace ID
DO $$
DECLARE
  default_ws_id UUID;
BEGIN
  SELECT id INTO default_ws_id FROM workspaces WHERE slug = 'default' LIMIT 1;

  IF default_ws_id IS NOT NULL THEN
    UPDATE conversations SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE goals SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE tasks SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE memories SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE llm_usage SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE schedules SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE user_actions SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE user_patterns SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE follow_ups SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
    UPDATE episodic_memories SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
  END IF;
END $$;

-- 5. Keep workspace_id nullable for now — callers don't all pass it yet.
-- A future migration will SET NOT NULL once all code paths resolve workspaces.

-- 6. Add FK constraints
ALTER TABLE conversations ADD CONSTRAINT conversations_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE goals ADD CONSTRAINT goals_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE memories ADD CONSTRAINT memories_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE llm_usage ADD CONSTRAINT llm_usage_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE schedules ADD CONSTRAINT schedules_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE user_actions ADD CONSTRAINT user_actions_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE user_patterns ADD CONSTRAINT user_patterns_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE episodic_memories ADD CONSTRAINT episodic_memories_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- 7. Create indexes on workspace_id for query performance
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_workspace ON llm_usage(workspace_id);
CREATE INDEX IF NOT EXISTS idx_schedules_workspace ON schedules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_workspace ON user_actions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_patterns_workspace ON user_patterns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_workspace ON follow_ups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_episodic_memories_workspace ON episodic_memories(workspace_id);

-- 8. Update userPatterns unique index to include workspace_id
DROP INDEX IF EXISTS idx_user_patterns_user_type;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_patterns_user_workspace_type ON user_patterns(user_id, workspace_id, pattern_type);
