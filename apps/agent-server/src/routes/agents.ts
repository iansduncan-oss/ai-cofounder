import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentMessage } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";
import {
  findOrCreateUser,
  createConversation,
  getConversationMessages,
  createMessage,
} from "@ai-cofounder/db";

const RunBody = Type.Object({
  message: Type.String({ minLength: 1 }),
  conversationId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  platform: Type.Optional(Type.String()),
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
  );

  app.post<{ Body: RunBody }>("/run", { schema: { body: RunBody } }, async (request, _reply) => {
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

    const result = await orchestrator.run(
      message,
      convId,
      resolvedHistory as AgentMessage[] | undefined,
      dbUserId,
    );

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

    return result;
  });
};
