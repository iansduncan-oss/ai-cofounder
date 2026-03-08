import type { FastifyInstance } from "fastify";
import { Job } from "bullmq";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueuePipeline, getPipelineQueue, type PipelineStage, type PipelineJob } from "@ai-cofounder/queue";

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // POST /api/pipelines — submit a pipeline for background execution
  app.post<{
    Body: {
      goalId: string;
      stages: PipelineStage[];
      context?: Record<string, unknown>;
    };
  }>("/", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const { goalId, stages, context } = request.body;

    if (!goalId || !stages || stages.length === 0) {
      return reply.status(400).send({ error: "goalId and at least one stage are required" });
    }

    // Validate stage agent roles
    const validAgents = new Set(["planner", "coder", "reviewer", "debugger", "researcher"]);
    for (const stage of stages) {
      if (!validAgents.has(stage.agent)) {
        return reply.status(400).send({ error: `Invalid agent role: ${stage.agent}` });
      }
    }

    const jobId = await enqueuePipeline({ goalId, stages, context });
    return { jobId, status: "queued", stageCount: stages.length };
  });

  // POST /api/pipelines/goal/:goalId — convenience: auto-generate a standard pipeline for a goal
  app.post<{
    Params: { goalId: string };
    Body: {
      context?: Record<string, unknown>;
    };
  }>("/goal/:goalId", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const { goalId } = request.params;

    // Standard pipeline: plan → code → review
    const stages: PipelineStage[] = [
      { agent: "planner", prompt: "Create a detailed plan for achieving this goal.", dependsOnPrevious: false },
      { agent: "coder", prompt: "Implement the plan from the previous stage.", dependsOnPrevious: true },
      { agent: "reviewer", prompt: "Review the code from the previous stage for quality and correctness.", dependsOnPrevious: true },
    ];

    const jobId = await enqueuePipeline({
      goalId,
      stages,
      context: request.body.context,
    });
    return { jobId, status: "queued", stageCount: stages.length };
  });

  // GET /api/pipelines — list pipeline runs
  app.get("/", async (_request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const queue = getPipelineQueue();
    const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 50);

    const runs = await Promise.all(
      jobs.map(async (job) => {
        const state = await job.getState();
        return {
          jobId: job.id,
          pipelineId: job.data.pipelineId,
          goalId: job.data.goalId,
          stageCount: job.data.stages.length,
          state,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          failedReason: job.failedReason ?? null,
          result: job.returnvalue ?? null,
        };
      }),
    );

    // Sort newest-first
    runs.sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      return tb.localeCompare(ta);
    });

    return { runs };
  });

  // GET /api/pipelines/:jobId — get pipeline detail
  app.get<{ Params: { jobId: string } }>("/:jobId", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const queue = getPipelineQueue();
    const job = await Job.fromId<PipelineJob>(queue, request.params.jobId);

    if (!job) {
      return reply.status(404).send({ error: "Pipeline job not found" });
    }

    const state = await job.getState();

    return {
      jobId: job.id,
      pipelineId: job.data.pipelineId,
      goalId: job.data.goalId,
      stages: job.data.stages,
      currentStage: job.data.currentStage,
      context: job.data.context,
      state,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      failedReason: job.failedReason ?? null,
      result: job.returnvalue ?? null,
    };
  });
}
