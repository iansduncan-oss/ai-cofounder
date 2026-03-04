import type { FastifyPluginAsync } from "fastify";
import type { AgentMessage } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";

interface RunBody {
  message: string;
  conversationId?: string;
  history?: AgentMessage[];
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const orchestrator = new Orchestrator();

  app.post<{ Body: RunBody }>("/run", async (request, reply) => {
    const { message, conversationId, history } = request.body;

    if (!message || typeof message !== "string") {
      return reply.status(400).send({ error: "message is required" });
    }

    const result = await orchestrator.run(message, conversationId, history);
    return result;
  });
};
