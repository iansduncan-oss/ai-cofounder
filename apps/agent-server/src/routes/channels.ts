import type { FastifyPluginAsync } from "fastify";
import { getChannelConversation, upsertChannelConversation, deleteChannelConversation } from "@ai-cofounder/db";

export const channelRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/channels/:channelId/conversation
  app.get<{ Params: { channelId: string } }>("/:channelId/conversation", { schema: { tags: ["channels"] } }, async (request, reply) => {
    const { channelId } = request.params;
    const record = await getChannelConversation(app.db, channelId);
    if (!record) {
      return reply.status(404).send({ error: "No conversation for channel" });
    }
    return { conversationId: record.conversationId, updatedAt: record.updatedAt.toISOString() };
  });

  // PUT /api/channels/:channelId/conversation
  app.put<{
    Params: { channelId: string };
    Body: { conversationId: string; platform?: string };
  }>("/:channelId/conversation", { schema: { tags: ["channels"] } }, async (request) => {
    const { channelId } = request.params;
    const { conversationId, platform } = request.body;
    const record = await upsertChannelConversation(app.db, channelId, conversationId, platform);
    return { conversationId: record.conversationId };
  });

  // DELETE /api/channels/:channelId/conversation
  app.delete<{ Params: { channelId: string } }>("/:channelId/conversation", { schema: { tags: ["channels"] } }, async (request) => {
    const { channelId } = request.params;
    await deleteChannelConversation(app.db, channelId);
    return { ok: true };
  });
};
