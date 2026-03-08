import type { FastifyInstance } from "fastify";
import {
  getActivePersona,
  listPersonas,
  upsertPersona,
  deletePersona,
} from "@ai-cofounder/db";

export async function personaRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/persona — get the active persona
  app.get("/", async () => {
    const persona = await getActivePersona(app.db);
    return { persona };
  });

  // GET /api/persona/all — list all personas
  app.get("/all", async () => {
    const all = await listPersonas(app.db);
    return { personas: all };
  });

  // PUT /api/persona — create or update a persona
  app.put<{
    Body: {
      id?: string;
      name: string;
      voiceId?: string;
      corePersonality: string;
      capabilities?: string;
      behavioralGuidelines?: string;
      isActive?: boolean;
    };
  }>("/", async (request) => {
    const persona = await upsertPersona(app.db, request.body);
    return { persona };
  });

  // DELETE /api/persona/:id — delete a persona
  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deletePersona(app.db, request.params.id);
    return { deleted: true };
  });
}
