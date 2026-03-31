import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getGoal,
  listTasksByGoal,
  assignTask,
  startTask,
  completeTask,
  failTask,
  blockTask,
  updateGoalStatus,
  listPendingApprovalsForTasks,
  saveMemory,
  createJournalEntry,
} from "@ai-cofounder/db";
import type { SpecialistAgent, SpecialistContext } from "./specialists/base.js";
import { ResearcherAgent } from "./specialists/researcher.js";
import { CoderAgent } from "./specialists/coder.js";
import { ReviewerAgent } from "./specialists/reviewer.js";
import { PlannerAgent } from "./specialists/planner.js";
import { DebuggerAgent } from "./specialists/debugger.js";
import { DocWriterAgent } from "./specialists/doc-writer.js";
import type { NotificationService } from "../services/notifications.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { VerificationService } from "../services/verification.js";
import { enqueueReflection } from "@ai-cofounder/queue";
import type { PlanRepairService } from "../services/plan-repair.js";
import type { ProceduralMemoryService } from "../services/procedural-memory.js";
import type { AdaptiveRoutingService } from "../services/adaptive-routing.js";
import type { SelfHealingService } from "../services/self-healing.js";

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

const RETRYABLE_ROLES: Set<AgentRole> = new Set(["coder", "debugger", "doc_writer"]);
const MAX_RETRIES = 1;

export class TaskDispatcher {
  private logger = createLogger("task-dispatcher");
  private specialists: Map<AgentRole, SpecialistAgent>;

