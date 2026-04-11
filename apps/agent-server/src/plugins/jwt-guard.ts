import type { FastifyInstance, FastifyRequest } from "fastify";
import { agentRoutes } from "../routes/agents.js";
import { goalRoutes } from "../routes/goals.js";
import { taskRoutes } from "../routes/tasks.js";
import { approvalRoutes } from "../routes/approvals.js";
import { memoryRoutes } from "../routes/memories.js";
import { bridgeRoutes } from "../routes/bridge.js";
import { userRoutes } from "../routes/users.js";
import { promptRoutes } from "../routes/prompts.js";
import { n8nRoutes } from "../routes/n8n.js";
import { executionRoutes } from "../routes/execution.js";
import { usageRoutes } from "../routes/usage.js";
import { eventRoutes } from "../routes/events.js";
import { scheduleRoutes } from "../routes/schedules.js";
import { workspaceRoutes } from "../routes/workspace.js";
import { milestoneRoutes } from "../routes/milestones.js";
import { dashboardRoutes } from "../routes/dashboard.js";
import { conversationRoutes } from "../routes/conversations.js";
import { decisionRoutes } from "../routes/decisions.js";
import { queueRoutes } from "../routes/queue.js";
import { monitoringRoutes } from "../routes/monitoring.js";
import { pipelineRoutes } from "../routes/pipeline.js";
import { ragRoutes } from "../routes/rag.js";
import { personaRoutes } from "../routes/persona.js";
import { reflectionRoutes } from "../routes/reflections.js";
import { subagentRoutes } from "../routes/subagents.js";
import { agentMessageRoutes } from "../routes/agent-messages.js";
import { agentInfoRoutes } from "../routes/agent-info.js";
import { deployRoutes } from "../routes/deploys.js";
import { patternRoutes } from "../routes/patterns.js";
import { autonomyRoutes } from "../routes/autonomy.js";
import { autonomousRoutes } from "../routes/autonomous.js";
import { contextRoutes } from "../routes/context.js";
import { journalRoutes } from "../routes/journal.js";
import { projectRoutes } from "../routes/projects.js";
import { pipelineTemplateRoutes } from "../routes/pipeline-templates.js";
import { settingsApiRoutes } from "../routes/settings-api.js";
import { databaseRoutes } from "../routes/database.js";
import { gmailRoutes } from "../routes/gmail.js";
import { calendarRoutes } from "../routes/calendar.js";
import { briefingRoutes } from "../routes/briefings.js";
import { followUpRoutes } from "../routes/follow-ups.js";
import { thinkingRoutes } from "../routes/thinking.js";
import { searchRoutes } from "../routes/search.js";
import { workSessionRoutes } from "../routes/work-sessions.js";
import { routingRoutes, routingStatsRoutes } from "../routes/routing.js";
import { selfHealingRoutes } from "../routes/self-healing.js";
import { productivityRoutes } from "../routes/productivity.js";
import { codebaseRoutes } from "../routes/codebase.js";
import { workspaceTenantRoutes } from "../routes/workspaces.js";
import { workspaceContextPlugin } from "../plugins/workspace-context.js";
import type { AdminRole } from "../plugins/rbac.js";

/** Check if request is from loopback or Docker bridge (narrower than isInternalRequest) */
function isLoopbackOrDocker(request: FastifyRequest): boolean {
  const socketIp = request.socket.remoteAddress ?? "";
  const isExemptSocket =
    socketIp === "127.0.0.1" ||
    socketIp === "::1" ||
    socketIp === "::ffff:127.0.0.1" ||
    (socketIp.startsWith("172.") &&
      (() => {
        const s = parseInt(socketIp.split(".")[1], 10);
        return s >= 16 && s <= 31;
      })());
  if (!isExemptSocket) return false;
  // When behind a proxy, also check the forwarded IP
  const clientIp = request.ip;
  if (clientIp !== socketIp) {
    if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1")
      return true;
    if (clientIp.startsWith("172.")) {
      const s = parseInt(clientIp.split(".")[1], 10);
      if (s >= 16 && s <= 31) return true;
    }
    return false;
  }
  return true;
}

/**
 * JWT Guard Plugin — scoped Fastify plugin (NOT wrapped with fp()) so its
 * onRequest hook only applies to routes registered inside this scope.
 *
 * Public routes (auth, channels, webhooks, voice, health) are registered
 * OUTSIDE this plugin in server.ts.
 *
 * JWT verification is skipped gracefully when authPlugin is disabled
 * (i.e., JWT_SECRET not set), so tests without auth secrets still work.
 */
