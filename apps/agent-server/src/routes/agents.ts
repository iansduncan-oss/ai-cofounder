import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { createOrchestrator } from "../helpers/create-orchestrator.js";
import type { StreamCallback } from "../agents/stream-events.js";
import {
  findOrCreateUser,
  createConversation,
  createMessage,
  getConversation,
  updateConversationTitle,
  getTodayTokenTotal,
  incrementPatternAcceptCount,
  adjustPatternConfidence,
} from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { recordLlmMetrics } from "../plugins/observability.js";
import { ConversationIngestionService } from "../services/conversation-ingestion.js";
import { ContextWindowManager } from "../services/context-window.js";
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
      Type.Object({
        role: Type.Union([Type.Literal("user"), Type.Literal("agent")]),
        content: Type.String({ minLength: 1, maxLength: 10_000 }),
      }),
      { maxItems: 50 },
    ),
  ),
});
type RunBody = Static<typeof RunBody>;

/** Fire-and-forget: generate a 3-6 word title for a new conversation */
async function generateConversationTitle(
  app: { db: Db; llmRegistry: LlmRegistry },
  conversationId: string,
  userMessage: string,
  agentResponse: string,
): Promise<void> {
  try {
    const conv = await getConversation(app.db, conversationId);
    if (conv?.title) return; // already has a title

    const response = await app.llmRegistry.complete("simple", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Generate a 3-6 word title for this conversation. Return ONLY the title, nothing else.\n\nUser: ${userMessage.slice(0, 300)}\nAssistant: ${agentResponse.slice(0, 300)}`,
            },
          ],
        },
      ],
    });

    const title =
      response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .replace(/^["']|["']$/g, "")
        .trim() || "";

    if (title && title.length <= 100) {
      await updateConversationTitle(app.db, conversationId, title);
    }
  } catch {
    // Non-fatal — title generation is best-effort
  }
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const orchestrator = createOrchestrator(app);

  const conversationIngestion = new ConversationIngestionService(
    app.db,
    app.llmRegistry,
    app.embeddingService,
  );

  const contextWindow = new ContextWindowManager(app.db, app.llmRegistry);

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
        const conv = await createConversation(app.db, { userId: user.id, workspaceId: request.workspaceId });
        convId = conv.id;
      }
    }

    // Load history from DB (with automatic summarization for long conversations)
    let resolvedHistory: AgentMessage[] | undefined = history as AgentMessage[] | undefined;
    if (convId) {
      try {
        const prepared = await contextWindow.prepareHistory(
          convId,
          resolvedHistory,
        );
        resolvedHistory = contextWindow.trimToFit(prepared.messages);
        if (prepared.wasSummarized) {
          logger.info({ convId, totalMessages: prepared.totalDbMessages, estimatedTokens: prepared.estimatedTokens }, "context window managed");
        }
      } catch (err) {
        logger.warn({ err, convId }, "context window management failed (non-fatal)");
      }
    }

    const llmStart = Date.now();
    const result = await orchestrator.run(
      message,
      convId,
      resolvedHistory,
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

    // Fire-and-forget conversation title generation for new conversations
    if (result.conversationId && !conversationId) {
      generateConversationTitle(app, result.conversationId, message, result.response).catch(() => {});
    }

    // Record Prometheus metrics (usage is handled automatically by LlmRegistry.onCompletion hook)
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
    }

    // Record user action (fire-and-forget)
    if (dbUserId) {
      recordActionSafe(app.db, {
        workspaceId: request.workspaceId,
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
        const conv = await createConversation(app.db, { userId: user.id, workspaceId: request.workspaceId });
        convId = conv.id;
      }
    }

    let resolvedHistory: AgentMessage[] | undefined = history as AgentMessage[] | undefined;
    if (convId) {
      try {
        const prepared = await contextWindow.prepareHistory(
          convId,
          resolvedHistory,
        );
        resolvedHistory = contextWindow.trimToFit(prepared.messages);
      } catch (err) {
        logger.warn({ err, convId }, "context window management failed (non-fatal)");
      }
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const abortController = new AbortController();
    request.raw.on("close", () => abortController.abort());

    const send = (event: string, data: unknown) => {
      if (!abortController.signal.aborted) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onEvent: StreamCallback = async (event) => {
      send(event.type, event.data);
    };

    const streamLlmStart = Date.now();
    try {
      const result = await orchestrator.runStream(
        message,
        onEvent,
        convId,
        resolvedHistory,
        dbUserId,
        (request as unknown as Record<string, unknown>).requestId as string | undefined,
        abortController.signal,
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

      // Usage recording handled automatically by LlmRegistry.onCompletion hook

      // Fire-and-forget conversation title generation for new conversations
      if (result.conversationId && !conversationId) {
        generateConversationTitle(app, result.conversationId, message, result.response).catch(() => {});
      }

      if (result.usage && result.model) {
        recordLlmMetrics({
          provider: result.provider ?? "unknown",
          model: result.model,
          taskCategory: "conversation",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - streamLlmStart,
          success: true,
        });
      }

      // Record user action (fire-and-forget)
      if (dbUserId) {
        recordActionSafe(app.db, {
          workspaceId: request.workspaceId,
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
      // Orchestrator already emits error event via onEvent; only log here
      if (!abortController.signal.aborted) {
        logger.error({ err }, "stream handler error");
      }
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
        workspaceId: request.workspaceId,
        userId,
        actionType: "suggestion_accepted",
        actionDetail: suggestion.slice(0, 200),
        metadata: patternId ? { patternId } : undefined,
      });

      if (patternId) {
        incrementPatternAcceptCount(app.db, patternId).catch(() => {});
        adjustPatternConfidence(app.db, patternId, 5).catch(() => {});
      }

      return { ok: true };
    },
  );
};
