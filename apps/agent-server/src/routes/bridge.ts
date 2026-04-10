import type { FastifyPluginAsync } from "fastify";
import { listMemoriesByUser, getPrimaryAdminUserId } from "@ai-cofounder/db";
import { buildMemorySnapshot, type BridgeMemory } from "../services/memory-bridge.js";

interface BridgeSnapshotResponse {
  markdown: string;
  includedCount: number;
  excludedCount: number;
  generatedAt: string;
  userId: string;
}

export const bridgeRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/bridge/snapshot
   * Produces a markdown memory primer for Claude Code to read at session start.
   * Pulls memories for a target user (primary admin by default).
   *
   * Query params:
   *   - userId   (optional) override admin
   *   - limit    (optional) total cap, default 40
   *   - perCategoryLimit (optional) default 8
   */
  app.get<{
    Querystring: { userId?: string; limit?: string; perCategoryLimit?: string };
    Reply: BridgeSnapshotResponse | { error: string };
  }>(
    "/snapshot",
    { schema: { tags: ["bridge"] } },
    async (request, reply) => {
      const targetUserId =
        request.query.userId ?? (await getPrimaryAdminUserId(app.db)) ?? null;

      if (!targetUserId) {
        return reply.status(404).send({ error: "No primary admin user configured" });
      }

      const limit = Number(request.query.limit ?? 40);
      const perCategoryLimit = Number(request.query.perCategoryLimit ?? 8);

      // Pull a generous pool (2× requested limit) so the ranker has room to work
      const pool = await listMemoriesByUser(app.db, targetUserId, {
        limit: Math.max(limit * 2, 80),
      });

      const snapshot = buildMemorySnapshot(pool as unknown as BridgeMemory[], {
        limit,
        perCategoryLimit,
      });

      return {
        ...snapshot,
        userId: targetUserId,
      };
    },
  );
};
