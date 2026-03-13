import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { getProviderHealthHistory, getToolStats } from "@ai-cofounder/db";
import { pingRedis } from "@ai-cofounder/queue";
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

    // External services — config detection only (no active probing)
    const github = !!(optionalEnv("GITHUB_TOKEN", "") && optionalEnv("GITHUB_MONITORED_REPOS", ""));
    const vps = !!(optionalEnv("VPS_HOST", "") && optionalEnv("VPS_USER", ""));
    const tts = !!app.ttsService?.isConfigured();

    // Overall: ok if DB+Redis healthy, degraded otherwise
    const coreHealthy = dbStatus === "ok" && (redisStatus === "ok" || redisStatus === "disabled");

    if (!coreHealthy) {
      reply.code(503);
    }

    return {
      status: coreHealthy ? "ok" : "degraded",
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
      },
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
