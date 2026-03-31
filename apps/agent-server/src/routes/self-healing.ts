import type { FastifyPluginAsync } from "fastify";

export const selfHealingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/status",
    {
      schema: {
        tags: ["monitoring"],
        description: "Get current self-healing status including health scores, circuit breakers, and failure patterns",
      },
    },
    async () => {
      if (!app.selfHealingService) {
        return { error: "Self-healing service not available", status: null };
      }
      return app.selfHealingService.getStatus();
    },
  );

  app.get(
    "/report",
    {
      schema: {
        tags: ["monitoring"],
        description: "Generate a self-healing report with recommendations",
      },
    },
    async () => {
      if (!app.selfHealingService) {
        return { error: "Self-healing service not available", report: null };
      }
      return app.selfHealingService.generateReport();
    },
  );
};
