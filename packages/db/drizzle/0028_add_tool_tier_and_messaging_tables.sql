-- 0028: Add tool_tier_config, user_actions, user_patterns, agent_messages tables
-- These tables were created via db:push during dev but never had migration files.

-- ── Enum: autonomy_tier ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autonomy_tier') THEN
    CREATE TYPE autonomy_tier AS ENUM ('green', 'yellow', 'red');
  END IF;
END
$$;

-- ── Enum: user_action_type ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_action_type') THEN
    CREATE TYPE user_action_type AS ENUM (
      'chat_message',
      'goal_created',
      'deploy_triggered',
      'suggestion_accepted',
      'approval_submitted',
      'schedule_created',
      'tool_executed',
      'goal_viewed',
      'goal_executed'
    );
  END IF;
END
$$;

-- ── Enum: agent_message_type ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_message_type') THEN
    CREATE TYPE agent_message_type AS ENUM (
      'request',
      'response',
      'broadcast',
      'notification',
      'handoff'
    );
  END IF;
END
$$;

-- ── Enum: agent_message_status ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_message_status') THEN
    CREATE TYPE agent_message_status AS ENUM (
      'pending',
      'delivered',
      'read',
      'expired'
    );
  END IF;
END
$$;

-- ── Table: tool_tier_config ──
CREATE TABLE IF NOT EXISTS tool_tier_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL UNIQUE,
  tier autonomy_tier NOT NULL DEFAULT 'green',
  timeout_ms integer NOT NULL DEFAULT 300000,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Table: user_actions ──
CREATE TABLE IF NOT EXISTS user_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  action_type user_action_type NOT NULL,
  action_detail text,
  day_of_week integer NOT NULL,
  hour_of_day integer NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_created_at ON user_actions(created_at DESC);

-- ── Table: user_patterns ──
CREATE TABLE IF NOT EXISTS user_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  description text NOT NULL,
  trigger_condition jsonb NOT NULL,
  suggested_action text NOT NULL,
  confidence integer NOT NULL DEFAULT 50,
  hit_count integer NOT NULL DEFAULT 0,
  accept_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_patterns_user_id ON user_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_user_patterns_is_active ON user_patterns(is_active) WHERE is_active = true;

-- ── Table: agent_messages ──
CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_role agent_role NOT NULL,
  sender_run_id text,
  target_role agent_role,
  target_run_id text,
  channel text,
  message_type agent_message_type NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  correlation_id uuid,
  in_reply_to uuid,
  goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status agent_message_status NOT NULL DEFAULT 'pending',
  priority goal_priority NOT NULL DEFAULT 'medium',
  expires_at timestamptz,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_target_role ON agent_messages(target_role);
CREATE INDEX IF NOT EXISTS idx_agent_messages_channel ON agent_messages(channel);
CREATE INDEX IF NOT EXISTS idx_agent_messages_status ON agent_messages(status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_goal_id ON agent_messages(goal_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at ON agent_messages(created_at DESC);
