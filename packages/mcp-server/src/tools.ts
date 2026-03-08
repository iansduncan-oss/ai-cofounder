import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "@ai-cofounder/api-client";
import {
  formatDashboard,
  formatMonitoring,
  formatQueues,
  formatGoals,
  formatBriefing,
  formatPipelines,
  formatMemories,
  formatProviderHealth,
} from "./formatters.js";

export function registerTools(server: McpServer, client: ApiClient): void {
  server.tool(
    "ask_agent",
    "Send a message to the AI Cofounder orchestrator agent and get a response",
    {
      message: z.string().describe("The message to send to the agent"),
      conversationId: z.string().optional().describe("Conversation ID to continue"),
      userId: z.string().optional().describe("User ID"),
    },
    async ({ message, conversationId, userId }) => {
      try {
        const result = await client.runAgent({ message, conversationId, userId });
        return {
          content: [{
            type: "text" as const,
            text: `**${result.agentRole}** (${result.model}):\n\n${result.response}\n\nConversation: ${result.conversationId}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_dashboard",
    "Get AI Cofounder dashboard summary: goals, tasks, costs, events",
    {},
    async () => {
      try {
        const data = await client.getDashboardSummary();
        return { content: [{ type: "text" as const, text: formatDashboard(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_monitoring",
    "Get monitoring status: GitHub CI, VPS health, open PRs, alerts",
    {},
    async () => {
      try {
        const data = await client.getMonitoringStatus();
        return { content: [{ type: "text" as const, text: formatMonitoring(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_queue_status",
    "Get BullMQ queue health: waiting, active, completed, failed jobs",
    {},
    async () => {
      try {
        const data = await client.getQueueStatus();
        return { content: [{ type: "text" as const, text: formatQueues(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_goals",
    "List goals for a conversation",
    {
      conversationId: z.string().describe("The conversation ID to list goals for"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ conversationId, limit }) => {
      try {
        const data = await client.listGoals(conversationId, { limit: limit ?? 20 });
        return { content: [{ type: "text" as const, text: formatGoals(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "create_goal",
    "Create a new goal in a conversation",
    {
      conversationId: z.string().describe("The conversation ID"),
      title: z.string().describe("Goal title"),
      description: z.string().optional().describe("Goal description"),
      priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Goal priority"),
    },
    async ({ conversationId, title, description, priority }) => {
      try {
        const goal = await client.createGoal({ conversationId, title, description, priority });
        return {
          content: [{
            type: "text" as const,
            text: `Goal created: **${goal.title}** [${goal.status}/${goal.priority}] (${goal.id})`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "execute_goal",
    "Execute a goal via the task dispatcher queue",
    {
      goalId: z.string().describe("The goal ID to execute"),
      userId: z.string().optional().describe("User ID"),
    },
    async ({ goalId, userId }) => {
      try {
        const result = await client.executeGoal(goalId, { userId });
        return {
          content: [{
            type: "text" as const,
            text: `Executing goal: **${result.goalTitle}** (${result.totalTasks} tasks)\nStatus: ${result.status}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_briefing",
    "Get today's daily briefing with goals, tasks, costs summary",
    {},
    async () => {
      try {
        const data = await client.getBriefing();
        return { content: [{ type: "text" as const, text: formatBriefing(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_pipelines",
    "List pipeline runs and their status",
    {},
    async () => {
      try {
        const data = await client.listPipelines();
        return { content: [{ type: "text" as const, text: formatPipelines(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "submit_pipeline",
    "Submit a pipeline for a goal to execute multi-agent stages",
    {
      goalId: z.string().describe("The goal ID to create a pipeline for"),
    },
    async ({ goalId }) => {
      try {
        const result = await client.submitGoalPipeline(goalId);
        return {
          content: [{
            type: "text" as const,
            text: `Pipeline submitted: job ${result.jobId} (${result.stageCount} stages) — ${result.status}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "search_memories",
    "Browse agent memories for a user",
    {
      userId: z.string().describe("The user ID to search memories for"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ userId, limit }) => {
      try {
        const data = await client.listMemories(userId, { limit: limit ?? 20 });
        return { content: [{ type: "text" as const, text: formatMemories(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_provider_health",
    "Get LLM provider health: availability, latency, error rates",
    {},
    async () => {
      try {
        const data = await client.providerHealth();
        return { content: [{ type: "text" as const, text: formatProviderHealth(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
