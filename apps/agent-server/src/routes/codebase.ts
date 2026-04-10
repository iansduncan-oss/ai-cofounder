import type { FastifyInstance } from "fastify";
import {
  listCodebaseInsights,
  updateCodebaseInsightStatus,
  countCodebaseInsights,
  type InsightCategory,
  type InsightSeverity,
} from "@ai-cofounder/db";
import { CodebaseScannerService } from "../services/codebase-scanner.js";

export async function codebaseRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/codebase/scan — trigger a fresh scan
  app.post("/scan", async (request) => {
    const body = (request.body ?? {}) as { synthesize?: boolean; repoDir?: string };
    const scanner = new CodebaseScannerService(app.db, app.llmRegistry, app.monitoringService);
    const result = await scanner.scan({
      synthesize: body.synthesize ?? true,
      repoDir: body.repoDir,
    });
    app.wsBroadcast?.("codebase");
    return result;
  });

  // GET /api/codebase/insights — list insights with optional filters
  app.get("/insights", async (request) => {
    const {
      status = "open",
      category,
      severity,
      limit,
      offset,
    } = request.query as {
      status?: "open" | "dismissed" | "resolved";
      category?: InsightCategory;
      severity?: InsightSeverity;
      limit?: string;
      offset?: string;
    };
    return listCodebaseInsights(app.db, {
      status,
      category,
      severity,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  });

  // GET /api/codebase/insights/count — quick count for badges
  app.get("/insights/count", async () => {
    const open = await countCodebaseInsights(app.db, "open");
    return { open };
  });

  // PATCH /api/codebase/insights/:id/status — dismiss or resolve
  app.patch("/insights/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: "open" | "dismissed" | "resolved" };
    if (!["open", "dismissed", "resolved"].includes(status)) {
      return reply.status(400).send({ error: "Invalid status" });
    }
    const row = await updateCodebaseInsightStatus(app.db, id, status);
    if (!row) return reply.status(404).send({ error: "Insight not found" });
    app.wsBroadcast?.("codebase");
    return row;
  });
}
