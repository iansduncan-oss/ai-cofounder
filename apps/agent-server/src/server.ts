import Fastify from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { dbPlugin } from "./plugins/db.js";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agents.js";
import { goalRoutes } from "./routes/goals.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";

export function buildServer() {
  const logger = createLogger("agent-server");

  const app = Fastify({ logger: false });

  // Attach our structured logger to the request lifecycle
  app.addHook("onRequest", async (request) => {
    logger.info({ method: request.method, url: request.url }, "request");
  });

  // Plugins
  app.register(dbPlugin);

  // Register routes
  app.register(healthRoutes);
  app.register(agentRoutes, { prefix: "/api/agents" });
  app.register(goalRoutes, { prefix: "/api/goals" });
  app.register(taskRoutes, { prefix: "/api/tasks" });
  app.register(approvalRoutes, { prefix: "/api/approvals" });

  return { app, logger };
}
