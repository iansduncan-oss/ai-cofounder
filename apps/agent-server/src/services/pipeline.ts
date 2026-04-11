import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { updateGoalStatus } from "@ai-cofounder/db";
import type { PipelineJob, PipelineStage } from "@ai-cofounder/queue";
import type {
  SpecialistAgent,
  SpecialistContext,
  SpecialistResult,
} from "../agents/specialists/base.js";
import { ResearcherAgent } from "../agents/specialists/researcher.js";
import { CoderAgent } from "../agents/specialists/coder.js";
import { ReviewerAgent } from "../agents/specialists/reviewer.js";
import { PlannerAgent } from "../agents/specialists/planner.js";
import { DebuggerAgent } from "../agents/specialists/debugger.js";
import type { NotificationService } from "./notifications.js";
import type { JournalService } from "./journal.js";
import type { N8nService } from "./n8n.js";

const logger = createLogger("pipeline");

export interface PipelineResult {
  pipelineId: string;
  goalId: string;
  status: "completed" | "failed" | "partial";
  stageResults: StageResult[];
}

export interface StageResult {
  stageIndex: number;
  agent: string;
  status: "completed" | "failed" | "skipped";
  output?: string;
  error?: string;
}

export class PipelineExecutor {
  private specialists: Map<string, SpecialistAgent>;

  constructor(
    private registry: LlmRegistry,
    private db: Db,
    private notificationService?: NotificationService,
    embeddingService?: EmbeddingService,
    sandboxService?: SandboxService,
    private journalService?: JournalService,
    private n8nService?: N8nService,
  ) {
    this.specialists = new Map<string, SpecialistAgent>([
      ["researcher", new ResearcherAgent(registry, db, embeddingService)],
      ["coder", new CoderAgent(registry, db, sandboxService)],
      ["reviewer", new ReviewerAgent(registry, db)],
      ["planner", new PlannerAgent(registry, db)],
      ["debugger", new DebuggerAgent(registry, db, embeddingService, sandboxService)],
    ]);
  }

