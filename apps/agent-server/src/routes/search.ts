import type { FastifyInstance } from "fastify";
import { globalSearch } from "@ai-cofounder/db";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q: string } }>(
    "/",
    {
      schema: {
        tags: ["search"],
        querystring: {
          type: "object",
          required: ["q"],
          properties: {
            q: { type: "string", minLength: 2, maxLength: 200 },
          },
        },
      },
    },
    async (request) => {
      const results = await globalSearch(app.db, request.query.q);
      return results;
    },
  );
}
