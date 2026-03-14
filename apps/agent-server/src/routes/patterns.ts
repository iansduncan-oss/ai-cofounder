import type { FastifyPluginAsync } from "fastify";
import {
  listPatterns,
  togglePatternActive,
  deletePattern,
  createPattern,
  updatePattern,
  getPatternAnalytics,
} from "@ai-cofounder/db";
import {
  PatternListQuery,
  TogglePatternBody,
  CreatePatternBody,
  UpdatePatternBody,
  IdParams,
} from "../schemas.js";

export const patternRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list patterns */
  app.get<{ Querystring: typeof PatternListQuery.static }>(
    "/",
    { schema: { tags: ["patterns"], querystring: PatternListQuery } },
    async (request) => {
      const patterns = await listPatterns(app.db, {
        userId: request.query.userId,
        includeInactive: request.query.includeInactive,
      });
      return { data: patterns };
    },
  );

  /* GET /analytics — pattern analytics & heatmap data */
  app.get<{ Querystring: { userId?: string } }>(
    "/analytics",
    { schema: { tags: ["patterns"] } },
    async (request) => {
      return getPatternAnalytics(app.db, request.query.userId);
    },
  );

  /* POST / — create a new pattern */
  app.post<{ Body: typeof CreatePatternBody.static }>(
    "/",
    { schema: { tags: ["patterns"], body: CreatePatternBody } },
    async (request, reply) => {
      const pattern = await createPattern(app.db, request.body);
      app.agentEvents?.emit("ws:pattern_change");
      return reply.status(201).send(pattern);
    },
  );

  /* PATCH /:id — update pattern fields */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof UpdatePatternBody.static;
  }>(
    "/:id",
    { schema: { tags: ["patterns"], params: IdParams, body: UpdatePatternBody } },
    async (request, reply) => {
      const pattern = await updatePattern(app.db, request.params.id, request.body);
      if (!pattern) return reply.status(404).send({ error: "Pattern not found" });
      app.agentEvents?.emit("ws:pattern_change");
      return pattern;
    },
  );

  /* PATCH /:id/toggle — toggle pattern active/inactive */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof TogglePatternBody.static;
  }>(
    "/:id/toggle",
    { schema: { tags: ["patterns"], params: IdParams, body: TogglePatternBody } },
    async (request, reply) => {
      const pattern = await togglePatternActive(app.db, request.params.id, request.body.isActive);
      if (!pattern) return reply.status(404).send({ error: "Pattern not found" });
      app.agentEvents?.emit("ws:pattern_change");
      return pattern;
    },
  );

  /* DELETE /:id — delete a pattern */
  app.delete<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["patterns"], params: IdParams } },
    async (request, reply) => {
      const deleted = await deletePattern(app.db, request.params.id);
      if (!deleted) return reply.status(404).send({ error: "Pattern not found" });
      app.agentEvents?.emit("ws:pattern_change");
      return { deleted: true };
    },
  );
};
