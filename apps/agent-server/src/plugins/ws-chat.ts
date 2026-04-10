import type { WebSocket } from "ws";
import fp from "fastify-plugin";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { WsChatClientMessage, WsChatServerMessage, AgentMessage } from "@ai-cofounder/shared";
import type { StreamCallback } from "../agents/stream-events.js";
import type { Db } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { createOrchestrator } from "../helpers/create-orchestrator.js";
import { ContextWindowManager } from "../services/context-window.js";
import { ConversationIngestionService } from "../services/conversation-ingestion.js";
import { generateSuggestions } from "../services/suggestions.js";
import { recordActionSafe } from "../services/action-recorder.js";
import { recordLlmMetrics } from "../plugins/observability.js";
import {
  findOrCreateUser,
  createConversation,
  createMessage,
  getConversation,
  updateConversationTitle,
  getTodayTokenTotal,
} from "@ai-cofounder/db";

const logger = createLogger("ws-chat-plugin");

/** Per-conversation set of connected sockets (supports multiple tabs) */
const chatClients = new Map<string, Set<WebSocket>>();

/** Track alive status per socket for heartbeat */
const aliveMap = new WeakMap<WebSocket, boolean>();

function send(socket: WebSocket, msg: WsChatServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(msg));
  }
}

/** Fire-and-forget: generate a 3-6 word title for a new conversation */
async function generateConversationTitle(
  app: { db: Db; llmRegistry: LlmRegistry },
  conversationId: string,
  userMessage: string,
  agentResponse: string,
): Promise<void> {
  try {
    const conv = await getConversation(app.db, conversationId);
    if (conv?.title) return;

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
    // Non-fatal
  }
}

/**
 * WebSocket chat plugin — adds a `/ws/chat/:conversationId` route for
 * bidirectional streaming chat. Replaces SSE as the primary transport
 * while SSE remains available as fallback.
 *
 * Requires the base websocketPlugin to be registered first (which
 * registers @fastify/websocket).
 */
