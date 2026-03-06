-- Add FK constraints to llmUsage columns (previously unconstrained)
ALTER TABLE llm_usage ADD CONSTRAINT llm_usage_goal_id_fk FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE llm_usage ADD CONSTRAINT llm_usage_task_id_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE llm_usage ADD CONSTRAINT llm_usage_conversation_id_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- Add check constraint on work_sessions.status
ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_status_check CHECK (status IN ('running', 'completed', 'failed'));

-- Fix prompts.is_active from integer to boolean (migration)
-- Step 1: Add new boolean column
ALTER TABLE prompts ADD COLUMN is_active_bool boolean NOT NULL DEFAULT true;
-- Step 2: Copy data
UPDATE prompts SET is_active_bool = (is_active = 1);
-- Step 3: Drop old column
ALTER TABLE prompts DROP COLUMN is_active;
-- Step 4: Rename new column
ALTER TABLE prompts RENAME COLUMN is_active_bool TO is_active;
