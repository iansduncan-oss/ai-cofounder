import type { FastifyInstance } from "fastify";
import { Job } from "bullmq";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueuePipeline, getPipelineQueue, type PipelineStage, type PipelineJob } from "@ai-cofounder/queue";
import { CreatePipelineBody, GoalPipelineBody, GoalIdParams, JobIdParams } from "../schemas.js";

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // POST /api/pipelines — submit a pipeline for background execution
  app.post<{ Body: typeof CreatePipelineBody.static }>(
    "/",
    { schema: { tags: ["pipelines"], body: CreatePipelineBody } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }

      const { goalId, stages, context } = request.body;

      const jobId = await enqueuePipeline({ goalId, stages, context });
      return { jobId, status: "queued", stageCount: stages.length };
    },
  );

  // POST /api/pipelines/goal/:goalId — convenience: auto-generate a standard pipeline for a goal
  app.post<{
    Params: typeof GoalIdParams.static;
    Body: typeof GoalPipelineBody.static;
  }>(
    "/goal/:goalId",
    { schema: { tags: ["pipelines"], params: GoalIdParams, body: GoalPipelineBody } },
    async (request, reply) => {
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
    },
  );

  // GET /api/pipelines — list pipeline runs
  app.get("/", { schema: { tags: ["pipelines"] } }, async (_request, reply) => {
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

  // POST /api/pipelines/:jobId/retry — re-enqueue a failed pipeline
  app.post<{ Params: typeof JobIdParams.static }>(
    "/:jobId/retry",
    { schema: { tags: ["pipelines"], params: JobIdParams } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }

      const queue = getPipelineQueue();
      const job = await Job.fromId<PipelineJob>(queue, request.params.jobId);

      if (!job) {
        return reply.status(404).send({ error: "Pipeline job not found" });
      }

      const state = await job.getState();
      if (state !== "failed") {
        return reply.status(409).send({ error: `Cannot retry pipeline in state "${state}" — must be "failed"` });
      }

      const newJobId = await enqueuePipeline({
        goalId: job.data.goalId,
        stages: job.data.stages,
        context: job.data.context,
      });

      await job.remove();

      return { jobId: newJobId, status: "queued", stageCount: job.data.stages.length };
    },
  );

  // DELETE /api/pipelines/:jobId — cancel a pipeline
  app.delete<{ Params: typeof JobIdParams.static }>(
    "/:jobId",
    { schema: { tags: ["pipelines"], params: JobIdParams } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }

      const queue = getPipelineQueue();
      const job = await Job.fromId<PipelineJob>(queue, request.params.jobId);

      if (!job) {
        return reply.status(404).send({ error: "Pipeline job not found" });
      }

      const state = await job.getState();
      if (state === "completed" || state === "failed") {
        return reply.status(409).send({ error: `Cannot cancel pipeline in state "${state}"` });
      }

      if (state === "active") {
        await job.moveToFailed(new Error("Cancelled by user"), job.token ?? "0");
      } else {
        await job.remove();
      }

      return { cancelled: true };
    },
  );

  // GET /api/pipelines/:jobId — get pipeline detail
  app.get<{ Params: typeof JobIdParams.static }>(
    "/:jobId",
    { schema: { tags: ["pipelines"], params: JobIdParams } },
    async (request, reply) => {
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
    },
  );
}
