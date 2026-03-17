import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { getProviderHealthHistory, getToolStats } from "@ai-cofounder/db";
import { pingRedis, getAllQueueStatus } from "@ai-cofounder/queue";
import { optionalEnv } from "@ai-cofounder/shared";
import { gatherBriefingData, formatBriefing, generateLlmBriefing, sendDailyBriefing } from "../services/briefing.js";
import { getActivePersona } from "@ai-cofounder/db";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", { schema: { tags: ["health"] } }, async (_request, reply) => {
    let dbStatus = "ok";
    try {
      await app.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = "unreachable";
    }

    // Redis health check — only if REDIS_URL is configured
    let redisStatus = "disabled";
    const redisUrl = optionalEnv("REDIS_URL", "");
    if (redisUrl) {
      redisStatus = await pingRedis();
    }

    const isHealthy = dbStatus === "ok" && (redisStatus === "ok" || redisStatus === "disabled");

    if (!isHealthy) {
      reply.code(503);
    }

    return {
      status: isHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
      redis: redisStatus,
    };
  });

  /** GET /health/full — aggregated health check across all subsystems */
  app.get("/health/full", { schema: { tags: ["health"] } }, async (_request, reply) => {
    // Core: Database
    let dbStatus = "ok";
    try {
      await app.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = "unreachable";
    }

    // Core: Redis
    let redisStatus = "disabled";
    const redisUrl = optionalEnv("REDIS_URL", "");
    if (redisUrl) {
      redisStatus = await pingRedis();
    }

    // LLM Providers
    const providers = app.llmRegistry.getProviderHealth();
    const llmTotal = providers.length;
    const llmAvailable = providers.filter((p) => p.available).length;
    const llmStatus = llmTotal === 0 ? "none" : llmAvailable === llmTotal ? "ok" : "degraded";
    const circuitBreakers = app.llmRegistry.getCircuitBreakerStates();

    // Queue status (if Redis available)
    let queueStatus: { status: string; dlqSize: number; queues: Awaited<ReturnType<typeof getAllQueueStatus>> } | undefined;
    if (redisUrl) {
      try {
        const queues = await getAllQueueStatus();
        const dlq = queues.find((q) => q.name === "dead-letter");
        const dlqSize = dlq ? dlq.waiting + dlq.failed : 0;
        queueStatus = {
          status: dlqSize > 10 ? "degraded" : "ok",
          dlqSize,
          queues,
        };
      } catch {
        queueStatus = { status: "unreachable", dlqSize: 0, queues: [] };
      }
    }

    // External services — config detection only (no active probing)
    const github = !!(optionalEnv("GITHUB_TOKEN", "") && optionalEnv("GITHUB_MONITORED_REPOS", ""));
    const vps = !!(optionalEnv("VPS_HOST", "") && optionalEnv("VPS_USER", ""));
    const tts = !!app.ttsService?.isConfigured();

    // Overall: ok if DB+Redis healthy and DLQ not overflowing, degraded otherwise
    const coreHealthy = dbStatus === "ok" && (redisStatus === "ok" || redisStatus === "disabled");
    const overallHealthy = coreHealthy && queueStatus?.status !== "degraded";

    if (!coreHealthy) {
      reply.code(503);
    }

    return {
      status: overallHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      core: {
        database: dbStatus,
        redis: redisStatus,
      },
      llm: {
        status: llmStatus,
        available: llmAvailable,
        total: llmTotal,
        circuitBreakers,
      },
      ...(queueStatus ? { queue: queueStatus } : {}),
      external: {
        github: github ? "configured" : "not_configured",
        vps: vps ? "configured" : "not_configured",
        tts: tts ? "configured" : "not_configured",
      },
    };
  });

  /** GET /health/providers — LLM provider health status */
  app.get("/health/providers", { schema: { tags: ["health"] } }, async () => {
    const providers = app.llmRegistry.getProviderHealth();
    const allAvailable = providers.every((p) => p.available);
    return {
      status: allAvailable ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      providers,
    };
  });

  /** GET /health/providers/history — persisted provider health data */
  app.get<{ Querystring: { provider?: string } }>(
    "/health/providers/history",
    { schema: { tags: ["health"] } },
    async (request) => {
      const { provider } = request.query;
      const records = await getProviderHealthHistory(app.db, provider);
      return {
        timestamp: new Date().toISOString(),
        records,
      };
    },
  );

  /** GET /health/deep — timed per-subsystem health check for deploy verification */
  app.get("/health/deep", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const checks: Array<{ name: string; status: string; latencyMs: number; error?: string }> = [];
    const start = performance.now();

    // Database check
    const dbStart = performance.now();
    let dbStatus = "ok";
    let dbError: string | undefined;
    try {
      await app.db.execute(sql`SELECT 1`);
    } catch (err) {
      dbStatus = "unreachable";
      dbError = err instanceof Error ? err.message : String(err);
    }
    checks.push({ name: "database", status: dbStatus, latencyMs: Math.round(performance.now() - dbStart), ...(dbError ? { error: dbError } : {}) });

    // Redis check
    const redisUrl = optionalEnv("REDIS_URL", "");
    const redisStart = performance.now();
    let redisStatus: string;
    let redisError: string | undefined;
    if (!redisUrl) {
      redisStatus = "disabled";
    } else {
      try {
        const result = await pingRedis();
        redisStatus = result === "ok" ? "ok" : "unreachable";
        if (result !== "ok") redisError = "ping returned: " + result;
      } catch (err) {
        redisStatus = "unreachable";
        redisError = err instanceof Error ? err.message : String(err);
      }
    }
    checks.push({ name: "redis", status: redisStatus, latencyMs: Math.round(performance.now() - redisStart), ...(redisError ? { error: redisError } : {}) });

    // LLM check
    const llmStart = performance.now();
    const providers = app.llmRegistry.getProviderHealth();
    let llmStatus: string;
    if (providers.length === 0) {
      llmStatus = "disabled";
    } else {
      const available = providers.filter((p) => p.available).length;
      llmStatus = available === providers.length ? "ok" : "degraded";
    }
    checks.push({ name: "llm", status: llmStatus, latencyMs: Math.round(performance.now() - llmStart) });

    const totalLatencyMs = Math.round(performance.now() - start);
    const overallOk = checks.every((c) => c.status === "ok" || c.status === "disabled");

    if (!overallOk) {
      reply.code(503);
    }

    return {
      status: overallOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      totalLatencyMs,
      checks,
    };
  });

  /** GET /api/tools/stats — per-tool execution timing stats */
  app.get("/api/tools/stats", { schema: { tags: ["health"] } }, async () => {
    const stats = await getToolStats(app.db);
    return {
      timestamp: new Date().toISOString(),
      tools: stats,
    };
  });

  /** GET /api/briefing — generate and optionally send the daily briefing */
  app.get<{ Querystring: { send?: string } }>(
    "/api/briefing",
    { schema: { tags: ["health"] } },
    async (request) => {
      const shouldSend = request.query.send === "true";

      if (shouldSend) {
        const text = await sendDailyBriefing(app.db, app.notificationService, app.llmRegistry);
        return { sent: true, briefing: text };
      }

      const data = await gatherBriefingData(app.db);
      const text = app.llmRegistry
        ? await generateLlmBriefing(app.llmRegistry, data)
        : formatBriefing(data);
      return { sent: false, briefing: text, data };
    },
  );

  /** GET /api/briefing/audio — synthesize briefing as MP3 via TTS */
  app.get("/api/briefing/audio", { schema: { tags: ["health"] } }, async (_request, reply) => {
    if (!app.ttsService?.isConfigured()) {
      return reply.code(503).send({ error: "TTS service not configured" });
    }

    const data = await gatherBriefingData(app.db);
    const narrative = app.llmRegistry
      ? await generateLlmBriefing(app.llmRegistry, data)
      : formatBriefing(data);

    const persona = await getActivePersona(app.db);
    const voiceId = persona?.voiceId ?? undefined;

    const buffer = await app.ttsService.synthesize(narrative, voiceId);
    if (!buffer) {
      return reply.code(500).send({ error: "TTS synthesis failed" });
    }

    return reply.header("Content-Type", "audio/mpeg").send(buffer);
  });
};
