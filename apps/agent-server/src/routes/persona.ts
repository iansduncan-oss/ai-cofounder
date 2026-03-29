import type { FastifyInstance } from "fastify";
import {
  getActivePersona,
  listPersonas,
  upsertPersona,
  deletePersona,
} from "@ai-cofounder/db";
import { UpsertPersonaBody, IdParams } from "../schemas.js";

export async function personaRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/persona — get the active persona
  app.get("/", { schema: { tags: ["persona"] } }, async () => {
    const persona = await getActivePersona(app.db);
    return { persona };
  });

  // GET /api/persona/all — list all personas
  app.get("/all", { schema: { tags: ["persona"] } }, async () => {
    const all = await listPersonas(app.db);
    return { personas: all };
  });

  // PUT /api/persona — create or update a persona
  app.put<{ Body: typeof UpsertPersonaBody.static }>(
    "/",
    { schema: { tags: ["persona"], body: UpsertPersonaBody } },
    async (request, reply) => {
      try {
        const persona = await upsertPersona(app.db, request.body);
        return { persona };
      } catch (err: unknown) {
        const dbErr = err as { code?: string };
        if (dbErr.code === "23505") {
          return reply.code(409).send({ error: "A persona with that name already exists" });
        }
        throw err;
      }
    },
  );

  // DELETE /api/persona/:id — delete a persona
  app.delete<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["persona"], params: IdParams } },
    async (request) => {
      await deletePersona(app.db, request.params.id);
      return { deleted: true };
    },
  );
}
