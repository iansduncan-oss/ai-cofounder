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
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { recordLlmMetrics } from "../plugins/observability.js";

const logger = createLogger("voice-routes");

const VoiceChatBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 8_000 }),
  conversationId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
});
type VoiceChatBody = Static<typeof VoiceChatBody>;

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  const orchestrator = new Orchestrator(
    app.llmRegistry,
    app.db,
    "conversation",
    app.embeddingService,
    app.n8nService,
    app.sandboxService,
    app.workspaceService,
  );

  app.post<{ Body: VoiceChatBody }>("/chat", { schema: { body: VoiceChatBody } }, async (request) => {
    const { message, conversationId, userId } = request.body;

    let convId = conversationId;
    let dbUserId: string | undefined;

    if (userId) {
      const user = await findOrCreateUser(app.db, userId, "voice");
      dbUserId = user.id;

      if (!convId) {
        const conv = await createConversation(app.db, { userId: user.id });
        convId = conv.id;
      }
    }

    // Load conversation history from DB
    let resolvedHistory: AgentMessage[] | undefined;
    if (convId) {
      const dbMessages = await getConversationMessages(app.db, convId, 30);
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
      resolvedHistory,
      dbUserId,
      (request as unknown as Record<string, unknown>).requestId as string | undefined,
    );
    const llmDurationMs = Date.now() - llmStart;

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

    // Record usage metrics
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
        /* non-fatal */
      }
    }

    return result;
  });
};
