import type { Db } from "@ai-cofounder/db";
import { recordUserAction } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("action-recorder");

/** Fire-and-forget action recording — never throws. */
export function recordActionSafe(
  db: Db,
  action: {
    workspaceId?: string;
    userId?: string;
    actionType: string;
    actionDetail?: string;
    metadata?: Record<string, unknown>;
  },
) {
  recordUserAction(db, action as Parameters<typeof recordUserAction>[1]).catch((err) =>
    logger.warn({ err }, "user action recording failed"),
  );
}