export const wsChatPlugin = fp(async (app) => {
  const orchestrator = createOrchestrator(app);
  const contextWindow = new ContextWindowManager(app.db, app.llmRegistry);
  const conversationIngestion = new ConversationIngestionService(
    app.db,
    app.llmRegistry,
    app.embeddingService,
  );
  const dailyTokenLimit = parseInt(optionalEnv("DAILY_TOKEN_LIMIT", "0"), 10);

  // Heartbeat interval for chat sockets
  const heartbeatInterval = setInterval(() => {
    for (const [, sockets] of chatClients) {
      for (const socket of sockets) {
        if (!aliveMap.get(socket)) {
          logger.debug("dropping unresponsive chat WebSocket client");
          socket.terminate();
          continue;
        }
        aliveMap.set(socket, false);
        socket.ping();
      }
    }
  }, 30_000);
  heartbeatInterval.unref();

  app.get<{ Params: { conversationId: string } }>(
    "/ws/chat/:conversationId",
    { websocket: true },
    (socket, request) => {
      const { conversationId } = request.params as { conversationId: string };

      // JWT auth via query param
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");

      if (typeof request.server.jwt?.verify === "function" && token) {
        try {
          request.server.jwt.verify(token);
        } catch {
          send(socket, { type: "error", message: "Unauthorized" });
          socket.close(4001, "Unauthorized");
          return;
        }
      } else if (process.env.NODE_ENV === "production" && !token) {
        send(socket, { type: "error", message: "Token required" });
        socket.close(4001, "Token required");
        return;
      }

      // Track client per conversation
      if (!chatClients.has(conversationId)) {
        chatClients.set(conversationId, new Set());
      }
      const conversationSockets = chatClients.get(conversationId)!;
      conversationSockets.add(socket);
      aliveMap.set(socket, true);

      logger.info(
        { conversationId, tabCount: conversationSockets.size },
        "chat WebSocket client connected",
      );

      // Track whether a message is currently being processed
      let isProcessing = false;

      socket.on("pong", () => {
        aliveMap.set(socket, true);
      });

      socket.on("message", (raw) => {
        aliveMap.set(socket, true);

        let msg: WsChatClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as WsChatClientMessage;
        } catch {
          send(socket, { type: "error", message: "Invalid JSON" });
          return;
        }

        switch (msg.type) {
          case "ping":
            send(socket, { type: "pong" });
            break;

          case "user_message":
            if (isProcessing) {
              send(socket, { type: "error", message: "A message is already being processed" });
              return;
            }
            isProcessing = true;
            handleUserMessage(socket, conversationId, msg, request.workspaceId).finally(() => {
              isProcessing = false;
            });
            break;

          default:
            send(socket, { type: "error", message: "Unknown message type" });
        }
      });

      socket.on("close", () => {
        const sockets = chatClients.get(conversationId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            chatClients.delete(conversationId);
          }
        }
        logger.info(
          { conversationId, tabCount: chatClients.get(conversationId)?.size ?? 0 },
          "chat WebSocket client disconnected",
        );
      });

      socket.on("error", (err) => {
        logger.warn({ err, conversationId }, "chat WebSocket client error");
      });
    },
  );

  async function handleUserMessage(
    socket: WebSocket,
    conversationId: string,
    msg: WsChatClientMessage & { type: "user_message" },
    workspaceId: string,
  ): Promise<void> {
    const { content: message, userId, platform } = msg;

    // Validate message
    if (!message || message.length === 0 || message.length > 32_000) {
      send(socket, { type: "error", message: "Message must be between 1 and 32000 characters" });
      return;
    }

    // Enforce daily token limit
    if (dailyTokenLimit > 0) {
      const todayTotal = await getTodayTokenTotal(app.db);
      if (todayTotal >= dailyTokenLimit) {
        send(socket, { type: "error", message: "Daily token limit exceeded" });
        return;
      }
    }

    let convId = conversationId;
    let dbUserId: string | undefined;

    if (userId) {
      const user = await findOrCreateUser(app.db, userId, platform ?? "dashboard");
      dbUserId = user.id;

      // If conversationId is "new", create one
      if (convId === "new") {
        const conv = await createConversation(app.db, { userId: user.id, workspaceId });
        convId = conv.id;
      }
    }

    // Load conversation history
    let resolvedHistory: AgentMessage[] | undefined;
    try {
      const prepared = await contextWindow.prepareHistory(convId);
      resolvedHistory = contextWindow.trimToFit(prepared.messages);
    } catch (err) {
      logger.warn({ err, convId }, "context window management failed (non-fatal)");
    }

    // Create a stream callback that sends events to all tabs viewing this conversation
    const onEvent: StreamCallback = async (event) => {
      const allSockets = chatClients.get(conversationId);
      if (!allSockets) return;

      let wsMsg: WsChatServerMessage;
      switch (event.type) {
        case "thinking":
          wsMsg = { type: "thinking", message: (event.data.message as string) ?? "Thinking..." };
          break;
        case "tool_call":
          wsMsg = {
            type: "tool_start",
            id: (event.data.id as string) ?? crypto.randomUUID(),
            toolName: (event.data.name as string) ?? "unknown",
            input: (event.data.input as Record<string, unknown>) ?? undefined,
          };
          break;
        case "tool_result":
          wsMsg = {
            type: "tool_result",
            id: (event.data.id as string) ?? "",
            toolName: (event.data.name as string) ?? "unknown",
            result: (event.data.result as string) ?? "",
          };
          break;
        case "text_delta":
          wsMsg = { type: "agent_chunk", content: (event.data.text as string) ?? "" };
          break;
        case "done":
          // Done is handled after runStream completes
          return;
        case "error":
          wsMsg = { type: "error", message: (event.data.message as string) ?? "Unknown error" };
          break;
        default:
          // Forward other event types as-is if recognized
          if (event.type === "rich_card") {
            wsMsg = {
              type: "rich_card" as const,
              cardType: (event.data.type as string) ?? "goal_progress",
              data: (event.data.data as Record<string, unknown>) ?? {},
            };
          } else {
            return;
          }
      }

      for (const s of allSockets) {
        send(s, wsMsg);
      }
    };

    const isNewConversation = conversationId === "new";
    if (workspaceId) orchestrator.setWorkspaceId(workspaceId);
    const llmStart = Date.now();

    try {
      const result = await orchestrator.runStream(
        message,
        onEvent,
        convId,
        resolvedHistory,
        dbUserId,
        undefined,
        undefined,
      );

      // Persist messages
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

      // Send completion to all tabs
      const allSockets = chatClients.get(conversationId);
      if (allSockets) {
        const completeMsg: WsChatServerMessage = {
          type: "agent_complete",
          conversationId: result.conversationId,
          response: result.response,
          model: result.model,
          provider: result.provider,
          usage: result.usage as Record<string, unknown> | undefined,
          plan: result.plan as Record<string, unknown> | undefined,
        };
        for (const s of allSockets) {
          send(s, completeMsg);
        }
      }

      // Fire-and-forget title generation for new conversations
      if (result.conversationId && isNewConversation) {
        generateConversationTitle(app, result.conversationId, message, result.response).catch((err) => logger.warn({ err }, "conversation title generation failed"));
      }

      // Record metrics
      if (result.usage && result.model) {
        recordLlmMetrics({
          provider: result.provider ?? "unknown",
          model: result.model,
          taskCategory: "conversation",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - llmStart,
          success: true,
        });
      }

      // Record user action
      if (dbUserId) {
        recordActionSafe(app.db, {
          workspaceId,
          userId: dbUserId,
          actionType: "chat_message",
          actionDetail: message.slice(0, 200),
        });
      }

      // Fire-and-forget conversation ingestion
      const redisEnabled = !!optionalEnv("REDIS_URL", "");
      if (redisEnabled && app.embeddingService && result.conversationId) {
        conversationIngestion.ingestAfterResponse(result.conversationId, message, result.response).catch((err) => logger.warn({ err }, "conversation ingestion failed"));
      }

      // Fire-and-forget decision extraction
      if (redisEnabled && dbUserId) {
        const { getReflectionQueue } = await import("@ai-cofounder/queue");
        getReflectionQueue().add("extract-decision", {
          action: "extract_decision",
          response: result.response,
          userId: dbUserId,
          conversationId: result.conversationId,
        }).catch((err) => logger.warn({ err }, "decision extraction enqueue failed"));
      }

      // Generate and send suggestions
      const suggestions = await generateSuggestions(app.db, app.llmRegistry, {
        userMessage: message,
        agentResponse: result.response,
        userId: dbUserId,
      });
      if (suggestions.length > 0) {
        const currentSockets = chatClients.get(conversationId);
        if (currentSockets) {
          const suggestionsMsg: WsChatServerMessage = { type: "suggestions", suggestions };
          for (const s of currentSockets) {
            send(s, suggestionsMsg);
          }
        }
      }
    } catch (err) {
      logger.error({ err, conversationId }, "WebSocket chat handler error");
      send(socket, {
        type: "error",
        message: err instanceof Error ? err.message : "Internal error",
      });
    }
  }

  // Cleanup on server close
  app.addHook("onClose", async () => {
    clearInterval(heartbeatInterval);
    for (const [, sockets] of chatClients) {
      for (const socket of sockets) {
        socket.close(1001, "Server shutting down");
      }
    }
    chatClients.clear();
    logger.info("WebSocket chat plugin shut down");
  });

  logger.info("WebSocket chat plugin initialized");
});

// Export for testing
export { chatClients as _chatClients };
