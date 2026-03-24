import type { FastifyInstance } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { getUserTimezone, setUserTimezone, listPendingApprovals, listActiveGoals } from "@ai-cofounder/db";
import { ContextualAwarenessService } from "../services/contextual-awareness.js";
import { gatherBriefingData } from "../services/briefing.js";

const logger = createLogger("context-routes");

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/context/current — full context block
  app.get("/current", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    const userId = query.userId;

    // Resolve per-user timezone if available
    let timezone: string | undefined;
    if (userId) {
      timezone = (await getUserTimezone(app.db, userId)) ?? undefined;
    }

    const service = new ContextualAwarenessService(app.db, { timezone });
    const block = await service.getContextBlock(userId);
    return { data: block };
  });

  // GET /api/context/engagement — session engagement metrics
  app.get("/engagement", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    if (!query.userId) {
      return { data: null };
    }

    if (!app.sessionEngagementService) {
      return { data: null };
    }

    const context = await app.sessionEngagementService.getEngagementContext(query.userId);
    return { data: context };
  });

  // PUT /api/context/timezone — set user timezone
  app.put("/timezone", { schema: { tags: ["context"] } }, async (request, reply) => {
    const body = request.body as { userId: string; timezone: string } | undefined;
    if (!body?.userId || !body?.timezone) {
      return reply.code(400).send({ error: "userId and timezone are required" });
    }

    // Validate timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
    } catch {
      return reply.code(400).send({ error: `Invalid timezone: ${body.timezone}` });
    }

    await setUserTimezone(app.db, body.userId, body.timezone);
    logger.info({ userId: body.userId, timezone: body.timezone }, "user timezone updated");
    app.agentEvents?.emit("ws:context_change");
    return { status: "updated", timezone: body.timezone };
  });

  // GET /api/context/focus — current work focus
  app.get("/focus", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    if (!query.userId) {
      return { data: null };
    }

    const timezone = (await getUserTimezone(app.db, query.userId)) ?? undefined;

    const service = new ContextualAwarenessService(app.db, { timezone });
    const block = await service.getContextBlock(query.userId);
    return { data: block };
  });

  // GET /api/context/quick-actions — dynamic context-aware quick actions
  app.get("/quick-actions", { schema: { tags: ["context"] } }, async () => {
    const actions: Array<{ label: string; icon: string }> = [];

    try {
      const data = await gatherBriefingData(app.db);
      const hour = new Date().getHours();

      // Time-based actions
      if (hour >= 5 && hour < 12) {
        actions.push({ label: "Catch me up on this morning", icon: "coffee" });
      } else if (hour >= 12 && hour < 17) {
        actions.push({ label: "How's the day going?", icon: "sun" });
      } else {
        actions.push({ label: "Wrap up the day for me", icon: "moon" });
      }

      // Pending approvals
      if (data.pendingApprovalCount > 0) {
        actions.push({
          label: `Review ${data.pendingApprovalCount} pending approval${data.pendingApprovalCount > 1 ? "s" : ""}`,
          icon: "check-circle",
        });
      }

      // Stale goals
      if (data.staleGoalCount > 0) {
        const staleGoal = data.activeGoals.find((g) => g.hoursStale >= 48);
        actions.push({
          label: staleGoal ? `Check on "${staleGoal.title}"` : "Review stale goals",
          icon: "alert-triangle",
        });
      }

      // Active goals progress
      if (data.activeGoals.length > 0 && data.pendingApprovalCount === 0) {
        actions.push({ label: "What's the status on my goals?", icon: "target" });
      }

      // Unread emails
      if (data.unreadEmailCount && data.unreadEmailCount > 0) {
        actions.push({
          label: `${data.unreadEmailCount} unread email${data.unreadEmailCount > 1 ? "s" : ""} — check them?`,
          icon: "mail",
        });
      }

      // Recent deploys
      if (data.recentSessions.some((s) => s.trigger === "deploy" || s.trigger === "ci")) {
        actions.push({ label: "How did the last deploy go?", icon: "rocket" });
      }

      // Costs
      if (data.costsSinceYesterday.requestCount > 0) {
        actions.push({ label: "How much have we spent recently?", icon: "dollar-sign" });
      }
    } catch (err) {
      logger.debug({ err }, "quick-actions generation failed (non-fatal)");
      // Return sensible defaults on failure
      actions.push(
        { label: "What's the status?", icon: "bar-chart" },
        { label: "Check my email", icon: "mail" },
        { label: "What's my day look like?", icon: "calendar" },
      );
    }

    return { data: actions.slice(0, 6) };
  });
}
