ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'blocked';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on jsonb;
