import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { createLogger } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getGoal, listTasksByGoal, updateGoalStatus, createJournalEntry } from "@ai-cofounder/db";
import type { SpecialistAgent } from "./specialists/base.js";
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

import type {
  DispatcherDeps,
  DispatcherProgress,
  TaskProgressCallback,
} from "./dispatcher/types.js";
import { runGoalGrouped, runGoalDAG } from "./dispatcher/dag-execution.js";
import { analyzeExecution, verifyGoalCompletion } from "./dispatcher/analysis.js";

export type { DispatcherProgress, TaskProgressCallback } from "./dispatcher/types.js";

export class TaskDispatcher {
  private logger = createLogger("task-dispatcher");
  private specialists: Map<AgentRole, SpecialistAgent>;

  constructor(
    registry: LlmRegistry,
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

  private get deps(): DispatcherDeps {
    return {
      db: this.db,
      specialists: this.specialists,
      notificationService: this.notificationService,
      planRepairService: this.planRepairService,
      proceduralMemoryService: this.proceduralMemoryService,
      adaptiveRoutingService: this.adaptiveRoutingService,
      selfHealingService: this.selfHealingService,
    };
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
      const dagResult = await runGoalDAG(this.deps, tasks, goalId, goal.title, userId, onProgress);
      taskResults = dagResult.taskResults;
      completedCount = dagResult.completedCount;
    } else {
      const groupResult = await runGoalGrouped(
        this.deps,
        tasks,
        goalId,
        goal.title,
        userId,
        onProgress,
      );
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
      verifyGoalCompletion(
        this.verificationService,
        goalId,
        goal.title,
        taskResults,
        userId,
        goal.workspaceId ?? undefined,
      ).catch((err) => {
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
        analyzeExecution(
          this.db,
          goalId,
          goal.title,
          goalStatus,
          taskResults,
          userId,
          goal.workspaceId ?? undefined,
        ).catch((e) => {
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
