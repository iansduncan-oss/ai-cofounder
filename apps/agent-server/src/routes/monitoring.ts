import type { FastifyInstance } from "fastify";

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/monitoring/status — full monitoring report
  app.get("/status", { schema: { tags: ["monitoring"] } }, async () => {
    const report = await app.monitoringService.runFullCheck();
    return report;
  });

  // GET /api/monitoring/github/ci — GitHub CI status only
  app.get("/github/ci", { schema: { tags: ["monitoring"] } }, async () => {
    const ciStatus = await app.monitoringService.checkGitHubCI();
    return { ciStatus };
  });

  // GET /api/monitoring/github/prs — open PRs
  app.get("/github/prs", { schema: { tags: ["monitoring"] } }, async () => {
    const openPRs = await app.monitoringService.checkGitHubPRs();
    return { openPRs };
  });

  // GET /api/monitoring/vps — VPS health
  app.get("/vps", { schema: { tags: ["monitoring"] } }, async () => {
    const vpsHealth = await app.monitoringService.checkVPSHealth();
    if (!vpsHealth) {
      return { error: "VPS monitoring not configured", configured: false };
    }
    return vpsHealth;
  });
}
