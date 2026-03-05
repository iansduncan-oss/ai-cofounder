import type { LlmRegistry } from "@ai-cofounder/llm";
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
} from "@ai-cofounder/db";
import type { SpecialistAgent, SpecialistContext } from "./specialists/base.js";
import { ResearcherAgent } from "./specialists/researcher.js";
import { CoderAgent } from "./specialists/coder.js";
import { ReviewerAgent } from "./specialists/reviewer.js";
import { PlannerAgent } from "./specialists/planner.js";

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
  ) {
    this.specialists = new Map<AgentRole, SpecialistAgent>([
      ["researcher", new ResearcherAgent(registry, db)],
      ["coder", new CoderAgent(registry, db)],
      ["reviewer", new ReviewerAgent(registry, db)],
      ["planner", new PlannerAgent(registry, db)],
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

    return {
      goalId,
      goalTitle: goal.title,
      status: goalStatus,
      totalTasks: tasks.length,
      completedTasks: completedCount,
      tasks: taskResults,
    };
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
