import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import { createLogger, optionalEnv, type WsChannel, type AgentRole } from "@ai-cofounder/shared";
import {
  LlmRegistry,
  AnthropicProvider,
  GroqProvider,
  OpenRouterProvider,
  GeminiProvider,
  createEmbeddingService,
  type EmbeddingService,
  type CompletionEvent,
} from "@ai-cofounder/llm";
import { dbPlugin } from "./plugins/db.js";
import { authPlugin } from "./plugins/auth.js";
import { securityPlugin } from "./plugins/security.js";
import { observabilityPlugin } from "./plugins/observability.js";
import { jwtGuardPlugin } from "./plugins/jwt-guard.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { channelRoutes } from "./routes/channels.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { voiceRoutes } from "./routes/voice.js";
import { deployWebhookRoute } from "./routes/deploys.js";
import { recapRoutes } from "./routes/recap.js";
import { queuePlugin } from "./plugins/queue.js";
import { pubsubPlugin } from "./plugins/pubsub.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { wsEmitterPlugin } from "./plugins/ws-emitter.js";
import { createN8nService, type N8nService } from "./services/n8n.js";
import { createMonitoringService, type MonitoringService } from "./services/monitoring.js";
import { createTTSService, type TTSService } from "./services/tts.js";
import { createWorkspaceService, type WorkspaceService } from "./services/workspace.js";
import { createBrowserService, type BrowserService } from "./services/browser.js";
import { createDiscordService } from "./services/discord.js";
import { createVpsCommandService } from "./services/vps-command.js";
import {
  createNotificationService,
  type NotificationService,
} from "./services/notifications.js";
import { createSandboxService, type SandboxService } from "@ai-cofounder/sandbox";
import {
  upsertProviderHealth,
  getProviderHealthRecords,
  listToolTierConfigs,
  upsertToolTierConfig,
  recordLlmUsage,
} from "@ai-cofounder/db";
import { startScheduler } from "./services/scheduler.js";
import { AutonomyTierService } from "./services/autonomy-tier.js";
import { DeployCircuitBreakerService } from "./services/deploy-circuit-breaker.js";
import { SessionEngagementService } from "./services/session-engagement.js";
import { CiSelfHealService } from "./services/ci-self-heal.js";
import { projectRegistryPlugin } from "./plugins/project-registry.js";
import Redis from "ioredis";

