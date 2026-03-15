import type { FastifyPluginAsync } from "fastify";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  createPipelineTemplate,
  getPipelineTemplate,
  getPipelineTemplateByName,
  listPipelineTemplates,
  updatePipelineTemplate,
  deletePipelineTemplate,
} from "@ai-cofounder/db";
import { enqueuePipeline } from "@ai-cofounder/queue";
import type { PipelineStage } from "@ai-cofounder/queue";

const logger = createLogger("pipeline-templates-routes");

export const pipelineTemplateRoutes: FastifyPluginAsync = async (app) => {
  /* ── GET / — list active templates ── */
  app.get("/", { schema: { tags: ["pipeline-templates"] } }, async () => {
    return listPipelineTemplates(app.db, true);
  });

  /* ── GET /:id — get single template by UUID ── */
  app.get<{ Params: { id: string } }>(
    "/:id",
    { schema: { tags: ["pipeline-templates"] } },
    async (request, reply) => {
      const template = await getPipelineTemplate(app.db, request.params.id);
      if (!template) return reply.status(404).send({ error: "Template not found" });
      return template;
    },
  );

  /* ── POST / — create template ── */
  app.post<{
    Body: {
      name: string;
      description?: string;
      stages: unknown;
      defaultContext?: unknown;
      isActive?: boolean;
    };
  }>(
    "/",
    { schema: { tags: ["pipeline-templates"] } },
    async (request, reply) => {
      const template = await createPipelineTemplate(app.db, request.body);
      return reply.status(201).send(template);
    },
  );

  /* ── PATCH /:id — update template ── */
  app.patch<{
    Params: { id: string };
    Body: Partial<{
      name: string;
      description: string;
      stages: unknown;
      defaultContext: unknown;
      isActive: boolean;
    }>;
  }>(
    "/:id",
    { schema: { tags: ["pipeline-templates"] } },
    async (request, reply) => {
      const updated = await updatePipelineTemplate(app.db, request.params.id, request.body);
      if (!updated) return reply.status(404).send({ error: "Template not found" });
      return updated;
    },
  );

  /* ── DELETE /:id — remove template ── */
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { schema: { tags: ["pipeline-templates"] } },
    async (request, reply) => {
      const deleted = await deletePipelineTemplate(app.db, request.params.id);
      if (!deleted) return reply.status(404).send({ error: "Template not found" });
      return { deleted: true };
    },
  );

  /* ── POST /:name/trigger — enqueue pipeline from template ── */
  app.post<{
    Params: { name: string };
    Body: { goalId?: string; context?: Record<string, unknown> };
  }>(
    "/:name/trigger",
    { schema: { tags: ["pipeline-templates"] } },
    async (request, reply) => {
      const { name } = request.params;
      const { goalId, context } = request.body ?? {};

      const template = await getPipelineTemplateByName(app.db, name);
      if (!template || !template.isActive) {
        return reply.status(404).send({ error: `Template "${name}" not found or inactive` });
      }

      const redisUrl = optionalEnv("REDIS_URL", "");
      if (!redisUrl) {
        return reply.status(503).send({ error: "Queue system not available — REDIS_URL not configured" });
      }

      const resolvedGoalId = goalId ?? `template-${name}-${Date.now()}`;

      try {
        const jobId = await enqueuePipeline({
          goalId: resolvedGoalId,
          stages: template.stages as PipelineStage[],
          context: {
            ...(template.defaultContext as Record<string, unknown> | undefined ?? {}),
            ...context,
            templateName: template.name,
          },
        });

        logger.info({ templateName: name, goalId: resolvedGoalId, jobId }, "Pipeline enqueued from template");
        return reply.status(202).send({ jobId, template: template.name });
      } catch (err) {
        logger.error({ err, templateName: name }, "Failed to enqueue pipeline from template");
        return reply.status(503).send({ error: "Failed to enqueue pipeline" });
      }
    },
  );
};
