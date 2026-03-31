import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { createOrchestrator } from "../helpers/create-orchestrator.js";
import {
  getConversationMessages,
  createMessage,
  getActivePersona,
} from "@ai-cofounder/db";
import { resolveUserContext } from "../helpers/resolve-user-context.js";
import { recordLlmMetrics } from "../plugins/observability.js";

const logger = createLogger("voice-routes");

const VoiceChatBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 8_000 }),
  conversationId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
});
type VoiceChatBody = Static<typeof VoiceChatBody>;

const SpeakBody = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 5_000 }),
  voiceId: Type.Optional(Type.String()),
});

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  // Register content-type parser for audio blobs (used by /transcribe)
  const audioTypes = [
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mp4",
    "audio/mpeg",
    "audio/webm;codecs=opus",
    "application/octet-stream",
  ];
  for (const mimeType of audioTypes) {
    app.addContentTypeParser(mimeType, { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });
  }

  const orchestrator = createOrchestrator(app);

  // ── Original non-streaming chat endpoint ──
  app.post<{ Body: VoiceChatBody }>("/chat", { schema: { body: VoiceChatBody } }, async (request) => {
    const { message, conversationId, userId } = request.body;

    let convId = conversationId;
    let dbUserId: string | undefined;

    if (userId) {
      const ctx = await resolveUserContext(app.db, userId, "voice", conversationId);
      dbUserId = ctx.dbUserId;
      convId = ctx.conversationId;
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
        const ctx = await resolveUserContext(app.db, userId, "voice", conversationId);
        dbUserId = ctx.dbUserId;
        convId = ctx.conversationId;
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

  // ── Speak endpoint — cleaner API for voice UI ──
  app.post<{ Body: Static<typeof SpeakBody> }>(
    "/speak",
    { schema: { body: SpeakBody } },
    async (request, reply) => {
      const ttsService = app.ttsService;
      if (!ttsService?.isConfigured()) {
        return reply.status(503).send({ error: "TTS service not configured" });
      }

      const persona = await getActivePersona(app.db);
      const voiceId = request.body.voiceId || persona?.voiceId || undefined;

      const audio = await ttsService.synthesize(request.body.text, voiceId);
      if (!audio) {
        return reply.status(500).send({ error: "Speech generation failed" });
      }

      reply.header("Content-Type", "audio/mpeg");
      reply.header("Content-Length", audio.length);
      return reply.send(audio);
    },
  );

  // ── Transcribe endpoint — accepts raw audio, returns text via Whisper API ──
  app.post(
    "/transcribe",
    async (request, reply) => {
      const openaiKey = optionalEnv("OPENAI_API_KEY", "");
      if (!openaiKey) {
        return reply.status(501).send({
          error: "Transcription not available",
          message: "OPENAI_API_KEY is not configured. Use text input or browser speech recognition instead.",
        });
      }

      // Accept raw audio body (WebM/Opus from MediaRecorder)
      const audioData = request.body as Buffer;
      if (!audioData || !Buffer.isBuffer(audioData)) {
        return reply.status(400).send({ error: "No audio data received" });
      }

      if (audioData.length < 100) {
        return reply.status(400).send({ error: "Audio data too small" });
      }

      // Determine content type from request header
      const contentType = (request.headers["content-type"] || "audio/webm").split(";")[0].trim();
      const ext = contentType.includes("wav") ? "wav"
        : contentType.includes("mp4") || contentType.includes("m4a") ? "m4a"
        : contentType.includes("ogg") ? "ogg"
        : "webm";

      try {
        // Build multipart form data for Whisper API
        const boundary = "----VoiceTranscribe" + Date.now();
        const formParts: Buffer[] = [];

        // File field
        formParts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        ));
        formParts.push(audioData);
        formParts.push(Buffer.from("\r\n"));

        // Model field
        formParts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`,
        ));

        // Language field (optional, helps accuracy)
        formParts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`,
        ));

        formParts.push(Buffer.from(`--${boundary}--\r\n`));

        const formBody = Buffer.concat(formParts);

        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body: formBody,
        });

        if (!whisperRes.ok) {
          const errorText = await whisperRes.text();
          logger.error({ status: whisperRes.status, error: errorText }, "Whisper API error");
          return reply.status(whisperRes.status).send({
            error: "Transcription failed",
            message: whisperRes.status === 401 ? "Invalid API key" : "Whisper API error",
          });
        }

        const result = await whisperRes.json() as { text: string };
        return { text: result.text };
      } catch (err) {
        logger.error({ err }, "Transcription failed");
        return reply.status(500).send({ error: "Transcription failed" });
      }
    },
  );
};
