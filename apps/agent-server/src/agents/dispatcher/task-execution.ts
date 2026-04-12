import type { AgentRole } from "@ai-cofounder/shared";
import { createLogger } from "@ai-cofounder/shared";
import {
  assignTask,
  startTask,
  completeTask,
  failTask,
  createJournalEntry,
} from "@ai-cofounder/db";
import type { SpecialistContext } from "../specialists/base.js";
import {
  RETRYABLE_ROLES,
  MAX_RETRIES,
  type DispatcherDeps,
  type DispatcherProgress,
  type TaskProgressCallback,
} from "./types.js";

const logger = createLogger("task-dispatcher");

export interface ExecuteTaskInput {
  task: {
    id: string;
    title: string;
    description?: string | null;
    assignedAgent?: string | null;
    orderIndex: number;
  };
  goalId: string;
  goalTitle: string;
  previousOutputs: string[];
  totalTasks: number;
  baseCompletedCount: number;
  userId?: string;
  onProgress?: TaskProgressCallback;
  retryCounts?: Map<string, number>;
}

/**
 * Execute a single task with retry logic, notifications, progress callbacks,
 * adaptive routing, and self-healing hooks.
 */
export async function executeTask(
  deps: DispatcherDeps,
  input: ExecuteTaskInput,
): Promise<{ taskResult: DispatcherProgress["tasks"][0]; output?: string }> {
  const { db, specialists, notificationService, adaptiveRoutingService, selfHealingService } = deps;
  const {
    task,
    goalId,
    goalTitle,
    previousOutputs,
    totalTasks,
    baseCompletedCount,
    userId,
    onProgress,
    retryCounts,
  } = input;

  let agentRole = (task.assignedAgent ?? "researcher") as AgentRole;

  // Adaptive routing: suggest a potentially better agent
  if (adaptiveRoutingService) {
    try {
      const suggestion = await adaptiveRoutingService.suggestAgent(
        task.description ?? task.title,
        agentRole,
      );
      const shouldOverride =
        suggestion.confidence >= 0.7 &&
        suggestion.recommended !== agentRole &&
        specialists.has(suggestion.recommended);

      adaptiveRoutingService.recordDecision({
        taskId: task.id,
        originalAgent: agentRole,
        recommendedAgent: suggestion.recommended,
        confidence: suggestion.confidence,
        overridden: shouldOverride,
        timestamp: new Date(),
      });

      if (shouldOverride) {
        logger.info(
          {
            taskId: task.id,
            original: agentRole,
            recommended: suggestion.recommended,
            confidence: suggestion.confidence,
          },
          "adaptive routing override",
        );
        agentRole = suggestion.recommended;
      }
    } catch (err) {
      logger.warn({ err, taskId: task.id }, "adaptive routing failed, using original assignment");
    }
  }

  // Self-healing: check for known failure patterns before executing
  if (selfHealingService) {
    const recommendation = selfHealingService.checkBeforeExecution(agentRole);
    if (recommendation.action === "skip") {
      logger.warn(
        { taskId: task.id, agent: agentRole, reason: recommendation.reason },
        "self-healing: skipping task",
      );
      await failTask(db, task.id, `Skipped by self-healing: ${recommendation.reason}`);
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
      logger.info(
        { taskId: task.id, agent: agentRole, reason: recommendation.reason },
        "self-healing: escalation recommended",
      );
      // Log but don't block — the existing retry/routing mechanisms handle escalation
    }
  }

  const specialist = specialists.get(agentRole);

  if (!specialist) {
    logger.warn({ taskId: task.id, agent: agentRole }, "no specialist for role");
    await failTask(db, task.id, `No specialist agent for role: ${agentRole}`);
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
  await assignTask(db, task.id, agentRole);
  await startTask(db, task.id);

  logger.info({ taskId: task.id, taskTitle: task.title, agent: agentRole }, "executing task");

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

  if (notificationService) {
    notificationService
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

    await completeTask(db, task.id, result.output);
    void createJournalEntry(db, {
      entryType: "task_completed",
      title: `Task completed: ${task.title}`,
      summary: result.output.slice(0, 300),
      goalId,
      taskId: task.id,
      details: { agent: agentRole, model: result.model, provider: result.provider },
    }).catch((err) => logger.warn({ err }, "journal write failed"));

    logger.info(
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

    if (notificationService) {
      notificationService
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
    selfHealingService?.recordSuccess(agentRole);

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
      logger.info({ taskId: task.id, agent: agentRole, attempt: retries + 2 }, "retrying task");

      const retryContext: SpecialistContext = {
        ...context,
        taskDescription: `${context.taskDescription}\n\n[RETRY] Previous attempt failed with error: ${errorMsg}\nPlease try a different approach.`,
      };

      try {
        const retryResult = await specialist.execute(retryContext);
        await completeTask(db, task.id, retryResult.output);
        void createJournalEntry(db, {
          entryType: "task_completed",
          title: `Task completed (retry): ${task.title}`,
          summary: retryResult.output.slice(0, 300),
          goalId,
          taskId: task.id,
          details: { agent: agentRole, retried: true },
        }).catch((err2) => logger.warn({ err: err2 }, "journal write failed"));

        logger.info({ taskId: task.id, agent: agentRole }, "task succeeded on retry");

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
          } catch {
            /* notification failures are non-fatal */
          }
        }

        if (notificationService) {
          notificationService
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
              /* non-fatal */
            });
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
        logger.error({ taskId: task.id, err: retryErr }, "task retry also failed");
        await failTask(db, task.id, retryErrorMsg);
        void createJournalEntry(db, {
          entryType: "task_failed",
          title: `Task failed (after retry): ${task.title}`,
          summary: retryErrorMsg.slice(0, 300),
          goalId,
          taskId: task.id,
          details: { agent: agentRole, error: retryErrorMsg.slice(0, 1000), retried: true },
        }).catch((err2) => logger.warn({ err: err2 }, "journal write failed"));

        if (notificationService) {
          notificationService
            .notifyTaskFailed({
              goalId,
              goalTitle,
              taskId: task.id,
              taskTitle: task.title,
              agent: agentRole,
              error: retryErrorMsg,
            })
            .catch(() => {
              /* non-fatal */
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
              output: retryErrorMsg,
            });
          } catch {
            /* non-fatal */
          }
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

    await failTask(db, task.id, errorMsg);
    void createJournalEntry(db, {
      entryType: "task_failed",
      title: `Task failed: ${task.title}`,
      summary: errorMsg.slice(0, 300),
      goalId,
      taskId: task.id,
      details: { agent: agentRole, error: errorMsg.slice(0, 1000) },
    }).catch((err2) => logger.warn({ err: err2 }, "journal write failed"));

    logger.error({ taskId: task.id, err }, "task failed");

    // Self-healing: record failure
    if (selfHealingService) {
      const { SelfHealingService: SHS } = await import("../../services/self-healing.js");
      selfHealingService.recordFailure({
        agentRole,
        errorCategory: SHS.categorizeError(errorMsg),
        errorMessage: errorMsg.slice(0, 500),
        timestamp: new Date(),
      });
    }

    if (notificationService) {
      notificationService
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
