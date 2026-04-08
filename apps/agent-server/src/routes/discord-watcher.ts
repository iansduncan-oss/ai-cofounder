import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { enqueueDiscordTriage } from "@ai-cofounder/queue";

const logger = createLogger("discord-watcher");

const BufferedMessage = Type.Object({
  messageId: Type.String(),
  channelId: Type.String(),
  channelName: Type.String(),
  authorId: Type.String(),
  authorName: Type.String(),
  content: Type.String(),
  timestamp: Type.String(),
  hasAttachments: Type.Boolean(),
  referencedMessageId: Type.Optional(Type.String()),
});

const IngestBody = Type.Object({
  channelId: Type.String(),
  channelName: Type.String(),
  guildId: Type.String(),
  messages: Type.Array(BufferedMessage),
});

type IngestBodyType = Static<typeof IngestBody>;

export const discordWatcherRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: IngestBodyType }>(
    "/ingest",
    { schema: { body: IngestBody, tags: ["discord-watcher"] } },
    async (request, reply) => {
      if (optionalEnv("DISCORD_WATCHER_ENABLED", "false") !== "true") {
        return reply.status(503).send({ error: "Discord watcher disabled" });
      }

      const { channelId, channelName, guildId, messages } = request.body;

      if (messages.length === 0) {
        return reply.send({ accepted: false, reason: "empty batch" });
      }

      const jobId = await enqueueDiscordTriage({
        channelId,
        channelName,
        guildId,
        messages,
        batchedAt: new Date().toISOString(),
      });

      logger.info(
        { channelId, channelName, messageCount: messages.length, jobId },
        "discord message batch enqueued for triage",
      );

      return reply.status(202).send({ accepted: true, batchId: jobId });
    },
  );
};
