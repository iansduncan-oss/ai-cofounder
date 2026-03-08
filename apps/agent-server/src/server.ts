import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
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
import { authPlugin } from "./plugins/auth.js";
import { securityPlugin } from "./plugins/security.js";
import { observabilityPlugin } from "./plugins/observability.js";
import { authRoutes } from "./routes/auth.js";
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
import { usageRoutes } from "./routes/usage.js";
import { eventRoutes } from "./routes/events.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { milestoneRoutes } from "./routes/milestones.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { conversationRoutes } from "./routes/conversations.js";
import { decisionRoutes } from "./routes/decisions.js";
import { voiceRoutes } from "./routes/voice.js";
import { queueRoutes } from "./routes/queue.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { personaRoutes } from "./routes/persona.js";
import { ragRoutes } from "./routes/rag.js";
import { reflectionRoutes } from "./routes/reflections.js";
import { queuePlugin } from "./plugins/queue.js";
import { pubsubPlugin } from "./plugins/pubsub.js";
import { createN8nService, type N8nService } from "./services/n8n.js";
import { createMonitoringService, type MonitoringService } from "./services/monitoring.js";
import { createTTSService, type TTSService } from "./services/tts.js";
import { createWorkspaceService, type WorkspaceService } from "./services/workspace.js";
import {
  createNotificationService,
  type NotificationService,
} from "./services/notifications.js";
import { createSandboxService, type SandboxService } from "@ai-cofounder/sandbox";
import {
  upsertProviderHealth,
  getProviderHealthRecords,
} from "@ai-cofounder/db";
import { startScheduler } from "./services/scheduler.js";

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

  // Request tracing: generate x-request-id if not present, attach to logger context
  app.addHook("onRequest", async (request, reply) => {
    const requestId =
      (request.headers["x-request-id"] as string) ?? crypto.randomUUID();
    (request as unknown as Record<string, unknown>).requestId = requestId;
    reply.header("x-request-id", requestId);
    logger.info({ method: request.method, url: request.url, requestId }, "request");
  });

  // CORS — restrict origins in production, allow same-origin for voice UI
  const allowedOrigins = optionalEnv("CORS_ORIGINS", "").split(",").filter(Boolean);
  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  // OpenAPI spec generation
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "AI Cofounder API",
        description: "Multi-agent orchestration API for AI Cofounder",
        version: "0.1.0",
      },
      servers: [{ url: "http://localhost:3100" }],
      tags: [
        { name: "health", description: "Health checks" },
        { name: "agents", description: "Agent orchestration" },
        { name: "goals", description: "Goal management" },
        { name: "tasks", description: "Task management" },
        { name: "approvals", description: "Approval workflow" },
        { name: "milestones", description: "Milestone planning" },
        { name: "memories", description: "Memory management" },
        { name: "execution", description: "Goal execution" },
        { name: "workspace", description: "File system and git operations" },
        { name: "schedules", description: "Scheduled jobs" },
        { name: "n8n", description: "n8n workflow integration" },
        { name: "webhooks", description: "Inbound webhooks" },
        { name: "channels", description: "Channel-conversation mapping" },
        { name: "users", description: "User management" },
        { name: "prompts", description: "Prompt versioning" },
        { name: "usage", description: "Token usage tracking" },
        { name: "events", description: "Event processing" },
        { name: "conversations", description: "Conversation and message search" },
        { name: "decisions", description: "Decision log" },
        { name: "dashboard", description: "Dashboard summary" },
        { name: "queue", description: "Background task queue" },
        { name: "monitoring", description: "Proactive system monitoring" },
      ],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  // Plugins (order matters: security first, then observability, then db, then auth)
  app.register(securityPlugin);
  app.register(observabilityPlugin);
  app.register(dbPlugin);
  app.register(authPlugin);

  // Decorate with LLM registry so routes can access it
  app.decorate("llmRegistry", llmRegistry);

  // Create embedding service if Gemini API key is available
  const geminiKey = optionalEnv("GEMINI_API_KEY", "");
  const embeddingService = geminiKey ? createEmbeddingService(geminiKey) : undefined;
  app.decorate("embeddingService", embeddingService);

  // Create n8n service for workflow automation
  const n8nService = createN8nService();
  app.decorate("n8nService", n8nService);

  // Create sandbox service for code execution
  const sandboxService = createSandboxService();
  app.decorate("sandboxService", sandboxService);

  // Create workspace service for file system and git access
  const workspaceService = createWorkspaceService();
  app.decorate("workspaceService", workspaceService);

  // Create notification service for proactive alerts
  const notificationService = createNotificationService();
  app.decorate("notificationService", notificationService);

  // Create monitoring service for JARVIS-like proactive checks
  const monitoringService = createMonitoringService(notificationService);
  app.decorate("monitoringService", monitoringService);

  // Create TTS service for ElevenLabs voice synthesis
  const ttsService = createTTSService();
  app.decorate("ttsService", ttsService);

  // Seed LLM provider health from DB on startup, flush periodically
  let healthFlushInterval: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    try {
      const records = await getProviderHealthRecords(app.db);
      if (records.length > 0) {
        llmRegistry.seedStats(
          records.map((r) => ({
            providerName: r.providerName,
            requestCount: r.requestCount,
            successCount: r.successCount,
            errorCount: r.errorCount,
            avgLatencyMs: r.avgLatencyMs,
            lastErrorMessage: r.lastErrorMessage ?? undefined,
            lastErrorAt: r.lastErrorAt ?? undefined,
            lastSuccessAt: r.lastSuccessAt ?? undefined,
          })),
        );
        logger.info({ count: records.length }, "seeded provider health from DB");
      }
    } catch (err) {
      logger.warn({ err }, "failed to seed provider health from DB (non-fatal)");
    }

    // Start the scheduler daemon for cron jobs
    const scheduler = startScheduler({
      db: app.db,
      llmRegistry,
      embeddingService,
      n8nService,
      sandboxService,
      workspaceService,
      notificationService,
      pollIntervalMs: 60_000,
      briefingHour: Number(optionalEnv("BRIEFING_HOUR", "9")),
      briefingTimezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
    });
    app.addHook("onClose", async () => scheduler.stop());
    logger.info("scheduler daemon started");

    // Flush every 60 seconds
    healthFlushInterval = setInterval(async () => {
      try {
        const snapshots = llmRegistry.getStatsSnapshots();
        for (const snap of snapshots) {
          await upsertProviderHealth(app.db, snap);
        }
      } catch (err) {
        logger.warn({ err }, "failed to flush provider health to DB");
      }
    }, 60_000);
    healthFlushInterval.unref();
  });

  // Flush health stats on shutdown
  app.addHook("onClose", async () => {
    if (healthFlushInterval) clearInterval(healthFlushInterval);
    try {
      const snapshots = llmRegistry.getStatsSnapshots();
      for (const snap of snapshots) {
        await upsertProviderHealth(app.db, snap);
      }
      logger.info("flushed provider health to DB on shutdown");
    } catch {
      // DB may already be closed
    }
  });

  // Global error handler — normalize all error responses
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      logger.error({ err: error }, "unhandled server error");
    }
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.message,
      statusCode,
    });
  });

  // Register routes
  app.register(authRoutes, { prefix: "/api/auth" });
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
  app.register(usageRoutes, { prefix: "/api/usage" });
  app.register(eventRoutes, { prefix: "/api/events" });
  app.register(scheduleRoutes, { prefix: "/api/schedules" });
  app.register(webhookRoutes, { prefix: "/api/webhooks" });
  app.register(workspaceRoutes, { prefix: "/api/workspace" });
  app.register(milestoneRoutes, { prefix: "/api/milestones" });
  app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  app.register(conversationRoutes, { prefix: "/api/conversations" });
  app.register(decisionRoutes, { prefix: "/api/decisions" });
  app.register(voiceRoutes, { prefix: "/voice" });
  app.register(queueRoutes, { prefix: "/api/queue" });
  app.register(monitoringRoutes, { prefix: "/api/monitoring" });
  app.register(pipelineRoutes, { prefix: "/api/pipelines" });
  app.register(ragRoutes, { prefix: "/api/rag" });
  app.register(reflectionRoutes, { prefix: "/api/reflections" });
  app.register(personaRoutes, { prefix: "/api/persona" });

  // Queue system (requires REDIS_URL)
  app.register(queuePlugin);

  // Pub/sub bridge: shared Redis subscriber + EventEmitter routing for SSE endpoint
  app.register(pubsubPlugin);

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

  // Serve dashboard static files at /dashboard/
  const dashboardCandidates = [
    path.resolve(process.cwd(), "apps/dashboard/dist"),
    path.resolve(process.cwd(), "../dashboard/dist"),
    path.resolve(__dirname, "../../dashboard/dist"),
    path.resolve(__dirname, "../../../apps/dashboard/dist"),
  ];
  const dashboardRoot = dashboardCandidates.find((p) => fs.existsSync(p));

  if (dashboardRoot) {
    app.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/dashboard/",
      decorateReply: false,
      wildcard: false,
    });
    // SPA fallback: serve index.html for client-side routes
    app.get("/dashboard/*", (_request, reply) => {
      const filePath = path.join(dashboardRoot, "index.html");
      reply.type("text/html").send(fs.readFileSync(filePath));
    });
    logger.info({ path: dashboardRoot }, "dashboard static files registered at /dashboard/");
  } else {
    logger.warn({ tried: dashboardCandidates }, "dashboard static files not found");
  }

  return { app, logger };
}

// Augment Fastify types for the LLM registry decorator
declare module "fastify" {
  interface FastifyInstance {
    llmRegistry: LlmRegistry;
    embeddingService?: EmbeddingService;
    n8nService: N8nService;
    sandboxService: SandboxService;
    workspaceService: WorkspaceService;
    notificationService: NotificationService;
    monitoringService: MonitoringService;
    ttsService: TTSService;
  }
}
