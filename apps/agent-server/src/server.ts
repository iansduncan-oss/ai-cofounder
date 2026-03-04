import Fastify from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agents.js";

export function buildServer() {
  const logger = createLogger("agent-server");

  const app = Fastify({ logger: false });

  // Attach our structured logger to the request lifecycle
  app.addHook("onRequest", async (request) => {
    logger.info({ method: request.method, url: request.url }, "request");
  });

  // Register routes
  app.register(healthRoutes);
  app.register(agentRoutes, { prefix: "/api/agents" });

  return { app, logger };
}
