-- 0023: Self-healing deploys + contextual awareness
-- Adds soak monitoring fields to deployments, circuit breaker table,
-- session engagement table, and timezone to users.

-- Create deployments table (referenced by schema but no prior migration creates it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deploy_status') THEN
    CREATE TYPE deploy_status AS ENUM ('started','building','deploying','verifying','healthy','failed','rolled_back');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_sha text NOT NULL,
  short_sha text NOT NULL,
  branch text NOT NULL DEFAULT 'main',
  status deploy_status NOT NULL DEFAULT 'started',
  services jsonb,
  previous_sha text,
  triggered_by text NOT NULL DEFAULT 'ci',
  health_checks jsonb,
  error_log text,
  root_cause_analysis text,
  rolled_back boolean NOT NULL DEFAULT false,
  rollback_sha text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Add soak monitoring + remediation fields to deployments
ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS soak_status text,
  ADD COLUMN IF NOT EXISTS soak_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS soak_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS soak_metrics jsonb,
  ADD COLUMN IF NOT EXISTS remediation_actions jsonb,
  ADD COLUMN IF NOT EXISTS git_diff_summary text;

-- Deploy circuit breaker (single-row table tracking auto-deploy pause state)
CREATE TABLE IF NOT EXISTS deploy_circuit_breaker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_paused boolean NOT NULL DEFAULT false,
  paused_at timestamptz,
  paused_reason text,
  failure_count integer NOT NULL DEFAULT 0,
  failure_window_start timestamptz,
  resumed_at timestamptz,
  resumed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Session engagement tracking
CREATE TABLE IF NOT EXISTS session_engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  session_start timestamptz NOT NULL DEFAULT now(),
  message_count integer NOT NULL DEFAULT 0,
  avg_message_length integer NOT NULL DEFAULT 0,
  avg_response_interval_ms integer NOT NULL DEFAULT 0,
  complexity_score integer NOT NULL DEFAULT 50,
  energy_level text NOT NULL DEFAULT 'normal',
  last_message_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_engagement_user_id ON session_engagement(user_id);
CREATE INDEX IF NOT EXISTS idx_session_engagement_session_start ON session_engagement(session_start DESC);

-- Add timezone to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;

