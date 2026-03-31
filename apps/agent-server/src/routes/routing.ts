import type { FastifyPluginAsync } from "fastify";

export const routingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    { schema: { tags: ["routing"] } },
    async () => {
      if (!app.adaptiveRoutingService) {
        return { error: "Adaptive routing service not available", stats: null };
      }
      return app.adaptiveRoutingService.getRoutingStats();
    },
  );
};

export const routingStatsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/stats",
    { schema: { tags: ["routing"] } },
    async () => {
      if (!app.adaptiveRoutingService) {
        return { error: "Adaptive routing not enabled. Set ENABLE_ADAPTIVE_ROUTING=true", stats: null };
      }
      return app.adaptiveRoutingService.getRoutingStats();
    },
  );
};
