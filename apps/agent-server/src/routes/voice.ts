import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";
import {
  findOrCreateUser,
  createConversation,
  getConversationMessages,
  createMessage,
  getActivePersona,
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
    app.messagingService,
    app.autonomyTierService,
  );

  // ── Original non-streaming chat endpoint ──
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

    return result;
  });

  // ── Streaming chat endpoint (SSE) ──
  app.post<{ Body: VoiceChatBody }>(
    "/chat/stream",
    { schema: { body: VoiceChatBody } },
    async (request, reply) => {
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

      // Set up SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const requestId = (request as unknown as Record<string, unknown>).requestId as
        | string
        | undefined;

      const result = await orchestrator.runStream(
        message,
        (event) => {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        convId,
        resolvedHistory,
        dbUserId,
        requestId,
      );

      // Persist messages after streaming completes
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

      // Final done event
      reply.raw.write(
        `data: ${JSON.stringify({ type: "done", data: { conversationId: result.conversationId, model: result.model, provider: result.provider, usage: result.usage } })}\n\n`,
      );
      reply.raw.end();
    },
  );

  // ── TTS endpoint ──
  app.post<{ Body: { text: string } }>(
    "/tts",
    {
      schema: {
        body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 5_000 }) }),
      },
    },
    async (request, reply) => {
      const ttsService = app.ttsService;
      if (!ttsService?.isConfigured()) {
        return reply.status(503).send({ error: "TTS service not configured" });
      }

      // Use active persona's voiceId if available
      const persona = await getActivePersona(app.db);
      const voiceId = persona?.voiceId || undefined;

      const audio = await ttsService.synthesize(request.body.text, voiceId);
      if (!audio) {
        return reply.status(500).send({ error: "TTS generation failed" });
      }

      reply.header("Content-Type", "audio/mpeg");
      reply.header("Content-Length", audio.length);
      return reply.send(audio);
    },
  );
};
