import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  LlmRegistry,
  AnthropicProvider,
  GroqProvider,
  OpenRouterProvider,
  GeminiProvider,
  createEmbeddingService,
  type EmbeddingService,
} from "@ai-cofounder/llm";
import { dbPlugin } from "./plugins/db.js";
import { securityPlugin } from "./plugins/security.js";
import { observabilityPlugin } from "./plugins/observability.js";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agents.js";
import { goalRoutes } from "./routes/goals.js";
import { taskRoutes } from "./routes/tasks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { channelRoutes } from "./routes/channels.js";
import { memoryRoutes } from "./routes/memories.js";
import { executionRoutes } from "./routes/execution.js";
import { userRoutes } from "./routes/users.js";
import { promptRoutes } from "./routes/prompts.js";
import { n8nRoutes } from "./routes/n8n.js";
import { createN8nService, type N8nService } from "./services/n8n.js";

/** Create and configure the LLM registry with all available providers */
export function createLlmRegistry(): LlmRegistry {
  const registry = new LlmRegistry();

  registry.register(
    new AnthropicProvider(
      optionalEnv("ANTHROPIC_API_KEY", ""),
      optionalEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
    ),
  );
  registry.register(new GroqProvider(optionalEnv("GROQ_API_KEY", "")));
  registry.register(new OpenRouterProvider(optionalEnv("OPENROUTER_API_KEY", "")));
  registry.register(new GeminiProvider(optionalEnv("GEMINI_API_KEY", "")));

  return registry;
}

export function buildServer(registry?: LlmRegistry) {
  const logger = createLogger("agent-server");
  const llmRegistry = registry ?? createLlmRegistry();

  const app = Fastify({
    logger: false,
    trustProxy: true, // required behind reverse proxy for correct IP detection
  });

  // Attach our structured logger to the request lifecycle
  app.addHook("onRequest", async (request) => {
    logger.info({ method: request.method, url: request.url }, "request");
  });

  // CORS — restrict origins in production, allow same-origin for voice UI
  const allowedOrigins = optionalEnv("CORS_ORIGINS", "").split(",").filter(Boolean);
  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  // Plugins (order matters: security first, then observability)
  app.register(securityPlugin);
  app.register(observabilityPlugin);
  app.register(dbPlugin);

  // Decorate with LLM registry so routes can access it
  app.decorate("llmRegistry", llmRegistry);

  // Create embedding service if Gemini API key is available
  const geminiKey = optionalEnv("GEMINI_API_KEY", "");
  const embeddingService = geminiKey ? createEmbeddingService(geminiKey) : undefined;
  app.decorate("embeddingService", embeddingService);

  // Create n8n service for workflow automation
  const n8nService = createN8nService();
  app.decorate("n8nService", n8nService);

  // Register routes
  app.register(healthRoutes);
  app.register(agentRoutes, { prefix: "/api/agents" });
  app.register(goalRoutes, { prefix: "/api/goals" });
  app.register(taskRoutes, { prefix: "/api/tasks" });
  app.register(approvalRoutes, { prefix: "/api/approvals" });
  app.register(channelRoutes, { prefix: "/api/channels" });
  app.register(memoryRoutes, { prefix: "/api/memories" });
  app.register(userRoutes, { prefix: "/api/users" });
  app.register(promptRoutes, { prefix: "/api/prompts" });
  app.register(n8nRoutes, { prefix: "/api/n8n" });
  app.register(executionRoutes, { prefix: "/api/goals" });

  // Serve voice UI static files at /voice/
  // Try multiple paths: relative to cwd (monorepo root), or relative to this file's dir
  const candidates = [
    path.resolve(process.cwd(), "apps/voice-ui/public"),
    path.resolve(process.cwd(), "../voice-ui/public"),
    path.resolve(__dirname, "../../voice-ui/public"),
    path.resolve(__dirname, "../../../apps/voice-ui/public"),
  ];
  const staticRoot = candidates.find((p) => fs.existsSync(p));

  if (staticRoot) {
    app.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/voice/",
      decorateReply: false,
    });
    logger.info({ path: staticRoot }, "voice UI static files registered at /voice/");
  } else {
    logger.warn({ tried: candidates }, "voice UI static files not found");
  }

  return { app, logger };
}

// Augment Fastify types for the LLM registry decorator
declare module "fastify" {
  interface FastifyInstance {
    llmRegistry: LlmRegistry;
    embeddingService?: EmbeddingService;
    n8nService: N8nService;
  }
}
