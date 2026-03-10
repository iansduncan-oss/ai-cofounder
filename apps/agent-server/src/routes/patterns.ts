import type { FastifyPluginAsync } from "fastify";
import { listPatterns, togglePatternActive, deletePattern } from "@ai-cofounder/db";
import { PatternListQuery, TogglePatternBody, IdParams } from "../schemas.js";

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
      return { deleted: true };
    },
  );
};
