import type { LlmRegistry } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { updateGoalStatus, updateGoalMetadata, saveMemory } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { VerifierAgent, type VerificationVerdict } from "../agents/specialists/verifier.js";
import type { NotificationService } from "./notifications.js";
import type { WorkspaceService } from "./workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";

const logger = createLogger("verification-service");

export interface VerificationInput {
  goalId: string;
  goalTitle: string;
  taskResults: Array<{
    id: string;
    title: string;
    agent: string;
    status: string;
    output?: string;
  }>;
  userId?: string;
}

export interface VerificationResult {
  goalId: string;
  verdict: "pass" | "fail";
  confidence: number;
  summary: string;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  suggestions?: string[];
  verifiedAt: string;
  model: string;
  provider: string;
}

const CODE_AGENTS = new Set(["coder", "debugger", "doc_writer"]);

export class VerificationService {
  constructor(
    private registry: LlmRegistry,
    private db: Db,
    private notificationService?: NotificationService,
    private workspaceService?: WorkspaceService,
    private sandboxService?: SandboxService,
  ) {}

  async verify(input: VerificationInput): Promise<VerificationResult | null> {
    const { goalId, goalTitle, taskResults, userId } = input;

    // Skip if no code-related tasks completed
    const hadCodeTasks = taskResults.some(
      (t) => CODE_AGENTS.has(t.agent) && t.status === "completed",
    );
    if (!hadCodeTasks) {
      logger.info({ goalId }, "skipping verification — no code tasks");
      return null;
    }

    logger.info({ goalId, goalTitle }, "starting goal verification");

    try {
      const agent = new VerifierAgent(
        this.registry,
        this.db,
        this.workspaceService,
        this.sandboxService,
      );

      // Build context from task outputs
      const taskOutputsSummary = taskResults
        .filter((t) => t.status === "completed" && t.output)
        .map((t) => `[${t.agent}] ${t.title}:\n${(t.output ?? "").slice(0, 2000)}`)
        .join("\n\n");

      const result = await agent.execute({
        taskId: `verify-${goalId}`,
        taskTitle: `Verify goal: ${goalTitle}`,
        taskDescription:
          `Verify the deliverables for goal "${goalTitle}".\n\n` +
          `## Task Outputs\n\n${taskOutputsSummary || "(no outputs recorded)"}`,
        goalTitle,
        userId,
      });

      // Prefer structured data from the agent instance
      const verdict: VerificationVerdict | null =
        agent.lastVerification ?? parseVerdictFromText(result.output);

      if (!verdict) {
        logger.warn({ goalId }, "verifier did not produce a structured verdict");
        return null;
      }

      const verificationResult: VerificationResult = {
        goalId,
        ...verdict,
        verifiedAt: new Date().toISOString(),
        model: result.model,
        provider: result.provider,
      };

      // Store in goal metadata
      await updateGoalMetadata(this.db, goalId, { verification: verificationResult });

      // If failed, set goal to needs_review
      if (verdict.verdict === "fail") {
        await updateGoalStatus(this.db, goalId, "needs_review");
        logger.info({ goalId, confidence: verdict.confidence }, "goal verification FAILED — set to needs_review");
      } else {
        logger.info({ goalId, confidence: verdict.confidence }, "goal verification PASSED");
      }

      // Save verification memory
      if (userId) {
        await saveMemory(this.db, {
          userId,
          category: "decisions",
          key: `verification-${goalId.slice(0, 8)}-${Date.now()}`,
          content: `Goal "${goalTitle}" verification: ${verdict.verdict} (confidence: ${verdict.confidence}). ${verdict.summary}`,
          source: `goal-verification:${goalId}`,
          metadata: { goalId, verdict: verdict.verdict, confidence: verdict.confidence },
          workspaceId: "",
        }).catch(() => { /* non-fatal */ });
      }

      // Notify
      if (this.notificationService) {
        const status = verdict.verdict === "pass" ? "verified" : "needs_review";
        this.notificationService
          .notifyGoalCompleted({
            goalId,
            goalTitle,
            status,
            completedTasks: taskResults.filter((t) => t.status === "completed").length,
            totalTasks: taskResults.length,
            tasks: taskResults.map((t) => ({ title: t.title, agent: t.agent, status: t.status })),
          })
          .catch(() => { /* non-fatal */ });
      }

      return verificationResult;
    } catch (err) {
      logger.error({ err, goalId }, "verification failed");
      return null;
    }
  }
}

/** Fallback: try to extract verdict from plain text if the agent didn't call the tool */
function parseVerdictFromText(text: string): VerificationVerdict | null {
  const lower = text.toLowerCase();
  const verdict = lower.includes("verdict: pass") || lower.includes("verdict:pass")
    ? "pass"
    : lower.includes("verdict: fail") || lower.includes("verdict:fail")
      ? "fail"
      : null;

  if (!verdict) return null;

  return {
    verdict,
    confidence: 0.5,
    summary: text.slice(0, 500),
    checks: [{ name: "text_analysis", passed: verdict === "pass", detail: "Parsed from text output" }],
  };
}
