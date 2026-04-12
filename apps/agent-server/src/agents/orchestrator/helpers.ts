import type {
  LlmRegistry,
  LlmTool,
  LlmTextContent,
  LlmThinkingContent,
  LlmToolUseContent,
  LlmToolResultContent,
} from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import {
  saveThinkingTrace,
  createApproval,
  getApproval,
  listPendingApprovals,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { notifyApprovalCreated } from "../../services/notifications.js";

const logger = createLogger("orchestrator-helpers");

/**
 * Call registry.complete with retry on transient failures (429/503).
 * Exponential backoff: 2s, 4s. Max 2 retries.
 */
export async function completeWithRetry(
  registry: LlmRegistry,
  ...args: Parameters<LlmRegistry["complete"]>
): ReturnType<LlmRegistry["complete"]> {
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await registry.complete(...args);
    } catch (err: unknown) {
      const isRetryable =
        err instanceof Error &&
        (/429|rate.limit/i.test(err.message) ||
          /503|service.unavailable/i.test(err.message) ||
          /ECONNRESET|ECONNREFUSED|timeout/i.test(err.message));

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn(
        { attempt: attempt + 1, delay, error: (err as Error).message },
        "LLM call failed, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("completeWithRetry: exhausted retries");
}

/**
 * Extract native thinking content blocks, store as traces, and return only non-thinking blocks.
 * Also parses legacy <thinking> tags from text blocks for backward compatibility.
 */
export function extractAndStoreThinking(
  contentBlocks: (LlmTextContent | LlmThinkingContent | LlmToolUseContent | LlmToolResultContent)[],
  options: { db?: Db; conversationId: string; round: number; requestId?: string },
): (LlmTextContent | LlmToolUseContent | LlmToolResultContent)[] {
  const { db, conversationId, round, requestId } = options;
  const result: (LlmTextContent | LlmToolUseContent | LlmToolResultContent)[] = [];

  for (const block of contentBlocks) {
    if (block.type === "thinking") {
      // Native thinking block from extended thinking
      if (db && block.thinking) {
        saveThinkingTrace(db, {
          conversationId,
          requestId,
          round,
          content: block.thinking,
        }).catch((err) => logger.warn({ err }, "thinking trace save failed")); // fire-and-forget
      }
      continue; // Filter out thinking blocks
    }

    if (block.type === "text") {
      // Legacy: parse <thinking> tags from text content
      const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
      let match: RegExpExecArray | null;
      const thinkingBlocks: string[] = [];
      while ((match = thinkingRegex.exec(block.text)) !== null) {
        thinkingBlocks.push(match[1].trim());
      }
      if (thinkingBlocks.length > 0 && db) {
        for (const tb of thinkingBlocks) {
          saveThinkingTrace(db, {
            conversationId,
            requestId,
            round,
            content: tb,
          }).catch((err) => logger.warn({ err }, "thinking trace save failed"));
        }
      }
      const stripped = block.text.replace(thinkingRegex, "").trim();
      if (stripped) {
        result.push({ type: "text", text: stripped });
      }
      continue;
    }

    result.push(block);
  }

  return result;
}

/**
 * Filter tools by evaluating optional preconditions.
 * Also strips the preconditions property before passing to LLM API.
 */
export async function filterAvailableTools(tools: LlmTool[]): Promise<LlmTool[]> {
  const results: LlmTool[] = [];
  for (const tool of tools) {
    if (tool.preconditions) {
      try {
        const available = await tool.preconditions();
        if (!available) {
          logger.debug({ tool: tool.name }, "tool precondition failed, filtering out");
          continue;
        }
      } catch {
        logger.debug({ tool: tool.name }, "tool precondition threw, filtering out");
        continue;
      }
    }
    // Strip preconditions before sending to LLM
    const { preconditions: _p, ...cleanTool } = tool;
    results.push(cleanTool as LlmTool);
  }
  return results;
}

export function sanitizeToolInput(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + "...";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function summarizeToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== "object") return "completed";
  const r = result as Record<string, unknown>;
  if (r.error) return `error: ${String(r.error).slice(0, 100)}`;
  switch (toolName) {
    case "create_plan":
      return `Plan created: ${r.goalTitle ?? ""}`;
    case "search_web":
      return `Found results`;
    case "save_memory":
      return `Saved: ${r.key ?? ""}`;
    case "recall_memories": {
      if (Array.isArray(result)) return `Recalled ${result.length} memories`;
      const rm = result as Record<string, unknown>;
      const memCount = Array.isArray(rm.memories) ? rm.memories.length : 0;
      const hasRag = Boolean(rm.ragContext);
      return `Recalled ${memCount} memories${hasRag ? " + RAG context" : ""}`;
    }
    case "execute_code":
      return `Exit code: ${r.exitCode ?? "?"}`;
    case "read_file":
      return `Read: ${r.path ?? ""}`;
    case "write_file":
      return `Wrote: ${r.path ?? ""}`;
    default:
      return "completed";
  }
}

/**
 * Check if a destructive tool has already been approved for this conversation.
 * If an approved approval exists, returns { approved: true }.
 * Otherwise creates a new approval request and returns details for the agent.
 */
export async function checkOrCreateDestructiveApproval(
  db: Db | undefined,
  toolName: string,
  conversationId: string,
): Promise<{ approved: boolean; approvalId?: string; message?: string }> {
  if (!db) {
    // No DB = no approval system; fall back to blocking
    return {
      approved: false,
      message: `Tool "${toolName}" requires approval but the approval system is unavailable. Ask the user to confirm this action.`,
    };
  }

  // Check if there's already an approved approval for this tool in this conversation
  const pending = await listPendingApprovals(db, 100);

  // Look for an existing pending or approved approval for this exact action
  const marker = `[destructive:${toolName}:${conversationId}]`;

  // Check pending first — if one exists, remind the agent to wait
  const existingPending = pending.find((a) => a.reason.includes(marker));
  if (existingPending) {
    // Re-check if it's been approved since we fetched
    const current = await getApproval(db, existingPending.id);
    if (current?.status === "approved") {
      logger.info({ toolName, approvalId: current.id }, "destructive tool approval found");
      return { approved: true };
    }
    return {
      approved: false,
      approvalId: existingPending.id,
      message: `Tool "${toolName}" is awaiting approval (ID: ${existingPending.id}). The user can approve with /approve ${existingPending.id}. Do not retry until the user has approved.`,
    };
  }

  // No existing approval — create one
  const approval = await createApproval(db, {
    requestedBy: "orchestrator",
    reason: `${marker} Destructive tool "${toolName}" invoked during conversation ${conversationId}. Requires human approval before execution.`,
  });

  logger.info(
    { toolName, approvalId: approval.id, conversationId },
    "destructive tool approval requested",
  );

  // Notify the user
  notifyApprovalCreated({
    approvalId: approval.id,
    taskId: "ad-hoc",
    reason: `Destructive tool "${toolName}" needs your approval before it can execute.`,
    requestedBy: "orchestrator",
  }).catch((err) => logger.warn({ err }, "approval notification failed"));

  return {
    approved: false,
    approvalId: approval.id,
    message: `Tool "${toolName}" requires approval before execution. Approval ID: ${approval.id}. The user has been notified and can approve with /approve ${approval.id}. Do not retry until the user has approved.`,
  };
}

export function trimHistory<T extends { content: string }>(
  history: T[],
  maxTokenEstimate = 8_000,
): T[] {
  let tokenCount = 0;
  const trimmed: T[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const est = Math.ceil(history[i].content.length / 4);
    if (tokenCount + est > maxTokenEstimate) break;
    tokenCount += est;
    trimmed.unshift(history[i]);
  }
  return trimmed;
}