  constructor(
    private registry: LlmRegistry,
    private db: Db,
    embeddingService?: EmbeddingService,
    sandboxService?: SandboxService,
    private notificationService?: NotificationService,
    workspaceService?: WorkspaceService,
    private verificationService?: VerificationService,
    private planRepairService?: PlanRepairService,
    private proceduralMemoryService?: ProceduralMemoryService,
    private adaptiveRoutingService?: AdaptiveRoutingService,
    private selfHealingService?: SelfHealingService,
  ) {
    this.specialists = new Map<AgentRole, SpecialistAgent>([
      ["researcher", new ResearcherAgent(registry, db, embeddingService)],
      ["coder", new CoderAgent(registry, db, sandboxService, workspaceService)],
      ["reviewer", new ReviewerAgent(registry, db)],
      ["planner", new PlannerAgent(registry, db)],
      ["debugger", new DebuggerAgent(registry, db, embeddingService, sandboxService)],
      ["doc_writer", new DocWriterAgent(registry, db, embeddingService, workspaceService)],
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
    void createJournalEntry(this.db, {
      entryType: "goal_started",
      title: `Goal started: ${goal.title}`,
      summary: `${tasks.length} tasks queued for execution`,
      goalId,
      details: { totalTasks: tasks.length },
    }).catch((err) => this.logger.warn({ err }, "journal write failed"));

    // Route to DAG executor when any task has explicit dependencies
    const hasDAGDeps = tasks.some((t) => (t as { dependsOn?: string[] | null }).dependsOn?.length);
    let taskResults: DispatcherProgress["tasks"];
    let completedCount: number;

    if (hasDAGDeps) {
      const dagResult = await this.runGoalDAG(tasks, goalId, goal.title, userId, onProgress);
      taskResults = dagResult.taskResults;
      completedCount = dagResult.completedCount;
    } else {
      const groupResult = await this.runGoalGrouped(tasks, goalId, goal.title, userId, onProgress);
      taskResults = groupResult.taskResults;
      completedCount = groupResult.completedCount;
    }

    // Update goal status based on results
    const allCompleted = taskResults.every((t) => t.status === "completed");
    const anyFailed = taskResults.some((t) => t.status === "failed");

    if (allCompleted) {
      await updateGoalStatus(this.db, goalId, "completed");
      void createJournalEntry(this.db, {
        entryType: "goal_completed",
        title: `Goal completed: ${goal.title}`,
        summary: `${completedCount}/${tasks.length} tasks completed`,
        goalId,
        details: { completedTasks: completedCount, totalTasks: tasks.length },
      }).catch((err) => this.logger.warn({ err }, "journal write failed"));
    } else if (anyFailed && completedCount === 0) {
      // Only mark cancelled if nothing succeeded
      await updateGoalStatus(this.db, goalId, "cancelled");
      void createJournalEntry(this.db, {
        entryType: "goal_failed",
        title: `Goal failed: ${goal.title}`,
        summary: `All ${tasks.length} tasks failed`,
        goalId,
        details: { completedTasks: 0, totalTasks: tasks.length },
      }).catch((err) => this.logger.warn({ err }, "journal write failed"));
    }
    // Otherwise leave as active (partially complete or awaiting approval)

    const goalStatus = allCompleted
      ? "completed"
      : anyFailed && completedCount === 0
        ? "failed"
        : "in_progress";

    // Post-completion verification: check if deliverables are sound
    if (allCompleted) {
      this.verifyGoalCompletion(goalId, goal.title, taskResults, userId).catch((err) => {
        this.logger.warn({ err, goalId }, "goal verification failed (non-fatal)");
      });

      // Learn procedure from successful goal (fire-and-forget)
      if (this.proceduralMemoryService) {
        this.proceduralMemoryService.learnProcedure(goalId).catch((err) => {
          this.logger.warn({ err, goalId }, "procedural learning failed (non-fatal)");
        });
      }
    }

    // Clean up plan repair tracking
    this.planRepairService?.clearGoal(goalId);

    this.logger.info(
      {
        goalId,
        status: goalStatus,
        completed: completedCount,
        total: tasks.length,
      },
      "goal execution finished",
    );

    // Post-execution self-improvement: enqueue structured reflection via queue
    enqueueReflection({
      action: "analyze_goal",
      goalId,
      goalTitle: goal.title,
      status: goalStatus,
      taskResults: taskResults.map((t) => ({
        id: t.id,
        title: t.title,
        agent: t.agent,
        status: t.status,
        output: t.output?.slice(0, 1000),
      })),
    }).catch((err) => {
      this.logger.warn({ err, goalId }, "failed to enqueue reflection (non-fatal)");
      // Fallback to in-process analysis when queue is unavailable
      if (userId) {
        this.analyzeExecution(goalId, goal.title, goalStatus, taskResults, userId).catch((e) => {
          this.logger.warn({ err: e, goalId }, "fallback analysis also failed (non-fatal)");
        });
      }
    });

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

  /** Group tasks by parallelGroup. Tasks without a group get their own implicit sequential group.
   *  Groups execute in numeric order (0, 1, 2...). Ungrouped tasks each run alone, preserving
   *  their position relative to grouped tasks based on orderIndex. */
  private groupTasks<T extends { id: string; parallelGroup?: number | null; orderIndex: number }>(
    tasks: T[],
  ): T[][] {
    // Build groups: explicit parallelGroups merge tasks; null/undefined each get their own group
    const explicitGroups = new Map<number, T[]>();
    const result: Array<{ sortKey: number; tasks: T[] }> = [];
    const seenGroups = new Set<number>();

    for (const task of tasks) {
      if (task.parallelGroup != null) {
        if (!explicitGroups.has(task.parallelGroup)) {
          explicitGroups.set(task.parallelGroup, []);
        }
        explicitGroups.get(task.parallelGroup)!.push(task);
        // Insert the group into results at first occurrence position
        if (!seenGroups.has(task.parallelGroup)) {
          seenGroups.add(task.parallelGroup);
          result.push({ sortKey: task.parallelGroup, tasks: explicitGroups.get(task.parallelGroup)! });
        }
      } else {
        // Ungrouped task runs alone in its own implicit sequential group
        result.push({ sortKey: task.orderIndex + 1000, tasks: [task] });
      }
    }

    // Sort: explicit groups by group number, then implicit by insertion order
    result.sort((a, b) => a.sortKey - b.sortKey);
    return result.map((r) => r.tasks);
  }

  /** Legacy group-based execution path (used when no task has dependsOn) */
  private async runGoalGrouped(
    tasks: Array<{ id: string; title: string; description?: string | null; assignedAgent?: string | null; orderIndex: number; parallelGroup?: number | null }>,
    goalId: string,
    goalTitle: string,
    userId?: string,
    onProgress?: TaskProgressCallback,
  ): Promise<{ taskResults: DispatcherProgress["tasks"]; completedCount: number }> {
    const previousOutputs: string[] = [];
    const taskResults: DispatcherProgress["tasks"] = [];
    let completedCount = 0;
    const retryCounts = new Map<string, number>();

    const groups = this.groupTasks(tasks);
    let stopped = false;

    const allTaskIds = tasks.map((t) => t.id);
    const pendingApprovals = await listPendingApprovalsForTasks(this.db, allTaskIds);

    for (const group of groups) {
      if (stopped) break;

      let groupBlocked = false;
      for (const task of group) {
        const taskApproval = pendingApprovals.find((a) => a.taskId === task.id);
        if (taskApproval) {
          this.logger.info({ taskId: task.id }, "task awaiting approval, skipping");
          taskResults.push({
            id: task.id,
            title: task.title,
            agent: (task.assignedAgent ?? "researcher") as string,
            status: "awaiting_approval",
          });
          groupBlocked = true;
          stopped = true;
          break;
        }
      }
      if (groupBlocked) break;

      const groupPreviousOutputs = [...previousOutputs];
      const groupPromises = group.map((task) =>
        this.executeTask(task, goalId, goalTitle, groupPreviousOutputs, tasks.length, completedCount, userId, onProgress, retryCounts),
      );

      const results = await Promise.allSettled(groupPromises);

      for (const result of results) {
        if (result.status === "fulfilled") {
          taskResults.push(result.value.taskResult);
          if (result.value.taskResult.status === "completed" && result.value.output) {
            previousOutputs.push(result.value.output);
            completedCount++;
          }
        }
      }
    }

    return { taskResults, completedCount };
  }

  /** DAG-based execution: tasks run as soon as their dependencies are satisfied */
  private async runGoalDAG(
    tasks: Array<{ id: string; title: string; description?: string | null; assignedAgent?: string | null; orderIndex: number; dependsOn?: string[] | null }>,
    goalId: string,
    goalTitle: string,
    userId?: string,
    onProgress?: TaskProgressCallback,
  ): Promise<{ taskResults: DispatcherProgress["tasks"]; completedCount: number }> {
    const maxConcurrency = parseInt(optionalEnv("MAX_TASK_CONCURRENCY", "3"), 10);
    const retryCounts = new Map<string, number>();

    // Build task map and state tracking
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const outputMap = new Map<string, string>(); // taskId → output
    const completed = new Set<string>();
    const failed = new Set<string>();
    const blocked = new Set<string>();
    const running = new Set<string>();
    const taskResults: DispatcherProgress["tasks"] = [];

    // Build reverse dependency map for cascade blocking
    const reverseDeps = new Map<string, string[]>();
    for (const task of tasks) {
      const deps = task.dependsOn;
      if (!deps) continue;
      for (const depId of deps) {
        if (!reverseDeps.has(depId)) reverseDeps.set(depId, []);
        reverseDeps.get(depId)!.push(task.id);
      }
    }

    // Check approvals up front
    const allTaskIds = tasks.map((t) => t.id);
    const pendingApprovals = await listPendingApprovalsForTasks(this.db, allTaskIds);
    const approvalBlockedIds = new Set(pendingApprovals.map((a) => a.taskId).filter((id): id is string => Boolean(id)));

    // Find tasks that are ready to execute
    const getReadyTasks = (): typeof tasks => {
      return tasks.filter((t) => {
        if (completed.has(t.id) || failed.has(t.id) || blocked.has(t.id) || running.has(t.id)) return false;
        if (approvalBlockedIds.has(t.id)) return false;
        const deps = t.dependsOn;
        if (!deps || deps.length === 0) return true;
        return deps.every((depId) => completed.has(depId));
      });
    };

    // Cascade block all transitive dependents of a failed task
    const blockDownstream = async (failedTaskId: string): Promise<void> => {
      const queue = [failedTaskId];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        const dependents = reverseDeps.get(current) ?? [];
        for (const depId of dependents) {
          if (visited.has(depId) || completed.has(depId) || failed.has(depId) || blocked.has(depId)) continue;
          visited.add(depId);
          blocked.add(depId);
          await blockTask(this.db, depId, `Blocked: dependency ${failedTaskId} failed`);
          taskResults.push({
            id: depId,
            title: taskMap.get(depId)?.title ?? "unknown",
            agent: (taskMap.get(depId)?.assignedAgent ?? "researcher") as string,
            status: "blocked",
          });
          this.logger.info({ taskId: depId, failedDep: failedTaskId }, "task blocked due to dependency failure");
          queue.push(depId);
        }
      }
    };

    // Main execution loop
    while (true) {
      const ready = getReadyTasks();

      if (ready.length === 0 && running.size === 0) break; // Nothing left to do

      // Take up to maxConcurrency tasks
      const batch = ready.slice(0, maxConcurrency - running.size);
      if (batch.length === 0 && running.size === 0) break; // Safety valve: deadlock prevention

      for (const t of batch) running.add(t.id);

      const completedCount = completed.size;

      const batchPromises = batch.map(async (task) => {
        // Build previousOutputs from direct dependencies only
        const depOutputs: string[] = [];
        const deps = task.dependsOn;
        if (deps) {
          for (const depId of deps) {
            const out = outputMap.get(depId);
            if (out) depOutputs.push(out);
          }
        }

        const result = await this.executeTask(
          task, goalId, goalTitle, depOutputs, tasks.length, completedCount, userId, onProgress, retryCounts,
        );
        return { taskId: task.id, ...result };
      });

      const results = await Promise.allSettled(batchPromises);

      for (const result of results) {
        if (result.status === "fulfilled") {
          const { taskId, taskResult, output } = result.value;
          running.delete(taskId);
          taskResults.push(taskResult);

          if (taskResult.status === "completed") {
            completed.add(taskId);
            if (output) outputMap.set(taskId, output);
          } else if (taskResult.status === "failed") {
            failed.add(taskId);
            await blockDownstream(taskId);

            // Attempt plan repair if service is available and budget remains
            if (this.planRepairService?.canReplan(goalId)) {
              const failedInfo = taskMap.get(taskId);
              if (failedInfo) {
                const completedInfos = [...completed].map((id) => {
                  const t = taskMap.get(id)!;
                  return { id, title: t.title, status: "completed" as const, output: outputMap.get(id) ?? null, description: t.description, assignedAgent: t.assignedAgent, error: null };
                });
                const remainingInfos = [...blocked].map((id) => {
                  const t = taskMap.get(id)!;
                  return { id, title: t.title, status: "blocked" as const, description: t.description, assignedAgent: t.assignedAgent, output: null, error: null };
                });
                this.planRepairService.generateCorrectivePlan(
                  { id: taskId, title: failedInfo.title, status: "failed", error: taskResult.output ?? null, description: failedInfo.description, assignedAgent: failedInfo.assignedAgent, output: null },
                  completedInfos,
                  remainingInfos,
                  goalTitle,
                ).then((corrective) => {
                  if (corrective && corrective.length > 0) {
                    this.planRepairService!.recordReplan(goalId);
                    this.logger.info({ goalId, correctiveCount: corrective.length }, "plan repair generated corrective tasks");
                  }
                }).catch((err) => {
                  this.logger.warn({ err, goalId }, "plan repair failed (non-fatal)");
                });
              }
            }
          }
        } else {
          // Promise.allSettled rejected — shouldn't happen since executeTask catches errors
          // but handle defensively
          this.logger.error({ error: result.reason }, "unexpected batch execution error");
        }
      }
    }

    // Mark approval-blocked tasks in results
    for (const taskId of approvalBlockedIds) {
      if (!completed.has(taskId) && !failed.has(taskId) && !blocked.has(taskId)) {
        const t = taskMap.get(taskId);
        if (t) {
          taskResults.push({
            id: t.id,
            title: t.title,
            agent: (t.assignedAgent ?? "researcher") as string,
            status: "awaiting_approval",
          });
        }
      }
    }

    return { taskResults, completedCount: completed.size };
  }

  /** Execute a single task with retry logic, notifications, and progress callbacks */
  private async executeTask(
    task: { id: string; title: string; description?: string | null; assignedAgent?: string | null; orderIndex: number },
    goalId: string,
    goalTitle: string,
    previousOutputs: string[],
    totalTasks: number,
    baseCompletedCount: number,
    userId?: string,
    onProgress?: TaskProgressCallback,
    retryCounts?: Map<string, number>,
  ): Promise<{ taskResult: DispatcherProgress["tasks"][0]; output?: string }> {
    let agentRole = (task.assignedAgent ?? "researcher") as AgentRole;

    // Adaptive routing: suggest a potentially better agent
    if (this.adaptiveRoutingService) {
      try {
        const suggestion = await this.adaptiveRoutingService.suggestAgent(
          task.description ?? task.title,
          agentRole,
        );
        const shouldOverride =
          suggestion.confidence >= 0.7 &&
          suggestion.recommended !== agentRole &&
          this.specialists.has(suggestion.recommended);

        this.adaptiveRoutingService.recordDecision({
          taskId: task.id,
          originalAgent: agentRole,
          recommendedAgent: suggestion.recommended,
          confidence: suggestion.confidence,
          overridden: shouldOverride,
          timestamp: new Date(),
        });

        if (shouldOverride) {
          this.logger.info(
            { taskId: task.id, original: agentRole, recommended: suggestion.recommended, confidence: suggestion.confidence },
            "adaptive routing override",
          );
          agentRole = suggestion.recommended;
        }
      } catch (err) {
        this.logger.warn({ err, taskId: task.id }, "adaptive routing failed, using original assignment");
      }
    }

    // Self-healing: check for known failure patterns before executing
    if (this.selfHealingService) {
      const recommendation = this.selfHealingService.checkBeforeExecution(agentRole);
      if (recommendation.action === "skip") {
        this.logger.warn({ taskId: task.id, agent: agentRole, reason: recommendation.reason }, "self-healing: skipping task");
        await failTask(this.db, task.id, `Skipped by self-healing: ${recommendation.reason}`);
        return {
          taskResult: {
            id: task.id,
            title: task.title,
            agent: agentRole,
            status: "failed",
            output: `Skipped by self-healing: ${recommendation.reason}`,
          },
        };
      }
      if (recommendation.action === "escalate") {
        this.logger.info({ taskId: task.id, agent: agentRole, reason: recommendation.reason }, "self-healing: escalation recommended");
        // Log but don't block — the existing retry/routing mechanisms handle escalation
      }
    }

    const specialist = this.specialists.get(agentRole);

    if (!specialist) {
      this.logger.warn({ taskId: task.id, agent: agentRole }, "no specialist for role");
      await failTask(this.db, task.id, `No specialist agent for role: ${agentRole}`);
      return {
        taskResult: {
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "failed",
          output: `No specialist agent for role: ${agentRole}`,
        },
      };
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
          goalTitle,
          taskId: task.id,
          taskTitle: task.title,
          agent: agentRole,
          status: "started",
          completedTasks: baseCompletedCount,
          totalTasks,
        });
      } catch {
        /* notification failures are non-fatal */
      }
    }

