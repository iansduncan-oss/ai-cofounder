import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { createLogger } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getGoal,
  listTasksByGoal,
  assignTask,
  startTask,
  completeTask,
  failTask,
  updateGoalStatus,
  listPendingApprovals,
  recordLlmUsage,
  saveMemory,
} from "@ai-cofounder/db";
import type { SpecialistAgent, SpecialistContext } from "./specialists/base.js";
import { ResearcherAgent } from "./specialists/researcher.js";
import { CoderAgent } from "./specialists/coder.js";
import { ReviewerAgent } from "./specialists/reviewer.js";
import { PlannerAgent } from "./specialists/planner.js";
import { DebuggerAgent } from "./specialists/debugger.js";
import type { NotificationService } from "../services/notifications.js";

export interface DispatcherProgress {
  goalId: string;
  goalTitle: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  currentTask?: { id: string; title: string; agent: string; status: string };
  tasks: Array<{
    id: string;
    title: string;
    agent: string;
    status: string;
    output?: string;
  }>;
}

export type TaskProgressCallback = (event: {
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskTitle: string;
  agent: string;
  status: "started" | "completed" | "failed";
  completedTasks: number;
  totalTasks: number;
  output?: string;
}) => void | Promise<void>;

export class TaskDispatcher {
  private logger = createLogger("task-dispatcher");
  private specialists: Map<AgentRole, SpecialistAgent>;

  constructor(
    private registry: LlmRegistry,
    private db: Db,
    embeddingService?: EmbeddingService,
    sandboxService?: SandboxService,
    private notificationService?: NotificationService,
  ) {
    this.specialists = new Map<AgentRole, SpecialistAgent>([
      ["researcher", new ResearcherAgent(registry, db, embeddingService)],
      ["coder", new CoderAgent(registry, db, sandboxService)],
      ["reviewer", new ReviewerAgent(registry, db)],
      ["planner", new PlannerAgent(registry, db)],
      ["debugger", new DebuggerAgent(registry, db, embeddingService, sandboxService)],
    ]);
  }

