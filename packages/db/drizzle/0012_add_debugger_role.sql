-- Add 'debugger' to agent_role enum
ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'debugger';
