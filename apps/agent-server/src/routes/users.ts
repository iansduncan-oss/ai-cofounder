import type { FastifyPluginAsync } from "fastify";
import { findUserByPlatform } from "@ai-cofounder/db";

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { platform: string; externalId: string } }>(
    "/by-platform/:platform/:externalId",
    async (request, reply) => {
      const { platform, externalId } = request.params;
      const user = await findUserByPlatform(app.db, platform, externalId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      return user;
    },
  );
};
