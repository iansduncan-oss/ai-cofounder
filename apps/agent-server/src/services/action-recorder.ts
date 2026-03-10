import type { Db } from "@ai-cofounder/db";
import { recordUserAction } from "@ai-cofounder/db";

type ActionType =
  | "chat_message"
  | "goal_created"
  | "deploy_triggered"
  | "suggestion_accepted"
  | "approval_submitted"
  | "schedule_created"
  | "tool_executed";

/** Fire-and-forget action recording — never throws. */
export function recordActionSafe(
  db: Db,
  action: {
    userId?: string;
    actionType: ActionType;
    actionDetail?: string;
    metadata?: Record<string, unknown>;
  },
) {
  recordUserAction(db, action).catch(() => {}); // non-fatal
}