export async function jwtGuardPlugin(app: FastifyInstance) {
  // Only add JWT verification hook when jwtVerify is available (authPlugin enabled)
  app.addHook("onRequest", async (request, reply) => {
    // Trust loopback and Docker bridge requests (cron scripts, internal services)
    // Narrower than isInternalRequest — does NOT exempt 10.x.x.x or 192.168.x.x
    if (isLoopbackOrDocker(request)) {
      return;
    }

    if (typeof request.jwtVerify !== "function") {
      if (process.env.NODE_ENV === "production") {
        reply
          .code(503)
          .send({ error: "Authentication not configured — JWT_SECRET is required in production" });
        return;
      }
      // In dev, allow through when JWT_SECRET not set for easier local testing
      return;
    }
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // ── RBAC: enforce role-based access after JWT verification ──
  // Read-only methods (GET, HEAD, OPTIONS) are allowed for all authenticated users.
  // Write methods (POST, PUT, PATCH, DELETE) require editor or admin.
  // Admin-only paths are checked explicitly.
  const ADMIN_ONLY_PREFIXES = ["/api/settings", "/api/database", "/api/autonomy/tiers"];
  const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

  app.addHook("onRequest", async (request, reply) => {
    // Skip for loopback/Docker (already bypassed JWT)
    if (isLoopbackOrDocker(request)) return;

    const user = request.user as { sub?: string; role?: string } | undefined;
    // If no user (dev mode, JWT disabled), skip
    if (!user?.sub) return;

    const role = (user.role ?? "viewer") as AdminRole;

    // Admin-only paths
    if (ADMIN_ONLY_PREFIXES.some((p) => request.url.startsWith(p))) {
      if (role !== "admin") {
        reply.code(403).send({ error: "Forbidden: admin access required" });
        return;
      }
    }

    // Write operations require editor or admin
    if (!READ_METHODS.has(request.method)) {
      if (role === "viewer") {
        reply.code(403).send({ error: "Forbidden: viewer role has read-only access" });
        return;
      }
    }
  });

  // Workspace context — resolves request.workspaceId from header or default
  app.register(workspaceContextPlugin);

  // All protected API routes go inside this scoped plugin
  app.register(workspaceTenantRoutes, { prefix: "/api/workspaces" });
  app.register(agentRoutes, { prefix: "/api/agents" });
  app.register(goalRoutes, { prefix: "/api/goals" });
  app.register(taskRoutes, { prefix: "/api/tasks" });
  app.register(approvalRoutes, { prefix: "/api/approvals" });
  app.register(memoryRoutes, { prefix: "/api/memories" });
  app.register(bridgeRoutes, { prefix: "/api/bridge" });
  app.register(userRoutes, { prefix: "/api/users" });
  app.register(promptRoutes, { prefix: "/api/prompts" });
  app.register(n8nRoutes, { prefix: "/api/n8n" });
  app.register(executionRoutes, { prefix: "/api/goals" });
  app.register(usageRoutes, { prefix: "/api/usage" });
  app.register(eventRoutes, { prefix: "/api/events" });
  app.register(scheduleRoutes, { prefix: "/api/schedules" });
  app.register(workspaceRoutes, { prefix: "/api/workspace" });
  app.register(milestoneRoutes, { prefix: "/api/milestones" });
  app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  app.register(conversationRoutes, { prefix: "/api/conversations" });
  app.register(decisionRoutes, { prefix: "/api/decisions" });
  app.register(queueRoutes, { prefix: "/api/queue" });
  app.register(monitoringRoutes, { prefix: "/api/monitoring" });
  app.register(pipelineRoutes, { prefix: "/api/pipelines" });
  app.register(ragRoutes, { prefix: "/api/rag" });
  app.register(personaRoutes, { prefix: "/api/persona" });
  app.register(reflectionRoutes, { prefix: "/api/reflections" });
  app.register(subagentRoutes, { prefix: "/api/subagents" });
  app.register(agentMessageRoutes, { prefix: "/api/agent-messages" });
  app.register(agentInfoRoutes, { prefix: "/api/agents" });
  app.register(deployRoutes, { prefix: "/api/deploys" });
  app.register(patternRoutes, { prefix: "/api/patterns" });
  app.register(autonomyRoutes, { prefix: "/api/autonomy/tiers" });
  app.register(autonomousRoutes, { prefix: "/api/autonomous" });
  app.register(contextRoutes, { prefix: "/api/context" });
  app.register(journalRoutes, { prefix: "/api/journal" });
  app.register(projectRoutes);
  app.register(pipelineTemplateRoutes, { prefix: "/api/pipeline-templates" });
  app.register(settingsApiRoutes, { prefix: "/api/settings" });
  app.register(databaseRoutes, { prefix: "/api/database" });
  app.register(gmailRoutes, { prefix: "/api/gmail" });
  app.register(calendarRoutes, { prefix: "/api/calendar" });
  app.register(briefingRoutes, { prefix: "/api/briefings" });
  app.register(followUpRoutes, { prefix: "/api/follow-ups" });
  app.register(thinkingRoutes, { prefix: "/api/thinking" });
  app.register(searchRoutes, { prefix: "/api/search" });
  app.register(workSessionRoutes, { prefix: "/api/work-sessions" });
  app.register(routingRoutes, { prefix: "/api/analytics/routing" });
  app.register(routingStatsRoutes, { prefix: "/api/routing" });
  app.register(selfHealingRoutes, { prefix: "/api/self-healing" });
  app.register(productivityRoutes, { prefix: "/api/productivity" });
  app.register(codebaseRoutes, { prefix: "/api/codebase" });
}
