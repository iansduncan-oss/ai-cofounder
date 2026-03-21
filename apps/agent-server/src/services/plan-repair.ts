/**
 * Plan Repair Service: generates corrective tasks when a task in a DAG fails.
 * Limited to 3 corrective tasks and 2 replans per goal.
 */

import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("plan-repair");

const MAX_CORRECTIVE_TASKS = 3;
const LLM_TIMEOUT = 10000;

export interface TaskInfo {
  id: string;
  title: string;
  description?: string | null;
  assignedAgent?: string | null;
  output?: string | null;
  error?: string | null;
  status: string;
}

export interface CorrectiveTask {
  title: string;
  description: string;
  assignedAgent: string;
}

export class PlanRepairService {
  private replanCounts = new Map<string, number>();

  constructor(
    private llmRegistry: LlmRegistry,
    private maxReplansPerGoal = 2,
  ) {}

  /**
   * Check if this goal has exceeded its replan budget.
   */
  canReplan(goalId: string): boolean {
    const count = this.replanCounts.get(goalId) ?? 0;
    return count < this.maxReplansPerGoal;
  }

  /**
   * Generate corrective tasks to recover from a failure.
   * Returns null if repair is not possible or budget exceeded.
   */
  async generateCorrectivePlan(
    failedTask: TaskInfo,
    completedTasks: TaskInfo[],
    remainingTasks: TaskInfo[],
    goalDescription: string,
  ): Promise<CorrectiveTask[] | null> {
    const goalId = ""; // Will be tracked by caller

    const completedSummary = completedTasks
      .map((t) => `- [DONE] ${t.title}${t.output ? `: ${String(t.output).slice(0, 100)}` : ""}`)
      .join("\n");

    const remainingSummary = remainingTasks
      .map((t) => `- [PENDING] ${t.title}`)
      .join("\n");

    try {
      const result = await this.llmRegistry.complete("planning", {
        messages: [
          {
            role: "user",
            content: `A task in a multi-step plan has failed. Generate up to ${MAX_CORRECTIVE_TASKS} corrective tasks to recover and continue toward the goal.

Goal: ${goalDescription}

Failed task: "${failedTask.title}"
Error: ${failedTask.error ?? "Unknown error"}

Completed tasks:
${completedSummary || "(none)"}

Remaining tasks:
${remainingSummary || "(none)"}

Return ONLY valid JSON:
{"correctiveTasks": [{"title": "...", "description": "...", "assignedAgent": "orchestrator|researcher|coder|reviewer|planner|debugger"}]}

Rules:
- Max ${MAX_CORRECTIVE_TASKS} corrective tasks
- Tasks should address the root cause, not just retry
- Choose the most appropriate specialist agent
- If the failure is unrecoverable, return {"correctiveTasks": []}`,
          },
        ],
      });

      const textContent = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = JSON.parse(
        textContent.match(/\{[\s\S]*\}/)?.[0] ?? "{}",
      );

      const tasks = (parsed.correctiveTasks ?? []).slice(0, MAX_CORRECTIVE_TASKS) as CorrectiveTask[];

      if (tasks.length === 0) {
        logger.info({ failedTask: failedTask.title }, "Plan repair returned no corrective tasks");
        return null;
      }

      // Validate each task has required fields
      const valid = tasks.filter((t) => t.title && t.description && t.assignedAgent);
      if (valid.length === 0) return null;

      logger.info(
        { failedTask: failedTask.title, correctiveCount: valid.length },
        "Generated corrective plan",
      );

      return valid;
    } catch (err) {
      logger.error({ err, failedTask: failedTask.title }, "Plan repair LLM call failed");
      return null;
    }
  }

  /**
   * Record that a replan was attempted for a goal.
   */
  recordReplan(goalId: string): void {
    const count = this.replanCounts.get(goalId) ?? 0;
    this.replanCounts.set(goalId, count + 1);
  }

  /**
   * Get the number of replans attempted for a goal.
   */
  getReplanCount(goalId: string): number {
    return this.replanCounts.get(goalId) ?? 0;
  }

  /**
   * Clear replan tracking for a goal (after goal completes).
   */
  clearGoal(goalId: string): void {
    this.replanCounts.delete(goalId);
  }
}
