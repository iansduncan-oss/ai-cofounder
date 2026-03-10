import type { FastifyInstance } from "fastify";
import { agentRoutes } from "../routes/agents.js";
import { goalRoutes } from "../routes/goals.js";
import { taskRoutes } from "../routes/tasks.js";
import { approvalRoutes } from "../routes/approvals.js";
import { memoryRoutes } from "../routes/memories.js";
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
    if (typeof request.jwtVerify !== "function") {
      if (process.env.NODE_ENV === "production") {
        reply.code(503).send({ error: "Authentication not configured — JWT_SECRET is required in production" });
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

  // All protected API routes go inside this scoped plugin
  app.register(agentRoutes, { prefix: "/api/agents" });
  app.register(goalRoutes, { prefix: "/api/goals" });
  app.register(taskRoutes, { prefix: "/api/tasks" });
  app.register(approvalRoutes, { prefix: "/api/approvals" });
  app.register(memoryRoutes, { prefix: "/api/memories" });
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
}
