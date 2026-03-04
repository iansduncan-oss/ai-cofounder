import type { FastifyPluginAsync } from "fastify";
import { Orchestrator } from "../agents/orchestrator.js";

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const orchestrator = new Orchestrator();

  app.post<{ Body: { message: string; conversationId?: string } }>(
    "/run",
    async (request) => {
      const { message, conversationId } = request.body;
      const result = await orchestrator.run(message, conversationId);
      return result;
    }
  );
};
