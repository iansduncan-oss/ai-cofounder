ALTER TABLE memories ADD COLUMN agent_role agent_role;
DROP INDEX IF EXISTS memories_user_id_key_unique;
CREATE UNIQUE INDEX memories_user_agent_key_unique
  ON memories (user_id, COALESCE(agent_role, '__null__'), key);
