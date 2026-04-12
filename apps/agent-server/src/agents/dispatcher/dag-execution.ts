import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { blockTask, listPendingApprovalsForTasks } from "@ai-cofounder/db";
import { executeTask } from "./task-execution.js";
import type { DispatcherDeps, DispatcherProgress, TaskProgressCallback } from "./types.js";

const logger = createLogger("task-dispatcher");

type TaskLite = {
  id: string;
  title: string;
  description?: string | null;
  assignedAgent?: string | null;
  orderIndex: number;
  parallelGroup?: number | null;
  dependsOn?: string[] | null;
};

/**
 * Group tasks by parallelGroup. Tasks without a group get their own implicit sequential group.
 * Groups execute in numeric order (0, 1, 2...). Ungrouped tasks each run alone, preserving
 * their position relative to grouped tasks based on orderIndex.
 */
export function groupTasks<
  T extends { id: string; parallelGroup?: number | null; orderIndex: number },
>(tasks: T[]): T[][] {
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
        result.push({
          sortKey: task.parallelGroup,
          tasks: explicitGroups.get(task.parallelGroup)!,
        });
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
export async function runGoalGrouped(
  deps: DispatcherDeps,
  tasks: TaskLite[],
  goalId: string,
  goalTitle: string,
  userId?: string,
  onProgress?: TaskProgressCallback,
): Promise<{ taskResults: DispatcherProgress["tasks"]; completedCount: number }> {
  const previousOutputs: string[] = [];
  const taskResults: DispatcherProgress["tasks"] = [];
  let completedCount = 0;
  const retryCounts = new Map<string, number>();

  const groups = groupTasks(tasks);
  let stopped = false;

  const allTaskIds = tasks.map((t) => t.id);
  const pendingApprovals = await listPendingApprovalsForTasks(deps.db, allTaskIds);

  for (const group of groups) {
    if (stopped) break;

    let groupBlocked = false;
    for (const task of group) {
      const taskApproval = pendingApprovals.find((a) => a.taskId === task.id);
      if (taskApproval) {
        logger.info({ taskId: task.id }, "task awaiting approval, skipping");
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
      executeTask(deps, {
        task,
        goalId,
        goalTitle,
        previousOutputs: groupPreviousOutputs,
        totalTasks: tasks.length,
        baseCompletedCount: completedCount,
        userId,
        onProgress,
        retryCounts,
      }),
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
export async function runGoalDAG(
  deps: DispatcherDeps,
  tasks: TaskLite[],
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
    const deps2 = task.dependsOn;
    if (!deps2) continue;
    for (const depId of deps2) {
      if (!reverseDeps.has(depId)) reverseDeps.set(depId, []);
      reverseDeps.get(depId)!.push(task.id);
    }
  }

  // Check approvals up front
  const allTaskIds = tasks.map((t) => t.id);
  const pendingApprovals = await listPendingApprovalsForTasks(deps.db, allTaskIds);
  const approvalBlockedIds = new Set(
    pendingApprovals.map((a) => a.taskId).filter((id): id is string => Boolean(id)),
  );

  // Find tasks that are ready to execute
  const getReadyTasks = (): TaskLite[] => {
    return tasks.filter((t) => {
      if (completed.has(t.id) || failed.has(t.id) || blocked.has(t.id) || running.has(t.id))
        return false;
      if (approvalBlockedIds.has(t.id)) return false;
      const deps2 = t.dependsOn;
      if (!deps2 || deps2.length === 0) return true;
      return deps2.every((depId) => completed.has(depId));
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
        if (visited.has(depId) || completed.has(depId) || failed.has(depId) || blocked.has(depId))
          continue;
        visited.add(depId);
        blocked.add(depId);
        await blockTask(deps.db, depId, `Blocked: dependency ${failedTaskId} failed`);
        taskResults.push({
          id: depId,
          title: taskMap.get(depId)?.title ?? "unknown",
          agent: (taskMap.get(depId)?.assignedAgent ?? "researcher") as string,
          status: "blocked",
        });
        logger.info(
          { taskId: depId, failedDep: failedTaskId },
          "task blocked due to dependency failure",
        );
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
      const deps2 = task.dependsOn;
      if (deps2) {
        for (const depId of deps2) {
          const out = outputMap.get(depId);
          if (out) depOutputs.push(out);
        }
      }

      const result = await executeTask(deps, {
        task,
        goalId,
        goalTitle,
        previousOutputs: depOutputs,
        totalTasks: tasks.length,
        baseCompletedCount: completedCount,
        userId,
        onProgress,
        retryCounts,
      });
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
          if (deps.planRepairService?.canReplan(goalId)) {
            const failedInfo = taskMap.get(taskId);
            if (failedInfo) {
              const completedInfos = [...completed].map((id) => {
                const t = taskMap.get(id)!;
                return {
                  id,
                  title: t.title,
                  status: "completed" as const,
                  output: outputMap.get(id) ?? null,
                  description: t.description,
                  assignedAgent: t.assignedAgent,
                  error: null,
                };
              });
              const remainingInfos = [...blocked].map((id) => {
                const t = taskMap.get(id)!;
                return {
                  id,
                  title: t.title,
                  status: "blocked" as const,
                  description: t.description,
                  assignedAgent: t.assignedAgent,
                  output: null,
                  error: null,
                };
              });
              deps.planRepairService
                .generateCorrectivePlan(
                  {
                    id: taskId,
                    title: failedInfo.title,
                    status: "failed",
                    error: taskResult.output ?? null,
                    description: failedInfo.description,
                    assignedAgent: failedInfo.assignedAgent,
                    output: null,
                  },
                  completedInfos,
                  remainingInfos,
                  goalTitle,
                )
                .then((corrective) => {
                  if (corrective && corrective.length > 0) {
                    deps.planRepairService!.recordReplan(goalId);
                    logger.info(
                      { goalId, correctiveCount: corrective.length },
                      "plan repair generated corrective tasks",
                    );
                  }
                })
                .catch((err) => {
                  logger.warn({ err, goalId }, "plan repair failed (non-fatal)");
                });
            }
          }
        }
      } else {
        // Promise.allSettled rejected — shouldn't happen since executeTask catches errors
        // but handle defensively
        logger.error({ error: result.reason }, "unexpected batch execution error");
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