/** All known tool names — seeded at green tier on first server start */
const DEFAULT_TOOLS = [
  "save_memory", "recall_memories", "search_web", "browse_web",
  "trigger_workflow", "list_workflows",
  "create_schedule", "list_schedules", "delete_schedule",
  "execute_code",
  "read_file", "write_file", "list_directory", "delete_file", "delete_directory",
  "git_clone", "git_status", "git_diff", "git_add", "git_commit", "git_pull",
  "git_log", "git_branch", "git_checkout", "git_push",
  "run_tests", "create_pr",
  "send_message", "check_messages", "broadcast_update",
  "create_plan", "create_milestone", "request_approval",
  "browser_action",
  "create_follow_up",
  "recall_episodes",
  "recall_procedures",
] as const;
import { AgentMessagingService } from "./services/agent-messaging.js";
import { createJournalService, type JournalService } from "./services/journal.js";
import { BudgetAlertService } from "./services/budget-alert.js";
import { createDocumentWatcher } from "./services/document-watcher.js";
import { EpisodicMemoryService } from "./services/episodic-memory.js";
import { ProceduralMemoryService } from "./services/procedural-memory.js";
import { MemoryLifecycleService } from "./services/memory-lifecycle.js";
import { FailurePatternService } from "./services/failure-patterns.js";
import { AdaptiveRoutingService } from "./services/adaptive-routing.js";
import type { RedisPubSub } from "@ai-cofounder/queue";

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
    forceCloseConnections: "idle", // close idle keep-alive on shutdown, let active requests finish
  });

  // Automatic LLM usage recording for every registry.complete() call.
  // The hook fires during request handling (after server is ready), so app.db is always available.
  llmRegistry.onCompletion = (event: CompletionEvent) => {
    recordLlmUsage(app.db, {
      provider: event.provider,
      model: event.model,
      taskCategory: event.task,
      agentRole: event.metadata?.agentRole as AgentRole | undefined,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      userId: event.metadata?.userId as string | undefined,
      goalId: event.metadata?.goalId as string | undefined,
      taskId: event.metadata?.taskId as string | undefined,
      conversationId: event.metadata?.conversationId as string | undefined,
      metadata: event.metadata,
    }).then(() => {
      app.agentEvents?.emit("ws:usage_change");
    }).catch(() => {
      // Usage tracking failures are non-fatal
    });
  };

  // Request tracing: generate x-request-id if not present, attach to logger context
  app.addHook("onRequest", async (request, reply) => {
    const requestId =
      (request.headers["x-request-id"] as string) ?? crypto.randomUUID();
    (request as unknown as Record<string, unknown>).requestId = requestId;
    reply.header("x-request-id", requestId);
    logger.info({ method: request.method, url: request.url, requestId }, "request");
  });

  // CORS — restrict origins in production, allow same-origin for voice UI
  // credentials: true required for cross-origin HttpOnly cookie support
  const allowedOrigins = optionalEnv("CORS_ORIGINS", "").split(",").filter(Boolean);
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && allowedOrigins.length === 0) {
    logger.warn("CORS_ORIGINS is not set in production — CORS will be restrictive (same-origin only)");
  }
  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : (isProduction ? false : true),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  // Security headers
  app.register(helmet, {
    hsts: false, // NPM handles HSTS with preload directive
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "blob:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
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
        { name: "persona", description: "AI persona management" },
        { name: "pipelines", description: "Multi-agent pipeline execution" },
        { name: "rag", description: "RAG ingestion and search" },
        { name: "reflections", description: "Self-improvement reflections" },
        { name: "patterns", description: "User pattern management" },
        { name: "gmail", description: "Gmail integration" },
        { name: "calendar", description: "Google Calendar integration" },
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

  // Create Discord service for reading channel messages
  const discordService = createDiscordService();
  if (discordService) app.decorate("discordService", discordService);

  // Create VPS command service for infrastructure management
  const vpsCommandService = createVpsCommandService();
  if (vpsCommandService) app.decorate("vpsCommandService", vpsCommandService);

  // Create browser service for Playwright-based browser automation
  const browserService = createBrowserService();
  app.decorate("browserService", browserService);

  // Create notification service for proactive alerts
  const notificationService = createNotificationService();
  app.decorate("notificationService", notificationService);

  // Create monitoring service for JARVIS-like proactive checks
  const monitoringService = createMonitoringService(notificationService);
  app.decorate("monitoringService", monitoringService);

  // Create TTS service for ElevenLabs voice synthesis
  const ttsService = createTTSService();
  app.decorate("ttsService", ttsService);

  // Create CI self-heal service if Redis is available (requires Redis for failure state tracking)
  const ciHealRedisUrl = optionalEnv("REDIS_URL", "");
  if (ciHealRedisUrl) {
    const ciHealRedis = new Redis(ciHealRedisUrl);
    const ciSelfHealService = new CiSelfHealService(ciHealRedis, notificationService);
    app.decorate("ciSelfHealService", ciSelfHealService);
    app.addHook("onClose", async () => {
      await ciHealRedis.quit();
    });
    logger.info("CI self-heal service initialized");
  } else {
    app.decorate("ciSelfHealService", undefined as unknown as CiSelfHealService);
    logger.debug("CI self-heal service disabled (REDIS_URL not set)");
  }

  // Agent-to-agent messaging service (created after db is ready via onReady hook)
  // Decorated as undefined initially, wired with db in onReady
  app.decorate("messagingService", undefined as unknown as AgentMessagingService);

  // Autonomy tier service (created after db is ready via onReady hook)
  app.decorate("autonomyTierService", undefined as unknown as AutonomyTierService);

  // Deploy circuit breaker service (created after db is ready via onReady hook)
  app.decorate("deployCircuitBreakerService", undefined as unknown as DeployCircuitBreakerService);

  // Session engagement service (created after db is ready via onReady hook)
  app.decorate("sessionEngagementService", undefined as unknown as SessionEngagementService);

  // Journal service (created after db is ready via onReady hook)
  app.decorate("journalService", undefined as unknown as JournalService);

  // Budget alert service (created after db is ready via onReady hook)
  app.decorate("budgetAlertService", undefined as unknown as BudgetAlertService);

  // Intelligence services (created after db is ready via onReady hook)
  app.decorate("episodicMemoryService", undefined as unknown as EpisodicMemoryService);
  app.decorate("proceduralMemoryService", undefined as unknown as ProceduralMemoryService);
  app.decorate("memoryLifecycleService", undefined as unknown as MemoryLifecycleService);
  app.decorate("failurePatternsService", undefined as unknown as FailurePatternService);


  // Seed LLM provider health from DB on startup, flush periodically
  let healthFlushInterval: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    // Wire messaging service now that db is available
    // redisPubSub is optional — wired via pubsubPlugin decorator if available
    const redisPubSub = (app as unknown as Record<string, unknown>).redisPubSub as RedisPubSub | undefined;
    app.messagingService = new AgentMessagingService(app.db, redisPubSub);
    logger.info("agent messaging service initialized");

    // Wire deploy circuit breaker service
    app.deployCircuitBreakerService = new DeployCircuitBreakerService(app.db, notificationService);
    logger.info("deploy circuit breaker service initialized");

    // Wire session engagement service
    app.sessionEngagementService = new SessionEngagementService(app.db);
    logger.info("session engagement service initialized");

    // Wire journal service
    app.journalService = createJournalService(app.db, llmRegistry, app.agentEvents);
    logger.info("journal service initialized");

    // Wire budget alert service
    app.budgetAlertService = new BudgetAlertService(app.db, notificationService);
    logger.info("budget alert service initialized");

    // Wire intelligence services (episodic memory, procedural memory, memory lifecycle, failure patterns)
    const embedFn = embeddingService ? (text: string) => embeddingService.embed(text) : undefined;
    if (embedFn) {
      app.episodicMemoryService = new EpisodicMemoryService(app.db, llmRegistry, embedFn);
      app.proceduralMemoryService = new ProceduralMemoryService(app.db, llmRegistry, embedFn);
      logger.info("episodic + procedural memory services initialized");
    }
    app.memoryLifecycleService = new MemoryLifecycleService(app.db);
    app.failurePatternsService = new FailurePatternService(app.db);
    if (optionalEnv("ENABLE_ADAPTIVE_ROUTING", "false") === "true") {
      app.adaptiveRoutingService = new AdaptiveRoutingService(app.db);
      logger.info("adaptive routing service initialized");
    } else {
      logger.debug("adaptive routing service disabled (ENABLE_ADAPTIVE_ROUTING not set)");
    }
    logger.info("memory lifecycle + failure patterns services initialized");

    // Wire autonomy tier service and seed default tool tiers on first start
    const tierService = new AutonomyTierService(app.db);
    await tierService.load();
    app.autonomyTierService = tierService;
    logger.info("autonomy tier service initialized");

    // Seed default tool tiers if table is empty (first server start)
    try {
      const existing = await listToolTierConfigs(app.db);
      if (existing.length === 0) {
        for (const toolName of DEFAULT_TOOLS) {
          await upsertToolTierConfig(app.db, { toolName, tier: "green" });
        }
        logger.info({ count: DEFAULT_TOOLS.length }, "seeded default tool tier configs (green)");
        // Reload in-memory cache to reflect seeded data
        await tierService.reload();
      }
    } catch (err) {
      logger.warn({ err }, "failed to seed default tool tier configs (non-fatal)");
    }

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
      messagingService: app.messagingService,
      autonomyTierService: app.autonomyTierService,
      monitoringService,
      pollIntervalMs: 60_000,
      briefingHour: Number(optionalEnv("BRIEFING_HOUR", "9")),
      briefingTimezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
    });
    app.addHook("onClose", async () => scheduler.stop());
    logger.info("scheduler daemon started");

    // Optional document watcher for RAG re-ingestion
    const docWatchPaths = optionalEnv("DOC_WATCH_PATHS", "");
    if (docWatchPaths) {
      const docWatcher = createDocumentWatcher(docWatchPaths);
      if (docWatcher) {
        await docWatcher.start();
        app.addHook("onClose", async () => docWatcher.stop());
        logger.info("document watcher started");
      }
    }

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

  // Global error handler — normalize all error responses, differentiate retryable errors
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isConnectionError =
      error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET" ||
      error.code === "EPIPE" ||
      error.message?.includes("connection") ||
      error.message?.includes("Connection terminated");

    if (statusCode >= 500) {
      logger.error({ err: error, code: error.code }, "unhandled server error");
    }

    if (isConnectionError) {
      reply.status(503).send({
        error: "Service temporarily unavailable",
        statusCode: 503,
        retryable: true,
      });
      return;
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.message,
      statusCode,
    });
  });

  // Register public routes (no JWT required)
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(channelRoutes, { prefix: "/api/channels" });
  app.register(webhookRoutes, { prefix: "/api/webhooks" });
  app.register(voiceRoutes, { prefix: "/voice" });
  app.register(deployWebhookRoute); // Public: no prefix — route includes /api/deploys/webhook
  app.register(recapRoutes, { prefix: "/api/recap" }); // Public: token-protected via RECAP_TOKEN

  // Project registry plugin — loads registered projects from DB and decorates app.projectRegistry
  app.register(projectRegistryPlugin);

  // Register all protected API routes inside jwtGuardPlugin scope
  // The guard applies onRequest JWT verification to everything inside its scope
  app.register(jwtGuardPlugin);

  // Queue system (requires REDIS_URL)
  app.register(queuePlugin);

  // Pub/sub bridge: shared Redis subscriber + EventEmitter routing for SSE endpoint
  app.register(pubsubPlugin);

  // WebSocket real-time push for dashboard
  app.register(websocketPlugin);
  app.register(wsEmitterPlugin);

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
    browserService: BrowserService;
    notificationService: NotificationService;
    monitoringService: MonitoringService;
    ttsService: TTSService;
    messagingService: AgentMessagingService;
    autonomyTierService: AutonomyTierService;
    deployCircuitBreakerService: DeployCircuitBreakerService;
    sessionEngagementService: SessionEngagementService;
    ciSelfHealService?: CiSelfHealService;
    journalService: JournalService;
    budgetAlertService: BudgetAlertService;
    episodicMemoryService?: EpisodicMemoryService;
    proceduralMemoryService?: ProceduralMemoryService;
    memoryLifecycleService?: MemoryLifecycleService;
    failurePatternsService?: FailurePatternService;
    adaptiveRoutingService?: AdaptiveRoutingService;
    wsBroadcast: (channel: WsChannel) => void;
  }
}
