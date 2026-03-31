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
