import type { Db } from "@ai-cofounder/db";
import { createGoal, createTask, updateGoalStatus, updateTaskDependencies } from "@ai-cofounder/db";
import type { AgentRole } from "@ai-cofounder/shared";
import { createLogger } from "@ai-cofounder/shared";
import { classifyGoalScope, scopeRequiresApproval } from "../../services/scope-classifier.js";
import { notifyGoalProposed } from "../../services/notifications.js";
import { validateDependencyGraph } from "./dependency-graph.js";
import type { CreatePlanInput } from "./tool-definitions.js";

const logger = createLogger("orchestrator-plan-persister");

export interface PlanResult {
  goalId: string;
  goalTitle: string;
  scope?: ReturnType<typeof classifyGoalScope>;
  requiresApproval?: boolean;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: AgentRole;
    orderIndex: number;
    parallelGroup?: number | null;
    dependsOn?: string[] | null;
  }>;
}

/**
 * Persist a plan: create goal, create all tasks, wire up dependencies, notify if approval needed.
 */
export async function persistPlan(
  db: Db,
  conversationId: string,
  input: CreatePlanInput,
  options: { userId?: string; workspaceId?: string } = {},
): Promise<PlanResult> {
  const { userId, workspaceId } = options;

  // Validate dependency graph before creating anything (cycle detection)
  const hasDeps = input.tasks.some((t) => t.depends_on && t.depends_on.length > 0);
  if (hasDeps) {
    validateDependencyGraph(input.tasks);
  }

  // Classify scope — server-side keyword analysis merged with optional LLM hint
  const scope = classifyGoalScope(input.tasks, input.scope);
  const requiresApproval = scopeRequiresApproval(scope);

  const goal = await createGoal(db, {
    conversationId,
    title: input.goal_title,
    description: input.goal_description,
    priority: input.goal_priority,
    createdBy: userId,
    milestoneId: input.milestone_id || undefined,
    scope,
    requiresApproval,
    workspaceId: workspaceId ?? "",
  });

  // If approval required → "proposed"; otherwise → "active"
  const initialStatus = requiresApproval ? "proposed" : "active";
  await updateGoalStatus(db, goal.id, initialStatus);

  // Pass 1: create all tasks to get UUIDs
  const createdTasks: PlanResult["tasks"] = [];

  for (let i = 0; i < input.tasks.length; i++) {
    const t = input.tasks[i];
    const task = await createTask(db, {
      goalId: goal.id,
      title: t.title,
      description: t.description,
      assignedAgent: t.assigned_agent,
      orderIndex: i,
      parallelGroup: t.parallel_group,
      input: t.description,
      workspaceId: workspaceId ?? "",
    });

    createdTasks.push({
      id: task.id,
      title: task.title,
      assignedAgent: task.assignedAgent as AgentRole,
      orderIndex: task.orderIndex,
      parallelGroup: task.parallelGroup,
    });
  }

  // Pass 2: resolve index-based depends_on to UUIDs and update tasks
  if (hasDeps) {
    for (let i = 0; i < input.tasks.length; i++) {
      const depIndices = input.tasks[i].depends_on;
      if (depIndices && depIndices.length > 0) {
        const depUuids = depIndices
          .filter((idx) => idx >= 0 && idx < createdTasks.length)
          .map((idx) => createdTasks[idx].id);
        if (depUuids.length > 0) {
          await updateTaskDependencies(db, createdTasks[i].id, depUuids);
          createdTasks[i].dependsOn = depUuids;
        }
      }
    }
  }

  // Fire-and-forget notification for proposed goals
  if (requiresApproval) {
    notifyGoalProposed({
      goalId: goal.id,
      goalTitle: goal.title,
      scope,
      taskCount: createdTasks.length,
    }).catch((err) => logger.warn({ err }, "Failed to notify goal proposed"));
  }

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    scope,
    requiresApproval,
    tasks: createdTasks,
  };
}

export function buildPlanSummary(plan: PlanResult): string {
  const taskLines = plan.tasks
    .map((t, i) => `${i + 1}. ${t.title} (${t.assignedAgent})`)
    .join("\n");

  let summary = `Plan created: ${plan.goalTitle}\n\nTasks:\n${taskLines}`;

  if (plan.requiresApproval) {
    summary += `\n\n⚠️ This plan has **${plan.scope}** scope and requires human approval before execution. Status: proposed.`;
  }

  return summary;
}
