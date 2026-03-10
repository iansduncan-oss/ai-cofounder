import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";
import { summarizeMessages } from "../agents/summarizer.js";
import type { StreamCallback } from "../agents/stream-events.js";
import {
  findOrCreateUser,
  createConversation,
  getConversationMessages,
  getConversationMessageCount,
  getLatestConversationSummary,
  saveConversationSummary,
  createMessage,
  recordLlmUsage,
  getTodayTokenTotal,
  incrementPatternAcceptCount,
} from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { recordLlmMetrics } from "../plugins/observability.js";
import { ConversationIngestionService } from "../services/conversation-ingestion.js";
import { generateSuggestions } from "../services/suggestions.js";
import { recordActionSafe } from "../services/action-recorder.js";

const logger = createLogger("agent-routes");

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
    app.messagingService,
    app.autonomyTierService,
  );

  const conversationIngestion = new ConversationIngestionService(
    app.db,
    app.llmRegistry,
    app.embeddingService,
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

    // Lazy conversation summarization for long conversations
    if (convId && resolvedHistory) {
      try {
        const totalMessages = await getConversationMessageCount(app.db, convId);
        if (totalMessages > 30) {
          const existingSummary = await getLatestConversationSummary(app.db, convId);
          const isStale = !existingSummary || existingSummary.messageCount < totalMessages - 10;

          if (isStale) {
            // Fetch older messages beyond the 50-message window
            const olderMessages = await getConversationMessages(app.db, convId, 50, 50);
            if (olderMessages.length > 0) {
              const olderFormatted = olderMessages.reverse().map((m) => ({
                role: m.role as "user" | "agent" | "system",
                content: m.content,
              }));
              const summaryText = await summarizeMessages(app.llmRegistry, olderFormatted as AgentMessage[]);
              await saveConversationSummary(app.db, {
                conversationId: convId,
                summary: summaryText,
                messageCount: totalMessages,
                fromMessageCreatedAt: olderMessages[olderMessages.length - 1]?.createdAt,
                toMessageCreatedAt: olderMessages[0]?.createdAt,
              });

              // Prepend summary as a synthetic system message at start of history
              resolvedHistory = [
                {
                  role: "system" as const,
                  content: `[Previous conversation summary]\n${summaryText}`,
                },
                ...resolvedHistory,
              ];
            }
          } else {
            // Use existing summary
            resolvedHistory = [
              {
                role: "system" as const,
                content: `[Previous conversation summary]\n${existingSummary.summary}`,
              },
              ...resolvedHistory,
            ];
          }
        }
      } catch (err) {
        logger.warn({ err, convId }, "conversation summarization failed (non-fatal)");
      }
    }

    const llmStart = Date.now();
    const result = await orchestrator.run(
      message,
      convId,
      resolvedHistory as AgentMessage[] | undefined,
      dbUserId,
      (request as unknown as Record<string, unknown>).requestId as string | undefined,
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

    // Record user action (fire-and-forget)
    if (dbUserId) {
      recordActionSafe(app.db, {
        userId: dbUserId,
        actionType: "chat_message",
        actionDetail: message.slice(0, 200),
      });
    }

    // Fire-and-forget conversation ingestion (eager summarization + RAG enqueue)
    const redisEnabled = !!optionalEnv("REDIS_URL", "");
    if (redisEnabled && app.embeddingService && result.conversationId) {
      conversationIngestion.ingestAfterResponse(result.conversationId, message, result.response).catch(() => {});
    }

    // Fire-and-forget decision extraction (MEM-02)
    if (redisEnabled && dbUserId) {
      const { getReflectionQueue } = await import("@ai-cofounder/queue");
      getReflectionQueue().add("extract-decision", {
        action: "extract_decision",
        response: result.response,
        userId: dbUserId,
        conversationId: result.conversationId,
      }).catch(() => {}); // fire-and-forget
    }

    // Generate anticipatory suggestions (pattern-aware)
    const suggestions = await generateSuggestions(app.db, app.llmRegistry, {
      userMessage: message,
      agentResponse: result.response,
      userId: dbUserId,
    });

    return { ...result, suggestions };
  });

  // SSE streaming endpoint
  app.post<{ Body: RunBody }>("/run/stream", { schema: { tags: ["agents"], body: RunBody } }, async (request, reply) => {
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

    if (convId && resolvedHistory) {
      try {
        const totalMessages = await getConversationMessageCount(app.db, convId);
        if (totalMessages > 30) {
          const existingSummary = await getLatestConversationSummary(app.db, convId);
          const isStale = !existingSummary || existingSummary.messageCount < totalMessages - 10;

          if (isStale) {
            const olderMessages = await getConversationMessages(app.db, convId, 50, 50);
            if (olderMessages.length > 0) {
              const olderFormatted = olderMessages.reverse().map((m) => ({
                role: m.role as "user" | "agent" | "system",
                content: m.content,
              }));
              const summaryText = await summarizeMessages(app.llmRegistry, olderFormatted as AgentMessage[]);
              await saveConversationSummary(app.db, {
                conversationId: convId,
                summary: summaryText,
                messageCount: totalMessages,
                fromMessageCreatedAt: olderMessages[olderMessages.length - 1]?.createdAt,
                toMessageCreatedAt: olderMessages[0]?.createdAt,
              });

              resolvedHistory = [
                { role: "system" as const, content: `[Previous conversation summary]\n${summaryText}` },
                ...resolvedHistory,
              ];
            }
          } else {
            resolvedHistory = [
              { role: "system" as const, content: `[Previous conversation summary]\n${existingSummary.summary}` },
              ...resolvedHistory,
            ];
          }
        }
      } catch (err) {
        logger.warn({ err, convId }, "conversation summarization failed (non-fatal)");
      }
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onEvent: StreamCallback = async (event) => {
      send(event.type, event.data);
    };

    try {
      const result = await orchestrator.runStream(
        message,
        onEvent,
        convId,
        resolvedHistory as AgentMessage[] | undefined,
        dbUserId,
        (request as unknown as Record<string, unknown>).requestId as string | undefined,
      );

      // Persist messages to DB
      if (result.conversationId) {
        const cid = result.conversationId;
        await createMessage(app.db, { conversationId: cid, role: "user", content: message });
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

      if (result.usage && result.model) {
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
        } catch { /* non-fatal */ }
      }

      // Record user action (fire-and-forget)
      if (dbUserId) {
        recordActionSafe(app.db, {
          userId: dbUserId,
          actionType: "chat_message",
          actionDetail: message.slice(0, 200),
        });
      }

      // Fire-and-forget conversation ingestion (eager summarization + RAG enqueue)
      const streamRedisEnabled = !!optionalEnv("REDIS_URL", "");
      if (streamRedisEnabled && app.embeddingService && result.conversationId) {
        conversationIngestion.ingestAfterResponse(result.conversationId, message, result.response).catch(() => {});
      }

      // Fire-and-forget decision extraction (MEM-02)
      if (streamRedisEnabled && dbUserId) {
        const { getReflectionQueue } = await import("@ai-cofounder/queue");
        getReflectionQueue().add("extract-decision", {
          action: "extract_decision",
          response: result.response,
          userId: dbUserId,
          conversationId: result.conversationId,
        }).catch(() => {}); // fire-and-forget
      }

      // Generate and emit anticipatory suggestions (pattern-aware)
      const suggestions = await generateSuggestions(app.db, app.llmRegistry, {
        userMessage: message,
        agentResponse: result.response,
        userId: dbUserId,
      });
      if (suggestions.length > 0) {
        send("suggestions", { suggestions });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      send("error", { error: errorMsg });
    } finally {
      reply.raw.end();
    }
  });

  /* POST /accept-suggestion — record that a user clicked a suggestion chip */
  const AcceptSuggestionBody = Type.Object({
    suggestion: Type.String({ minLength: 1 }),
    userId: Type.Optional(Type.String()),
    patternId: Type.Optional(Type.String({ format: "uuid" })),
  });

  app.post<{ Body: typeof AcceptSuggestionBody.static }>(
    "/accept-suggestion",
    { schema: { tags: ["agents"], body: AcceptSuggestionBody } },
    async (request) => {
      const { suggestion, userId, patternId } = request.body;

      recordActionSafe(app.db, {
        userId,
        actionType: "suggestion_accepted",
        actionDetail: suggestion.slice(0, 200),
        metadata: patternId ? { patternId } : undefined,
      });

      if (patternId) {
        incrementPatternAcceptCount(app.db, patternId).catch(() => {});
      }

      return { ok: true };
    },
  );
};
