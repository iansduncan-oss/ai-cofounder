import type { Db } from "@ai-cofounder/db";
import { saveMemory } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import type { VerificationService } from "../../services/verification.js";
import type { DispatcherProgress } from "./types.js";

const logger = createLogger("task-dispatcher");

/**
 * Analyze execution results and store learnings as memories (fallback when the queue
 * is unavailable). Only produces a memory entry when there's something notable.
 */
export async function analyzeExecution(
  db: Db,
  goalId: string,
  goalTitle: string,
  status: string,
  taskResults: DispatcherProgress["tasks"],
  userId: string,
  workspaceId?: string,
): Promise<void> {
  const failed = taskResults.filter((t) => t.status === "failed");
  const succeeded = taskResults.filter((t) => t.status === "completed");

  // Only store learnings when there's something notable
  if (failed.length === 0 && succeeded.length <= 1) return;

  const parts: string[] = [`Goal "${goalTitle}" ${status}.`];
  parts.push(`${succeeded.length}/${taskResults.length} tasks succeeded.`);

  if (failed.length > 0) {
    const failSummary = failed
      .map((t) => `- ${t.title} (${t.agent}): ${(t.output ?? "unknown error").slice(0, 100)}`)
      .join("\n");
    parts.push(`Failed tasks:\n${failSummary}`);
  }

  // Identify which agent roles performed well or poorly
  const roleStats = new Map<string, { success: number; fail: number }>();
  for (const t of taskResults) {
    const stats = roleStats.get(t.agent) ?? { success: 0, fail: 0 };
    if (t.status === "completed") stats.success++;
    else if (t.status === "failed") stats.fail++;
    roleStats.set(t.agent, stats);
  }

  const roleInsights = Array.from(roleStats.entries())
    .filter(([, s]) => s.fail > 0)
    .map(([role, s]) => `${role}: ${s.success} ok, ${s.fail} failed`);

  if (roleInsights.length > 0) {
    parts.push(`Agent performance: ${roleInsights.join("; ")}`);
  }

  const content = parts.join(" ");
  const key = `execution-${goalId.slice(0, 8)}-${Date.now()}`;

  await saveMemory(db, {
    userId,
    category: "technical",
    key,
    content,
    source: `goal-execution:${goalId}`,
    workspaceId: workspaceId ?? "",
  });

  logger.info({ goalId, key }, "execution analysis saved as memory");
}

/**
 * Verify goal deliverables after completion.
 */
export async function verifyGoalCompletion(
  verificationService: VerificationService | undefined,
  goalId: string,
  goalTitle: string,
  taskResults: DispatcherProgress["tasks"],
  userId?: string,
  workspaceId?: string,
): Promise<void> {
  if (verificationService) {
    await verificationService.verify({ goalId, goalTitle, taskResults, userId, workspaceId });
    return;
  }

  // Fallback: no verification service configured, just log
  logger.info({ goalId }, "no verification service configured, skipping verification");
}