  /** Execute all tasks for a goal in order */
  async runGoal(
    goalId: string,
    userId?: string,
    onProgress?: TaskProgressCallback,
  ): Promise<DispatcherProgress> {
    const goal = await getGoal(this.db, goalId);
    if (!goal) throw new Error(`Goal not found: ${goalId}`);

    this.logger.info({ goalId, goalTitle: goal.title }, "starting goal execution");

    const tasks = await listTasksByGoal(this.db, goalId);
    if (tasks.length === 0) {
      return {
        goalId,
        goalTitle: goal.title,
        status: "no_tasks",
        totalTasks: 0,
        completedTasks: 0,
        tasks: [],
      };
    }

    await updateGoalStatus(this.db, goalId, "active");

    const previousOutputs: string[] = [];
    const taskResults: DispatcherProgress["tasks"] = [];
    let completedCount = 0;

    for (const task of tasks) {
      const agentRole = (task.assignedAgent ?? "researcher") as AgentRole;
      const specialist = this.specialists.get(agentRole);

      if (!specialist) {
        this.logger.warn({ taskId: task.id, agent: agentRole }, "no specialist for role");
        await failTask(this.db, task.id, `No specialist agent for role: ${agentRole}`);
        taskResults.push({
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "failed",
          output: `No specialist agent for role: ${agentRole}`,
        });
        continue;
      }

      // Check for pending approvals on this task
      const pendingApprovals = await listPendingApprovals(this.db);
      const taskApproval = pendingApprovals.find(
        (a) => a.taskId === task.id && a.status === "pending",
      );
      if (taskApproval) {
        this.logger.info({ taskId: task.id }, "task awaiting approval, skipping");
        taskResults.push({
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "awaiting_approval",
        });
        break; // Stop execution chain until approved
      }

      // Assign and start the task
      await assignTask(this.db, task.id, agentRole);
      await startTask(this.db, task.id);

      this.logger.info(
        { taskId: task.id, taskTitle: task.title, agent: agentRole },
        "executing task",
      );

      if (onProgress) {
        try {
          await onProgress({
            goalId,
            goalTitle: goal.title,
            taskId: task.id,
            taskTitle: task.title,
            agent: agentRole,
            status: "started",
            completedTasks: completedCount,
            totalTasks: tasks.length,
          });
        } catch {
          /* notification failures are non-fatal */
        }
      }

      // Push proactive notification for task started
      if (this.notificationService) {
        this.notificationService
          .notifyGoalProgress({
            goalId,
            goalTitle: goal.title,
            taskTitle: task.title,
            agent: agentRole,
            completedTasks: completedCount,
            totalTasks: tasks.length,
            status: "started",
          })
          .catch(() => {
            /* notification failures are non-fatal */
          });
      }

      const context: SpecialistContext = {
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description ?? task.title,
        goalTitle: goal.title,
        previousOutputs: previousOutputs.length > 0 ? previousOutputs : undefined,
        userId,
      };

      try {
        const result = await specialist.execute(context);

        await completeTask(this.db, task.id, result.output);

        // Record LLM usage for cost tracking
        try {
          await recordLlmUsage(this.db, {
            provider: result.provider,
            model: result.model,
            taskCategory: specialist.taskCategory,
            agentRole: agentRole as AgentRole,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            goalId,
            taskId: task.id,
          });
        } catch {
          /* usage tracking failures are non-fatal */
        }

        previousOutputs.push(result.output);
        completedCount++;

        taskResults.push({
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "completed",
          output: result.output,
        });

        this.logger.info(
          {
            taskId: task.id,
            model: result.model,
            provider: result.provider,
          },
          "task completed",
        );

        if (onProgress) {
          try {
            await onProgress({
              goalId,
              goalTitle: goal.title,
              taskId: task.id,
              taskTitle: task.title,
              agent: agentRole,
              status: "completed",
              completedTasks: completedCount,
              totalTasks: tasks.length,
              output: result.output.slice(0, 500),
            });
          } catch {
            /* notification failures are non-fatal */
          }
        }

        // Push proactive notification for task completed
        if (this.notificationService) {
          this.notificationService
            .notifyGoalProgress({
              goalId,
              goalTitle: goal.title,
              taskTitle: task.title,
              agent: agentRole,
              completedTasks: completedCount,
              totalTasks: tasks.length,
              status: "completed",
            })
            .catch(() => {
              /* notification failures are non-fatal */
            });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await failTask(this.db, task.id, errorMsg);

        taskResults.push({
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "failed",
          output: errorMsg,
        });

        this.logger.error({ taskId: task.id, err }, "task failed");

        if (this.notificationService) {
          this.notificationService
            .notifyTaskFailed({
              goalId,
              goalTitle: goal.title,
              taskId: task.id,
              taskTitle: task.title,
              agent: agentRole,
              error: errorMsg,
            })
            .catch(() => {
              /* notification failures are non-fatal */
            });
        }

        if (onProgress) {
          try {
            await onProgress({
              goalId,
              goalTitle: goal.title,
              taskId: task.id,
              taskTitle: task.title,
              agent: agentRole,
              status: "failed",
              completedTasks: completedCount,
              totalTasks: tasks.length,
              output: errorMsg,
            });
          } catch {
            /* notification failures are non-fatal */
          }
        }
        // Continue to next task instead of stopping entirely
      }
    }

    // Update goal status based on results
    const allCompleted = taskResults.every((t) => t.status === "completed");
    const anyFailed = taskResults.some((t) => t.status === "failed");

    if (allCompleted) {
      await updateGoalStatus(this.db, goalId, "completed");
    } else if (anyFailed && completedCount === 0) {
      // Only mark cancelled if nothing succeeded
      await updateGoalStatus(this.db, goalId, "cancelled");
    }
    // Otherwise leave as active (partially complete or awaiting approval)

    const goalStatus = allCompleted
      ? "completed"
      : anyFailed && completedCount === 0
        ? "failed"
        : "in_progress";

    this.logger.info(
      {
        goalId,
        status: goalStatus,
        completed: completedCount,
        total: tasks.length,
      },
      "goal execution finished",
    );

    // Post-execution self-improvement: analyze and store learnings
    if (userId) {
      this.analyzeExecution(goalId, goal.title, goalStatus, taskResults, userId).catch((err) => {
        this.logger.warn({ err, goalId }, "self-improvement analysis failed (non-fatal)");
      });
    }

    // Notify goal completion/failure
    if (this.notificationService) {
      this.notificationService
        .notifyGoalCompleted({
          goalId,
          goalTitle: goal.title,
          status: goalStatus,
          completedTasks: completedCount,
          totalTasks: tasks.length,
          tasks: taskResults.map((t) => ({ title: t.title, agent: t.agent, status: t.status })),
        })
        .catch(() => {
          /* notification failures are non-fatal */
        });
    }

    return {
      goalId,
      goalTitle: goal.title,
      status: goalStatus,
      totalTasks: tasks.length,
      completedTasks: completedCount,
      tasks: taskResults,
    };
  }

  /** Analyze execution results and store learnings as memories */
  private async analyzeExecution(
    goalId: string,
    goalTitle: string,
    status: string,
    taskResults: DispatcherProgress["tasks"],
    userId: string,
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

    await saveMemory(this.db, {
      userId,
      category: "technical",
      key,
      content,
      source: `goal-execution:${goalId}`,
    });

    this.logger.info({ goalId, key }, "execution analysis saved as memory");
  }

  /** Get current progress for a goal */
  async getProgress(goalId: string): Promise<DispatcherProgress> {
    const goal = await getGoal(this.db, goalId);
    if (!goal) throw new Error(`Goal not found: ${goalId}`);

    const tasks = await listTasksByGoal(this.db, goalId);

    const taskResults: DispatcherProgress["tasks"] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      agent: t.assignedAgent ?? "unassigned",
      status: t.status,
      output: t.output ?? undefined,
    }));

    const completedCount = tasks.filter((t) => t.status === "completed").length;
    const currentTask = tasks.find((t) => t.status === "running");

    return {
      goalId,
      goalTitle: goal.title,
      status: goal.status,
      totalTasks: tasks.length,
      completedTasks: completedCount,
      currentTask: currentTask
        ? {
            id: currentTask.id,
            title: currentTask.title,
            agent: currentTask.assignedAgent ?? "unassigned",
            status: currentTask.status,
          }
        : undefined,
      tasks: taskResults,
    };
  }
}
