import Fastify from "fastify";
import cors from "@fastify/cors";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { dbPlugin } from "./plugins/db.js";
import { securityPlugin } from "./plugins/security.js";
import { observabilityPlugin } from "./plugins/observability.js";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agents.js";
import { goalRoutes } from "./routes/goals.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { channelRoutes } from "./routes/channels.js";

export function buildServer() {
  const logger = createLogger("agent-server");

  const app = Fastify({
    logger: false,
    trustProxy: true, // required behind reverse proxy for correct IP detection
  });

  // Attach our structured logger to the request lifecycle
  app.addHook("onRequest", async (request) => {
    logger.info({ method: request.method, url: request.url }, "request");
  });

  // CORS — restrict origins in production
  const allowedOrigins = optionalEnv("CORS_ORIGINS", "").split(",").filter(Boolean);
  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  // Plugins (order matters: security first, then observability)
  app.register(securityPlugin);
  app.register(observabilityPlugin);
  app.register(dbPlugin);

  // Register routes
  app.register(healthRoutes);
  app.register(agentRoutes, { prefix: "/api/agents" });
  app.register(goalRoutes, { prefix: "/api/goals" });
  app.register(taskRoutes, { prefix: "/api/tasks" });
  app.register(approvalRoutes, { prefix: "/api/approvals" });
  app.register(channelRoutes, { prefix: "/api/channels" });

  return { app, logger };
}
