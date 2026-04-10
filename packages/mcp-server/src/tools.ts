import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "@ai-cofounder/api-client";
import {
  formatDashboard,
  formatMonitoring,
  formatQueues,
  formatGoals,
  formatGoal,
  formatBriefing,
  formatPipelines,
  formatMemories,
  formatProviderHealth,
  formatSubagentRun,
  formatSubagentRuns,
  formatApprovals,
  formatBudgetStatus,
  formatErrorSummary,
  formatStandup,
  formatConversations,
  formatSearchResults,
  formatFollowUps,
  formatGoalAnalytics,
  formatTasks,
  formatGoalCost,
  formatN8nWorkflows,
  formatDeployments,
  formatCircuitBreaker,
  formatToolStats,
  formatReflections,
  formatJournalEntries,
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
    "save_memory",
    "Save a memory/fact to the Jarvis knowledge base. Use this to share context between Claude Code and Jarvis.",
    {
      userId: z.string().describe("The user ID to save the memory for"),
      category: z.enum(["user_info", "preferences", "projects", "decisions", "goals", "technical", "business", "other"]).describe("Memory category"),
      key: z.string().describe("Unique key for this memory (used for upsert deduplication)"),
      content: z.string().describe("The memory content — a fact, preference, or context to remember"),
      source: z.string().optional().describe("Source identifier (defaults to 'claude-code')"),
    },
    async ({ userId, category, key, content, source }) => {
      try {
        const result = await client.saveMemory({ userId, category, key, content, source });
        return { content: [{ type: "text" as const, text: `Memory saved: [${category}] ${key} (id: ${result.id})` }] };
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

  server.tool(
    "delete_goal",
    "Delete a goal by ID",
    {
      id: z.string().describe("The goal ID to delete"),
    },
    async ({ id }) => {
      try {
        await client.deleteGoal(id);
        return { content: [{ type: "text" as const, text: `Goal ${id} deleted.` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "cancel_goal",
    "Cancel a goal by ID (sets status to cancelled)",
    {
      id: z.string().describe("The goal ID to cancel"),
    },
    async ({ id }) => {
      try {
        const goal = await client.cancelGoal(id);
        return {
          content: [{
            type: "text" as const,
            text: `Goal cancelled: **${goal.title}** [${goal.status}] (${goal.id})`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "delete_conversation",
    "Delete a conversation by ID",
    {
      id: z.string().describe("The conversation ID to delete"),
    },
    async ({ id }) => {
      try {
        await client.deleteConversation(id);
        return { content: [{ type: "text" as const, text: `Conversation ${id} deleted.` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "spawn_subagent",
    "Spawn an autonomous subagent to handle a task with its own tool loop",
    {
      title: z.string().describe("Short title for the subagent task"),
      instruction: z.string().describe("Detailed instruction for the subagent"),
      conversationId: z.string().optional().describe("Conversation ID for context"),
      goalId: z.string().optional().describe("Goal ID to associate with"),
      userId: z.string().optional().describe("User ID"),
      priority: z.enum(["critical", "high", "normal", "low"]).optional().describe("Queue priority"),
    },
    async ({ title, instruction, conversationId, goalId, userId, priority }) => {
      try {
        const result = await client.spawnSubagent({ title, instruction, conversationId, goalId, userId, priority });
        return {
          content: [{
            type: "text" as const,
            text: `Subagent spawned: **${result.title}** [${result.status}] (${result.subagentRunId})`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_subagent",
    "Get status and output of a subagent run",
    {
      id: z.string().describe("The subagent run ID"),
    },
    async ({ id }) => {
      try {
        const run = await client.getSubagentRun(id);
        return { content: [{ type: "text" as const, text: formatSubagentRun(run) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_subagents",
    "List subagent runs, optionally filtered by goal or status",
    {
      goalId: z.string().optional().describe("Filter by goal ID"),
      status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional().describe("Filter by status"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ goalId, status, limit }) => {
      try {
        const data = await client.listSubagentRuns({ goalId, status, limit: limit ?? 20 });
        return { content: [{ type: "text" as const, text: formatSubagentRuns(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_goal",
    "Get full details of a goal by ID",
    {
      id: z.string().describe("The goal ID"),
    },
    async ({ id }) => {
      try {
        const data = await client.getGoal(id);
        return { content: [{ type: "text" as const, text: formatGoal(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_pending_approvals",
    "List approvals awaiting human decision",
    {
      limit: z.number().optional().describe("Max results (default 50)"),
    },
    async ({ limit }) => {
      try {
        const data = await client.listPendingApprovals(limit ?? 50);
        return { content: [{ type: "text" as const, text: formatApprovals(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "resolve_approval",
    "Approve or reject a pending approval",
    {
      id: z.string().describe("The approval ID"),
      status: z.enum(["approved", "rejected"]).describe("Decision"),
      decision: z.string().describe("Reason for the decision"),
      decidedBy: z.string().optional().describe("Who made the decision"),
    },
    async ({ id, status, decision, decidedBy }) => {
      try {
        const a = await client.resolveApproval(id, { status, decision, decidedBy });
        return {
          content: [{
            type: "text" as const,
            text: `Approval ${a.id} ${a.status}: ${a.decision}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_budget_status",
    "Get daily and weekly spend vs budget limits",
    {},
    async () => {
      try {
        const data = await client.getBudgetStatus();
        return { content: [{ type: "text" as const, text: formatBudgetStatus(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_error_summary",
    "Get tool error summary for the past N hours",
    {
      hours: z.number().optional().describe("Hours to look back (default 24)"),
    },
    async ({ hours }) => {
      try {
        const data = await client.getErrorSummary(hours ?? 24);
        return { content: [{ type: "text" as const, text: formatErrorSummary(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_standup",
    "Get daily standup narrative and metrics for a date",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
    },
    async ({ date }) => {
      try {
        const data = await client.getStandup(date);
        return { content: [{ type: "text" as const, text: formatStandup(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_conversations",
    "List conversations for a user",
    {
      userId: z.string().describe("The user ID"),
      limit: z.number().optional().describe("Max results (default 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ userId, limit, offset }) => {
      try {
        const data = await client.listConversations(userId, { limit: limit ?? 20, offset });
        return { content: [{ type: "text" as const, text: formatConversations(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "global_search",
    "Search across goals, tasks, conversations, and memories",
    {
      q: z.string().describe("Search query"),
    },
    async ({ q }) => {
      try {
        const data = await client.globalSearch(q);
        return { content: [{ type: "text" as const, text: formatSearchResults(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_follow_ups",
    "List follow-up action items by status",
    {
      status: z.enum(["pending", "done", "dismissed"]).optional().describe("Filter by status"),
      limit: z.number().optional().describe("Max results (default 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async ({ status, limit, offset }) => {
      try {
        const data = await client.listFollowUps({ status, limit: limit ?? 20, offset });
        return { content: [{ type: "text" as const, text: formatFollowUps(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_goal_analytics",
    "Get aggregate goal analytics: completion rates, task success, agent performance",
    {},
    async () => {
      try {
        const data = await client.getGoalAnalytics();
        return { content: [{ type: "text" as const, text: formatGoalAnalytics(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_tasks",
    "List tasks for a goal",
    {
      goalId: z.string().describe("The goal ID"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ goalId, limit }) => {
      try {
        const data = await client.listTasks(goalId, { limit: limit ?? 20 });
        return { content: [{ type: "text" as const, text: formatTasks(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_cost_by_goal",
    "Get cost breakdown for a specific goal",
    {
      goalId: z.string().describe("The goal ID"),
    },
    async ({ goalId }) => {
      try {
        const data = await client.getCostByGoal(goalId);
        return { content: [{ type: "text" as const, text: formatGoalCost(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_n8n_workflows",
    "List available n8n automation workflows",
    {},
    async () => {
      try {
        const data = await client.listN8nWorkflows();
        return { content: [{ type: "text" as const, text: formatN8nWorkflows(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_deployments",
    "List recent deployments",
    {
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ limit }) => {
      try {
        const data = await client.listDeployments(limit ?? 20);
        return { content: [{ type: "text" as const, text: formatDeployments(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_circuit_breaker_status",
    "Get deploy circuit breaker status (paused/active, failure count)",
    {},
    async () => {
      try {
        const data = await client.getCircuitBreakerStatus();
        return { content: [{ type: "text" as const, text: formatCircuitBreaker(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "rag_search",
    "Semantic search over the knowledge base",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 5)"),
    },
    async ({ query, limit }) => {
      try {
        const data = await client.ragSearch(query, { limit: limit ?? 5 });
        if (data.results.length === 0) return { content: [{ type: "text" as const, text: "No RAG results found." }] };
        const lines = data.results.map((r, i) => `${i + 1}. ${JSON.stringify(r).slice(0, 200)}`);
        return { content: [{ type: "text" as const, text: `# RAG Results (${data.results.length})\n\n${lines.join("\n")}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "get_tool_stats",
    "Get tool execution stats: success rates, latency, call counts",
    {},
    async () => {
      try {
        const data = await client.getToolStats();
        return { content: [{ type: "text" as const, text: formatToolStats(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "export_conversation",
    "Export a conversation as JSON",
    {
      id: z.string().describe("The conversation ID"),
    },
    async ({ id }) => {
      try {
        const data = await client.exportConversation(id);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_reflections",
    "List goal completion reflections and lessons learned",
    {
      type: z.string().optional().describe("Filter by type (e.g. goal_completion, failure_analysis)"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ type, limit }) => {
      try {
        const data = await client.listReflections({ type, limit: limit ?? 10 });
        return { content: [{ type: "text" as const, text: formatReflections(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_journal_entries",
    "List journal entries (activity log: goals, tasks, deploys, git commits)",
    {
      goalId: z.string().optional().describe("Filter by goal ID"),
      entryType: z.string().optional().describe("Filter by type (goal_started, task_completed, deployment, etc.)"),
      search: z.string().optional().describe("Full-text search"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ goalId, entryType, search, limit }) => {
      try {
        const data = await client.listJournalEntries({ goalId, entryType, search, limit: limit ?? 20 });
        return { content: [{ type: "text" as const, text: formatJournalEntries(data) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // ── Vault Tools ──

  server.tool(
    "read_vault_daily",
    "Read a Jarvis daily note from the Obsidian vault. Returns goals, journal entries, and memories for that day.",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
    },
    async ({ date }) => {
      try {
        const d = date ?? new Date().toISOString().slice(0, 10);
        const data = await client.getVaultDailyNote(d);
        return { content: [{ type: "text" as const, text: data.content }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_vault_notes",
    "List available daily notes or files in a vault section (projects, decisions, people)",
    {
      section: z.enum(["daily", "projects", "decisions", "people"]).describe("Vault section to list"),
    },
    async ({ section }) => {
      try {
        if (section === "daily") {
          const data = await client.listVaultDailyNotes();
          return { content: [{ type: "text" as const, text: `Daily notes: ${data.dates.join(", ") || "(none)"}` }] };
        }
        const data = await client.listVaultFiles(section);
        return { content: [{ type: "text" as const, text: `${section}: ${data.files.join(", ") || "(none)"}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "read_vault_file",
    "Read a specific file from the Jarvis vault (project notes, decision records, etc.)",
    {
      section: z.enum(["projects", "decisions", "people"]).describe("Vault section"),
      slug: z.string().describe("File slug (filename without .md extension)"),
    },
    async ({ section, slug }) => {
      try {
        const data = await client.getVaultFile(section, slug);
        return { content: [{ type: "text" as const, text: data.content }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
