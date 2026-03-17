ALTER TABLE memories ADD COLUMN agent_role agent_role;
DROP INDEX IF EXISTS memories_user_id_key_unique;
-- Two partial indexes enforce uniqueness on (user_id, agent_role, key)
-- treating NULL agent_role as its own distinct group
CREATE UNIQUE INDEX memories_user_agent_key_with_role
  ON memories (user_id, agent_role, key) WHERE agent_role IS NOT NULL;
CREATE UNIQUE INDEX memories_user_agent_key_null_role
  ON memories (user_id, key) WHERE agent_role IS NULL;
