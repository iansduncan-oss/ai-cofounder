-- Add CASCADE / SET NULL delete policies to original FK constraints
-- These were defined in schema.ts but the migrations hadn't been generated

-- conversations.user_id -> CASCADE
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_user_id_users_id_fk";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- messages.conversation_id -> CASCADE
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_conversations_id_fk";
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- goals.conversation_id -> CASCADE
ALTER TABLE "goals" DROP CONSTRAINT "goals_conversation_id_conversations_id_fk";
ALTER TABLE "goals" ADD CONSTRAINT "goals_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- goals.created_by -> SET NULL
ALTER TABLE "goals" DROP CONSTRAINT "goals_created_by_users_id_fk";
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- tasks.goal_id -> CASCADE
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_goal_id_goals_id_fk";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk"
  FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- approvals.task_id -> CASCADE
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_task_id_tasks_id_fk";
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- approvals.decided_by -> SET NULL
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_decided_by_users_id_fk";
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk"
  FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- channel_conversations.conversation_id -> CASCADE
ALTER TABLE "channel_conversations" DROP CONSTRAINT "channel_conversations_conversation_id_conversations_id_fk";
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- memories.user_id -> CASCADE
ALTER TABLE "memories" DROP CONSTRAINT "memories_user_id_users_id_fk";
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
