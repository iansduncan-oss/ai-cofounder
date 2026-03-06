import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";
import {
  findOrCreateUser,
  createConversation,
  getConversationMessages,
  createMessage,
  recordLlmUsage,
  getTodayTokenTotal,
} from "@ai-cofounder/db";
import { optionalEnv } from "@ai-cofounder/shared";
import { recordLlmMetrics } from "../plugins/observability.js";

const RunBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 32_000 }),
  conversationId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  platform: Type.Optional(Type.String({ maxLength: 50 })),
  history: Type.Optional(
    Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("system")]),
          content: Type.String(),
        },
        { additionalProperties: true },
      ),
    ),
  ),
});
type RunBody = Static<typeof RunBody>;

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const orchestrator = new Orchestrator(
    app.llmRegistry,
    app.db,
    "conversation",
    app.embeddingService,
    app.n8nService,
    app.sandboxService,
    app.workspaceService,
  );

  const dailyTokenLimit = parseInt(optionalEnv("DAILY_TOKEN_LIMIT", "0"), 10);

  app.post<{ Body: RunBody }>("/run", { schema: { tags: ["agents"], body: RunBody } }, async (request, reply) => {
    // Enforce daily token limit if configured
    if (dailyTokenLimit > 0) {
      const todayTotal = await getTodayTokenTotal(app.db);
      if (todayTotal >= dailyTokenLimit) {
        return reply.status(429).send({
          error: "Daily token limit exceeded",
          todayTotal,
          limit: dailyTokenLimit,
        });
      }
    }

    const { message, conversationId, userId, platform, history } = request.body;

    // Resolve or create conversation
    let convId = conversationId;
    let dbUserId: string | undefined;

    if (userId) {
      const user = await findOrCreateUser(app.db, userId, platform ?? "unknown");
      dbUserId = user.id;

      if (!convId) {
        const conv = await createConversation(app.db, { userId: user.id });
        convId = conv.id;
      }
    }

    // Load history from DB if not provided by caller
    let resolvedHistory = history;
    if (!resolvedHistory && convId) {
      const dbMessages = await getConversationMessages(app.db, convId, 50);
      resolvedHistory = dbMessages.reverse().map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role as "user" | "agent" | "system",
        agentRole: m.agentRole ?? undefined,
        content: m.content,
        metadata: m.metadata as Record<string, unknown> | undefined,
        createdAt: m.createdAt,
      }));
    }

    const llmStart = Date.now();
    const result = await orchestrator.run(
      message,
      convId,
      resolvedHistory as AgentMessage[] | undefined,
      dbUserId,
    );
    const llmDurationMs = Date.now() - llmStart;

    // Persist messages to DB
    if (result.conversationId) {
      const cid = result.conversationId;
      await createMessage(app.db, {
        conversationId: cid,
        role: "user",
        content: message,
      });
      await createMessage(app.db, {
        conversationId: cid,
        role: "agent",
        agentRole: "orchestrator",
        content: result.response,
        metadata: result.usage
          ? { usage: result.usage, model: result.model, provider: result.provider }
          : undefined,
      });
    }

    // Record LLM usage for cost tracking + Prometheus metrics
    if (result.usage && result.model) {
      recordLlmMetrics({
        provider: result.provider ?? "unknown",
        model: result.model,
        taskCategory: "conversation",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: llmDurationMs,
        success: true,
      });
      try {
        await recordLlmUsage(app.db, {
          provider: result.provider ?? "unknown",
          model: result.model,
          taskCategory: "conversation",
          agentRole: "orchestrator",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          conversationId: result.conversationId,
        });
      } catch {
        /* usage tracking failures are non-fatal */
      }
    }

    return result;
  });
};