    if (this.notificationService) {
      this.notificationService
        .notifyGoalProgress({
          goalId,
          goalTitle,
          taskTitle: task.title,
          agent: agentRole,
          completedTasks: baseCompletedCount,
          totalTasks,
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
      goalTitle,
      previousOutputs: previousOutputs.length > 0 ? previousOutputs : undefined,
      userId,
    };

    try {
      const result = await specialist.execute(context);

      await completeTask(this.db, task.id, result.output);
      void createJournalEntry(this.db, {
        entryType: "task_completed",
        title: `Task completed: ${task.title}`,
        summary: result.output.slice(0, 300),
        goalId,
        taskId: task.id,
        details: { agent: agentRole, model: result.model, provider: result.provider },
      }).catch((err) => this.logger.warn({ err }, "journal write failed"));

      // Usage recording handled automatically by LlmRegistry.onCompletion hook

      this.logger.info(
        { taskId: task.id, model: result.model, provider: result.provider },
        "task completed",
      );

      if (onProgress) {
        try {
          await onProgress({
            goalId,
            goalTitle,
            taskId: task.id,
            taskTitle: task.title,
            agent: agentRole,
            status: "completed",
            completedTasks: baseCompletedCount + 1,
            totalTasks,
            output: result.output.slice(0, 500),
          });
        } catch {
          /* notification failures are non-fatal */
        }
      }

      if (this.notificationService) {
        this.notificationService
          .notifyGoalProgress({
            goalId,
            goalTitle,
            taskTitle: task.title,
            agent: agentRole,
            completedTasks: baseCompletedCount + 1,
            totalTasks,
            status: "completed",
          })
          .catch(() => {
            /* notification failures are non-fatal */
          });
      }

      // Self-healing: record success
      this.selfHealingService?.recordSuccess(agentRole);

      return {
        taskResult: {
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "completed",
          output: result.output,
        },
        output: result.output,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const retries = retryCounts?.get(task.id) ?? 0;

      // Retry retryable roles once with error context
      if (RETRYABLE_ROLES.has(agentRole) && retries < MAX_RETRIES) {
        retryCounts?.set(task.id, retries + 1);
        this.logger.info({ taskId: task.id, agent: agentRole, attempt: retries + 2 }, "retrying task");

        const retryContext: SpecialistContext = {
          ...context,
          taskDescription: `${context.taskDescription}\n\n[RETRY] Previous attempt failed with error: ${errorMsg}\nPlease try a different approach.`,
        };

        try {
          const retryResult = await specialist.execute(retryContext);
          await completeTask(this.db, task.id, retryResult.output);
          void createJournalEntry(this.db, {
            entryType: "task_completed",
            title: `Task completed (retry): ${task.title}`,
            summary: retryResult.output.slice(0, 300),
            goalId,
            taskId: task.id,
            details: { agent: agentRole, retried: true },
          }).catch((err2) => this.logger.warn({ err: err2 }, "journal write failed"));

          // Usage recording handled automatically by LlmRegistry.onCompletion hook

          this.logger.info({ taskId: task.id, agent: agentRole }, "task succeeded on retry");

          if (onProgress) {
            try {
              await onProgress({
                goalId,
                goalTitle,
                taskId: task.id,
                taskTitle: task.title,
                agent: agentRole,
                status: "completed",
                completedTasks: baseCompletedCount + 1,
                totalTasks,
                output: retryResult.output.slice(0, 500),
              });
            } catch { /* notification failures are non-fatal */ }
          }

          if (this.notificationService) {
            this.notificationService.notifyGoalProgress({
              goalId,
              goalTitle,
              taskTitle: task.title,
              agent: agentRole,
              completedTasks: baseCompletedCount + 1,
              totalTasks,
              status: "completed",
            }).catch(() => { /* non-fatal */ });
          }

          return {
            taskResult: {
              id: task.id,
              title: task.title,
              agent: agentRole,
              status: "completed",
              output: retryResult.output,
            },
            output: retryResult.output,
          };
        } catch (retryErr) {
          const retryErrorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          this.logger.error({ taskId: task.id, err: retryErr }, "task retry also failed");
          await failTask(this.db, task.id, retryErrorMsg);
          void createJournalEntry(this.db, {
            entryType: "task_failed",
            title: `Task failed (after retry): ${task.title}`,
            summary: retryErrorMsg.slice(0, 300),
            goalId,
            taskId: task.id,
            details: { agent: agentRole, error: retryErrorMsg.slice(0, 1000), retried: true },
          }).catch((err2) => this.logger.warn({ err: err2 }, "journal write failed"));

          if (this.notificationService) {
            this.notificationService.notifyTaskFailed({
              goalId, goalTitle, taskId: task.id, taskTitle: task.title, agent: agentRole, error: retryErrorMsg,
            }).catch(() => { /* non-fatal */ });
          }

          if (onProgress) {
            try {
              await onProgress({
                goalId, goalTitle, taskId: task.id, taskTitle: task.title, agent: agentRole,
                status: "failed", completedTasks: baseCompletedCount, totalTasks, output: retryErrorMsg,
              });
            } catch { /* non-fatal */ }
          }

          return {
            taskResult: {
              id: task.id,
              title: task.title,
              agent: agentRole,
              status: "failed",
              output: retryErrorMsg,
            },
          };
        }
      }

      await failTask(this.db, task.id, errorMsg);
      void createJournalEntry(this.db, {
        entryType: "task_failed",
        title: `Task failed: ${task.title}`,
        summary: errorMsg.slice(0, 300),
        goalId,
        taskId: task.id,
        details: { agent: agentRole, error: errorMsg.slice(0, 1000) },
      }).catch((err2) => this.logger.warn({ err: err2 }, "journal write failed"));

      this.logger.error({ taskId: task.id, err }, "task failed");

      // Self-healing: record failure
      if (this.selfHealingService) {
        const { SelfHealingService: SHS } = await import("../services/self-healing.js");
        this.selfHealingService.recordFailure({
          agentRole,
          errorCategory: SHS.categorizeError(errorMsg),
          errorMessage: errorMsg.slice(0, 500),
          timestamp: new Date(),
        });
      }

      if (this.notificationService) {
        this.notificationService
          .notifyTaskFailed({
            goalId,
            goalTitle,
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
            goalTitle,
            taskId: task.id,
            taskTitle: task.title,
            agent: agentRole,
            status: "failed",
            completedTasks: baseCompletedCount,
            totalTasks,
            output: errorMsg,
          });
        } catch {
          /* notification failures are non-fatal */
        }
      }

      return {
        taskResult: {
          id: task.id,
          title: task.title,
          agent: agentRole,
          status: "failed",
          output: errorMsg,
        },
      };
    }
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
      workspaceId: "",
    });

    this.logger.info({ goalId, key }, "execution analysis saved as memory");
  }

  /** Verify goal deliverables after completion */
  private async verifyGoalCompletion(
    goalId: string,
    goalTitle: string,
    taskResults: DispatcherProgress["tasks"],
    userId?: string,
  ): Promise<void> {
    if (this.verificationService) {
      await this.verificationService.verify({ goalId, goalTitle, taskResults, userId });
      return;
    }

    // Fallback: no verification service configured, just log
    this.logger.info({ goalId }, "no verification service configured, skipping verification");
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
