import type { FastifyPluginAsync } from "fastify";
import { getActivePrompt, listPromptVersions, createPromptVersion } from "@ai-cofounder/db";

export const promptRoutes: FastifyPluginAsync = async (app) => {
  // Get the active prompt by name
  app.get<{ Params: { name: string } }>("/:name", { schema: { tags: ["prompts"] } }, async (request, reply) => {
    const prompt = await getActivePrompt(app.db, request.params.name);
    if (!prompt) {
      return reply.status(404).send({ error: "Prompt not found" });
    }
    return prompt;
  });

  // List all versions of a prompt
  app.get<{ Params: { name: string } }>("/:name/versions", { schema: { tags: ["prompts"] } }, async (_request) => {
    return listPromptVersions(app.db, _request.params.name);
  });

  // Create a new prompt version (auto-increments, auto-activates)
  app.post<{ Body: { name: string; content: string; metadata?: Record<string, unknown> } }>(
    "/",
    { schema: { tags: ["prompts"] } },
    async (request) => {
      const { name, content, metadata } = request.body;
      return createPromptVersion(app.db, { name, content, metadata });
    },
  );
};
