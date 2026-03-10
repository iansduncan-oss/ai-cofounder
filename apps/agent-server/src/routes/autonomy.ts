import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  listToolTierConfigs,
  upsertToolTierConfig,
} from "@ai-cofounder/db";

const TierEnum = Type.Union([
  Type.Literal("green"),
  Type.Literal("yellow"),
  Type.Literal("red"),
]);

const UpdateTierBody = Type.Object({
  tier: TierEnum,
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
});

const ToolNameParams = Type.Object({
  toolName: Type.String(),
});

export const autonomyRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list all tool tier configs */
  app.get(
    "/",
    { schema: { tags: ["autonomy"] } },
    async () => {
      const configs = await listToolTierConfigs(app.db);
      return configs.map((c) => ({
        toolName: c.toolName,
        tier: c.tier,
        timeoutMs: c.timeoutMs,
        updatedBy: c.updatedBy,
        updatedAt: c.updatedAt,
      }));
    },
  );

  /* PUT /:toolName — update a tool's tier */
  app.put<{
    Params: typeof ToolNameParams.static;
    Body: typeof UpdateTierBody.static;
  }>(
    "/:toolName",
    { schema: { tags: ["autonomy"], params: ToolNameParams, body: UpdateTierBody } },
    async (request) => {
      const { toolName } = request.params;
      const { tier, timeoutMs } = request.body;

      const updated = await upsertToolTierConfig(app.db, {
        toolName,
        tier,
        timeoutMs: timeoutMs ?? 300_000,
        updatedBy: "dashboard",
      });

      // Reload in-memory cache so change takes effect immediately
      if (app.autonomyTierService) {
        await app.autonomyTierService.reload();
      }

      return updated;
    },
  );
};