  async execute(job: PipelineJob): Promise<PipelineResult> {
    const { pipelineId, goalId, stages, context } = job;
    logger.info({ pipelineId, goalId, stageCount: stages.length }, "pipeline started");

    await updateGoalStatus(this.db, goalId, "active").catch(() => {
      // Goal may not exist — pipeline can run independently
    });

    const stageResults: StageResult[] = [];
    const previousOutputs: string[] = [];
    let failed = false;

    // Group stages: consecutive stages with dependsOnPrevious=false can run concurrently,
    // stages with dependsOnPrevious=true must run sequentially after prior output
    const groups = this.groupStages(stages);

    for (const group of groups) {
      if (failed) {
        // Skip remaining stages
        for (const { index } of group) {
          stageResults.push({
            stageIndex: index,
            agent: stages[index].agent,
            status: "skipped",
          });
        }
        continue;
      }

      // Snapshot context for this group
      const groupPreviousOutputs = [...previousOutputs];
      const groupContext = { ...context };

      if (group.length === 1) {
        // Sequential execution
        const { index, stage } = group[0];
        const result = await this.executeStage(
          stage,
          index,
          pipelineId,
          goalId,
          groupPreviousOutputs,
          groupContext,
        );
        stageResults.push(result);

        if (result.status === "completed" && result.output) {
          previousOutputs.push(result.output);
        } else if (result.status === "failed") {
          failed = true;
        }
      } else {
        // Concurrent execution — all stages in group run in parallel
        const promises = group.map(({ index, stage }) =>
          this.executeStage(stage, index, pipelineId, goalId, groupPreviousOutputs, groupContext),
        );
        const results = await Promise.allSettled(promises);

        for (const result of results) {
          if (result.status === "fulfilled") {
            stageResults.push(result.value);
            if (result.value.status === "completed" && result.value.output) {
              previousOutputs.push(result.value.output);
            } else if (result.value.status === "failed") {
              failed = true;
            }
          } else {
            // Promise rejected — shouldn't happen since executeStage catches errors
            const idx = group[results.indexOf(result)]?.index ?? -1;
            stageResults.push({
              stageIndex: idx,
              agent: stages[idx]?.agent ?? "unknown",
              status: "failed",
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
            failed = true;
          }
        }
      }
    }

    // Update goal status
    const allCompleted = stageResults.every((r) => r.status === "completed");
    const anyCompleted = stageResults.some((r) => r.status === "completed");

    if (allCompleted) {
      await updateGoalStatus(this.db, goalId, "completed").catch((err) =>
        logger.warn({ err }, "goal status update failed"),
      );
    } else if (!anyCompleted) {
      await updateGoalStatus(this.db, goalId, "cancelled").catch((err) =>
        logger.warn({ err }, "goal status update failed"),
      );
    }

    const pipelineStatus = allCompleted ? "completed" : anyCompleted ? "partial" : "failed";

    // Notify completion
    if (this.notificationService) {
      const completedStages = stageResults.filter((r) => r.status === "completed").length;
      this.notificationService
        .sendBriefing(
          `**Pipeline ${pipelineId}** ${pipelineStatus}: ${completedStages}/${stages.length} stages completed`,
        )
        .catch((err) => logger.warn({ err }, "pipeline event write failed"));
    }

    // Write journal entry for content_pipeline
    if (this.journalService) {
      const completedStages = stageResults.filter((r) => r.status === "completed").length;
      this.journalService
        .writeEntry({
          entryType: "content_pipeline",
          title: `Pipeline ${pipelineId} ${pipelineStatus}`,
          summary: `${completedStages}/${stages.length} stages completed`,
          goalId,
          details: {
            pipelineId,
            stageResults: stageResults.map((r) => ({ agent: r.agent, status: r.status })),
            templateName: (context as Record<string, unknown>).templateName,
          },
        })
        .catch((err) => logger.warn({ err }, "pipeline event write failed"));
    }

    // Auto-trigger n8n workflow for templates that specify one
    if (this.n8nService && pipelineStatus === "completed" && context.templateName) {
      const n8nWorkflowName = (context as Record<string, unknown>).n8nWorkflow as
        | string
        | undefined;
      if (n8nWorkflowName) {
        const { getN8nWorkflowByName } = await import("@ai-cofounder/db");
        const workflow = await getN8nWorkflowByName(this.db, n8nWorkflowName);
        if (workflow?.webhookUrl) {
          const lastOutput = stageResults
            .filter((r) => r.output)
            .map((r) => r.output)
            .pop();
          this.n8nService
            .trigger(workflow.webhookUrl, n8nWorkflowName, {
              pipelineId,
              goalId,
              output: lastOutput,
            })
            .catch((err) => {
              logger.warn({ err, n8nWorkflowName }, "n8n post-pipeline trigger failed");
            });
        }
      }
    }

    logger.info(
      {
        pipelineId,
        goalId,
        status: pipelineStatus,
        completed: stageResults.filter((r) => r.status === "completed").length,
      },
      "pipeline finished",
    );

    return { pipelineId, goalId, status: pipelineStatus, stageResults };
  }

  private async executeStage(
    stage: PipelineStage,
    index: number,
    pipelineId: string,
    goalId: string,
    previousOutputs: string[],
    _context: Record<string, unknown>,
  ): Promise<StageResult> {
    const specialist = this.specialists.get(stage.agent);
    if (!specialist) {
      logger.warn({ agent: stage.agent, index }, "no specialist for pipeline stage");
      return {
        stageIndex: index,
        agent: stage.agent,
        status: "failed",
        error: `No specialist agent for role: ${stage.agent}`,
      };
    }

    logger.info({ pipelineId, stage: index, agent: stage.agent }, "executing pipeline stage");

    const specialistContext: SpecialistContext = {
      taskId: `${pipelineId}-stage-${index}`,
      taskTitle: `Pipeline stage ${index + 1}: ${stage.agent}`,
      taskDescription: stage.prompt,
      goalTitle: `Pipeline ${pipelineId} (goal: ${goalId})`,
      previousOutputs: previousOutputs.length > 0 ? previousOutputs : undefined,
    };

    try {
      const result: SpecialistResult = await specialist.execute(specialistContext);

      logger.info(
        { pipelineId, stage: index, agent: stage.agent, model: result.model },
        "pipeline stage completed",
      );

      return {
        stageIndex: index,
        agent: stage.agent,
        status: "completed",
        output: result.output,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ pipelineId, stage: index, agent: stage.agent, err }, "pipeline stage failed");

      return {
        stageIndex: index,
        agent: stage.agent,
        status: "failed",
        error: errorMsg,
      };
    }
  }

  /**
   * Group stages for execution:
   * - Stages with dependsOnPrevious=true run alone (sequential)
   * - Consecutive stages with dependsOnPrevious=false are grouped (concurrent)
   */
  private groupStages(
    stages: PipelineStage[],
  ): Array<Array<{ index: number; stage: PipelineStage }>> {
    const groups: Array<Array<{ index: number; stage: PipelineStage }>> = [];
    let currentGroup: Array<{ index: number; stage: PipelineStage }> = [];

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      if (stage.dependsOnPrevious || i === 0) {
        // Start a new group — sequential stage
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [{ index: i, stage }];

        // If it depends on previous, it runs alone
        if (stage.dependsOnPrevious) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      } else {
        // Can run concurrently with previous non-dependent stages
        currentGroup.push({ index: i, stage });
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }
}
