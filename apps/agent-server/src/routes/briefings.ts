import type { FastifyInstance } from "fastify";
import { getBriefingCache } from "@ai-cofounder/db";
import { sendDailyBriefing } from "../services/briefing.js";

export async function briefingRoutes(app: FastifyInstance) {
  app.get("/today", async (request, reply) => {
    const { refresh } = request.query as { refresh?: string };
    const today = new Date().toISOString().slice(0, 10);

    // Return cached unless refresh requested
    if (refresh !== "true") {
      const cached = await getBriefingCache(app.db, today);
      if (cached) {
        return reply.send({
          date: cached.date,
          text: cached.briefingText,
          sections: cached.sections,
          cached: true,
        });
      }
    }

    // Generate fresh briefing
    const { getPrimaryAdminUserId } = await import("@ai-cofounder/db");
    const adminUserId = await getPrimaryAdminUserId(app.db);
    const text = await sendDailyBriefing(
      app.db,
      app.notificationService,
      app.llmRegistry,
      adminUserId ?? undefined,
    );

    return reply.send({
      date: today,
      text,
      sections: null,
      cached: false,
    });
  });
}
