import type { LlmToolUseContent } from "@ai-cofounder/llm";
import { createApproval, getApproval, resolveApproval } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { notifyApprovalCreated } from "../../services/notifications.js";
import type { ToolExecutorServices, ToolExecutorContext } from "./types.js";
import { executeSharedTool } from "./shared-tool-executor.js";

const logger = createLogger("tool-executor:tier-dispatch");

/** Tools that always require approval (external communication on behalf of the user) */
const ALWAYS_REQUIRE_APPROVAL = new Set([
  "send_email",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "respond_to_calendar_event",
]);

/**
 * Execute a yellow-tier tool: create approval, notify, poll until resolved or timeout.
 */
async function executeYellowTierTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, autonomyTierService } = services;
  if (!db) return { error: "Database not available for approval workflow" };

  // Autonomous sessions auto-approve most YELLOW tools (human reviews the PR, not the push).
  // Tools that communicate externally on the user's behalf always require approval.
  if (context.isAutonomous && !ALWAYS_REQUIRE_APPROVAL.has(block.name)) {
    logger.info({ toolName: block.name }, "yellow-tier tool auto-approved for autonomous session");
    return executeSharedTool(block, services, context);
  }

  const timeoutMs = autonomyTierService?.getTimeoutMs(block.name) ?? 300_000;
  const reason = `Tool "${block.name}" requires approval before execution (yellow tier). Input: ${JSON.stringify(block.input).slice(0, 200)}`;

  const approval = await createApproval(db, {
    taskId: context.goalId ?? undefined,
    requestedBy: (context.agentRole ?? "orchestrator") as
      | "orchestrator"
      | "researcher"
      | "coder"
      | "reviewer"
      | "planner",
    reason,
  });

  // Notify via available channels (fire-and-forget)
  notifyApprovalCreated({
    approvalId: approval.id,
    taskId: approval.taskId ?? "ad-hoc",
    reason,
    requestedBy: context.agentRole ?? "orchestrator",
  }).catch((err) => logger.warn({ err }, "approval notification failed"));

  logger.info(
    { approvalId: approval.id, toolName: block.name, timeoutMs },
    "yellow-tier approval requested",
  );

  // Poll until approved/rejected/timeout
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL = 2000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    const current = await getApproval(db, approval.id);
    if (!current) break;

    if (current.status === "approved") {
      logger.info(
        { approvalId: approval.id, toolName: block.name },
        "yellow-tier tool approved, executing",
      );
      return executeSharedTool(block, services, context);
    }

    if (current.status === "rejected") {
      logger.info({ approvalId: approval.id, toolName: block.name }, "yellow-tier tool rejected");
      return {
        error: `Tool "${block.name}" was rejected by the user. Reason: ${current.decision ?? "No reason provided"}`,
      };
    }
  }

  // Timeout — auto-deny
  await resolveApproval(db, approval.id, "rejected", "Auto-denied: approval timeout exceeded");
  logger.warn(
    { approvalId: approval.id, toolName: block.name, timeoutMs },
    "yellow-tier tool timed out",
  );
  return {
    error: `Tool "${block.name}" approval timed out after ${Math.round(timeoutMs / 1000)}s. The request has been auto-denied.`,
  };
}

/**
 * Tier-aware tool execution wrapper.
 * - Green: passes directly to executeSharedTool
 * - Yellow: creates approval record, polls until resolved
 * - Red: blocks with error (defense-in-depth even if LLM somehow calls a red tool)
 *
 * Falls through to executeSharedTool when no autonomyTierService is provided (backward compat).
 */
export async function executeWithTierCheck(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { autonomyTierService } = services;

  // Backward compat: no tier service — behave as if all tools are green
  if (!autonomyTierService) {
    return executeSharedTool(block, services, context);
  }

  const tier = autonomyTierService.getTier(block.name);

  if (tier === "red") {
    logger.warn({ toolName: block.name }, "red-tier tool execution blocked");
    return {
      error: `Tool "${block.name}" is in the red tier and cannot be executed. This operation has been blocked for safety.`,
    };
  }

  if (tier === "yellow") {
    return executeYellowTierTool(block, services, context);
  }

  // Green — pass through immediately
  return executeSharedTool(block, services, context);
}
