// Shared tool executor used by both Orchestrator and SubagentRunner.
// Extracted from the orchestrator's executeToolInner() to avoid duplication.

import type { LlmTool, LlmToolUseContent, EmbeddingService } from "@ai-cofounder/llm";
import type { BrowserActionInput } from "../services/browser.js";
import type { Db } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { retrieve, formatContext } from "@ai-cofounder/rag";
import {
  saveMemory,
  recallMemories,
  searchMemoriesByVector,
  createApproval,
  getApproval,
  resolveApproval,
  getN8nWorkflowByName,
  listN8nWorkflows,
  saveCodeExecution,
  createSchedule,
  listSchedules,
  deleteSchedule,
  touchMemory,
  createFollowUp,
  getChunkCount,
  listIngestionStates,
  getToolStats,
  getProviderHealthRecords,
  getUsageSummary,
  getCostByDay,
  listPipelineTemplates,
  getPipelineTemplateByName,
  createPipelineTemplate,
} from "@ai-cofounder/db";
import type { AutonomyTierService } from "../services/autonomy-tier.js";
import type { ProjectRegistryService } from "../services/project-registry.js";
import type { MonitoringService } from "../services/monitoring.js";
import { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } from "./tools/memory-tools.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "./tools/web-search.js";
import { BROWSE_WEB_TOOL, executeBrowseWeb } from "./tools/browse-web.js";
import { TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL, LIST_N8N_API_WORKFLOWS_TOOL, LIST_N8N_EXECUTIONS_TOOL, TOGGLE_N8N_WORKFLOW_TOOL } from "./tools/n8n-tools.js";
import { EXECUTE_CODE_TOOL } from "./tools/sandbox-tools.js";
import {
  CREATE_SCHEDULE_TOOL,
  LIST_SCHEDULES_TOOL,
  DELETE_SCHEDULE_TOOL,
} from "./tools/schedule-tools.js";
import {
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  DELETE_FILE_TOOL,
  DELETE_DIRECTORY_TOOL,
} from "./tools/filesystem-tools.js";
import {
  GIT_CLONE_TOOL,
  GIT_STATUS_TOOL,
  GIT_DIFF_TOOL,
  GIT_ADD_TOOL,
  GIT_COMMIT_TOOL,
  GIT_PULL_TOOL,
  GIT_LOG_TOOL,
  GIT_BRANCH_TOOL,
  GIT_CHECKOUT_TOOL,
  GIT_PUSH_TOOL,
} from "./tools/git-tools.js";
import { RUN_TESTS_TOOL } from "./tools/workspace-tools.js";
import { CREATE_PR_TOOL, executeCreatePr } from "./tools/github-tools.js";
import type { CreatePrInput } from "./tools/github-tools.js";
import {
  SEND_MESSAGE_TOOL,
  CHECK_MESSAGES_TOOL,
  BROADCAST_UPDATE_TOOL,
} from "./tools/messaging-tools.js";
import {
  REGISTER_PROJECT_TOOL,
  SWITCH_PROJECT_TOOL,
  LIST_PROJECTS_TOOL,
  ANALYZE_CROSS_PROJECT_IMPACT_TOOL,
} from "./tools/project-tools.js";
import { QUERY_VPS_TOOL } from "./tools/vps-tools.js";
import { CREATE_FOLLOW_UP_TOOL } from "./tools/follow-up-tools.js";
import { QUERY_DATABASE_TOOL, executeQueryDatabase } from "./tools/database-tools.js";
import { BROWSER_ACTION_TOOL } from "./tools/browser-tools.js";
import { RECALL_EPISODES_TOOL } from "./tools/episodic-tools.js";
import { RECALL_PROCEDURES_TOOL } from "./tools/procedural-tools.js";
import {
  SEARCH_KNOWLEDGE_TOOL,
  INGEST_DOCUMENT_TOOL,
  KNOWLEDGE_STATUS_TOOL,
} from "./tools/knowledge-tools.js";
import { QUERY_ANALYTICS_TOOL } from "./tools/analytics-tools.js";
import {
  LIST_TEMPLATES_TOOL,
  RUN_TEMPLATE_TOOL,
  CREATE_TEMPLATE_TOOL,
} from "./tools/template-tools.js";
import { REVIEW_PR_TOOL } from "./tools/review-tools.js";
import { REGISTER_WEBHOOK_TOOL, LIST_WEBHOOKS_TOOL } from "./tools/webhook-tools.js";
import { READ_DISCORD_MESSAGES_TOOL, LIST_DISCORD_CHANNELS_TOOL } from "./tools/discord-tools.js";
import { EXECUTE_VPS_COMMAND_TOOL, DOCKER_SERVICE_LOGS_TOOL, DOCKER_RESTART_SERVICE_TOOL } from "./tools/vps-command-tools.js";
import type { VpsCommandService } from "../services/vps-command.js";
import type { PrReviewService } from "../services/pr-review.js";
import type { OutboundWebhookService } from "../services/outbound-webhooks.js";
import type { ConversationBranchingService } from "../services/conversation-branching.js";
import type { EpisodicMemoryService } from "../services/episodic-memory.js";
import type { ProceduralMemoryService } from "../services/procedural-memory.js";
import {
  LIST_EMAILS_TOOL,
  READ_EMAIL_TOOL,
  SEARCH_EMAILS_TOOL,
  DRAFT_REPLY_TOOL,
  SEND_EMAIL_TOOL,
} from "./tools/gmail-tools.js";
import {
  LIST_CALENDAR_EVENTS_TOOL,
  GET_CALENDAR_EVENT_TOOL,
  SEARCH_CALENDAR_EVENTS_TOOL,
  GET_FREE_BUSY_TOOL,
  CREATE_CALENDAR_EVENT_TOOL,
  UPDATE_CALENDAR_EVENT_TOOL,
  DELETE_CALENDAR_EVENT_TOOL,
  RESPOND_TO_CALENDAR_EVENT_TOOL,
} from "./tools/calendar-tools.js";
import { GmailService } from "../services/gmail.js";
import { CalendarService } from "../services/calendar.js";
import {
  createRegisteredProject,
  getRegisteredProjectByName,
  updateConversationMetadata,
  listProjectDependencies,
  getRegisteredProjectById,
} from "@ai-cofounder/db";
import type { AgentMessagingService } from "../services/agent-messaging.js";
import type { N8nService } from "../services/n8n.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { BrowserService } from "../services/browser.js";
import type { DiscordService } from "../services/discord.js";
import { notifyApprovalCreated } from "../services/notifications.js";

const logger = createLogger("tool-executor");

export interface ToolExecutorServices {
  db?: Db;
  embeddingService?: EmbeddingService;
  n8nService?: N8nService;
  sandboxService?: SandboxService;
  workspaceService?: WorkspaceService;
  messagingService?: AgentMessagingService;
  autonomyTierService?: AutonomyTierService;
  projectRegistryService?: ProjectRegistryService;
  monitoringService?: MonitoringService;
  browserService?: BrowserService;
  gmailService?: GmailService;
  calendarService?: CalendarService;
  episodicMemoryService?: EpisodicMemoryService;
  proceduralMemoryService?: ProceduralMemoryService;
  prReviewService?: PrReviewService;
  outboundWebhookService?: OutboundWebhookService;
  conversationBranchingService?: ConversationBranchingService;
  discordService?: DiscordService;
  vpsCommandService?: VpsCommandService;
}

export interface ToolExecutorContext {
  conversationId: string;
  userId?: string;
  agentRole?: string;
  agentRunId?: string;
  goalId?: string;
  isAutonomous?: boolean;
}

/**
 * Builds the full shared tool list based on available services.
 * Used by both Orchestrator and SubagentRunner.
 *
 * @param services - available services
 * @param exclude - tool names to exclude (e.g. delegation tools for subagents)
 * @param tierService - optional AutonomyTierService to exclude red-tier tools
 */
export function buildSharedToolList(
  services: ToolExecutorServices,
  exclude?: Set<string>,
  tierService?: AutonomyTierService,
): LlmTool[] {
  const tools: LlmTool[] = [];
  // Compute the effective exclude set: user-provided exclusions + red-tier tools
  const redTierExclude = tierService ? new Set(tierService.getAllRed()) : new Set<string>();
  const effectiveExclude = exclude
    ? new Set([...exclude, ...redTierExclude])
    : redTierExclude.size > 0 ? redTierExclude : undefined;
  const add = (tool: LlmTool) => {
    if (!effectiveExclude?.has(tool.name)) tools.push(tool);
  };

  // Always available
  add(SEARCH_WEB_TOOL);
  add(BROWSE_WEB_TOOL);

  if (services.db) {
    add(SAVE_MEMORY_TOOL);
    add(RECALL_MEMORIES_TOOL);
    add(CREATE_SCHEDULE_TOOL);
    add(LIST_SCHEDULES_TOOL);
    add(DELETE_SCHEDULE_TOOL);
    add(QUERY_DATABASE_TOOL);
    add(CREATE_FOLLOW_UP_TOOL);
  }

  if (services.n8nService && services.db) {
    add(TRIGGER_N8N_WORKFLOW_TOOL);
    add(LIST_N8N_WORKFLOWS_TOOL);
    add(LIST_N8N_API_WORKFLOWS_TOOL);
    add(LIST_N8N_EXECUTIONS_TOOL);
    add(TOGGLE_N8N_WORKFLOW_TOOL);
  }

  if (services.sandboxService?.available) {
    add(EXECUTE_CODE_TOOL);
  }

  if (services.workspaceService) {
    add(READ_FILE_TOOL);
    add(WRITE_FILE_TOOL);
    add(LIST_DIRECTORY_TOOL);
    add(DELETE_FILE_TOOL);
    add(DELETE_DIRECTORY_TOOL);
    add(GIT_CLONE_TOOL);
    add(GIT_STATUS_TOOL);
    add(GIT_DIFF_TOOL);
    add(GIT_ADD_TOOL);
    add(GIT_COMMIT_TOOL);
    add(GIT_PULL_TOOL);
    add(GIT_LOG_TOOL);
    add(GIT_BRANCH_TOOL);
    add(GIT_CHECKOUT_TOOL);
    add(GIT_PUSH_TOOL);
    add(RUN_TESTS_TOOL);
    add(CREATE_PR_TOOL);
  }

  if (services.messagingService) {
    add(SEND_MESSAGE_TOOL);
    add(CHECK_MESSAGES_TOOL);
    add(BROADCAST_UPDATE_TOOL);
  }

  if (services.projectRegistryService && services.db) {
    add(REGISTER_PROJECT_TOOL);
    add(SWITCH_PROJECT_TOOL);
    add(LIST_PROJECTS_TOOL);
    add(ANALYZE_CROSS_PROJECT_IMPACT_TOOL);
  }

  if (services.monitoringService) {
    add(QUERY_VPS_TOOL);
  }

  if (services.browserService?.available) {
    add(BROWSER_ACTION_TOOL);
  }

  if (services.gmailService) {
    add(LIST_EMAILS_TOOL);
    add(READ_EMAIL_TOOL);
    add(SEARCH_EMAILS_TOOL);
    add(DRAFT_REPLY_TOOL);
    add(SEND_EMAIL_TOOL);
  }

  if (services.calendarService) {
    add(LIST_CALENDAR_EVENTS_TOOL);
    add(GET_CALENDAR_EVENT_TOOL);
    add(SEARCH_CALENDAR_EVENTS_TOOL);
    add(GET_FREE_BUSY_TOOL);
    add(CREATE_CALENDAR_EVENT_TOOL);
    add(UPDATE_CALENDAR_EVENT_TOOL);
    add(DELETE_CALENDAR_EVENT_TOOL);
    add(RESPOND_TO_CALENDAR_EVENT_TOOL);
  }

  if (services.episodicMemoryService) {
    add(RECALL_EPISODES_TOOL);
  }

  if (services.proceduralMemoryService) {
    add(RECALL_PROCEDURES_TOOL);
  }

  // Knowledge base tools (require db + embedding)
  if (services.db && services.embeddingService) {
    add(SEARCH_KNOWLEDGE_TOOL);
    add(INGEST_DOCUMENT_TOOL);
    add(KNOWLEDGE_STATUS_TOOL);
  }

  // PR review tool (requires workspace + LLM — PrReviewService wraps both)
  if (services.prReviewService) {
    add(REVIEW_PR_TOOL);
  }

  // Analytics + template tools (requires db)
  if (services.db) {
    add(QUERY_ANALYTICS_TOOL);
    add(LIST_TEMPLATES_TOOL);
    add(RUN_TEMPLATE_TOOL);
    add(CREATE_TEMPLATE_TOOL);
  }

  // Outbound webhook tools
  if (services.outboundWebhookService) {
    add(REGISTER_WEBHOOK_TOOL);
    add(LIST_WEBHOOKS_TOOL);
  }

  // Discord channel reading tools
  if (services.discordService) {
    add(READ_DISCORD_MESSAGES_TOOL);
    add(LIST_DISCORD_CHANNELS_TOOL);
  }

  // VPS command execution tools
  if (services.vpsCommandService) {
    add(EXECUTE_VPS_COMMAND_TOOL);
    add(DOCKER_SERVICE_LOGS_TOOL);
    add(DOCKER_RESTART_SERVICE_TOOL);
  }

  return tools;
}

/**
 * Execute a yellow-tier tool: create approval, notify, poll until resolved or timeout.
 */
async function executeYellowTierTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, autonomyTierService } = services;
  if (!db) return { error: "Database not available for approval workflow" };

  // Autonomous sessions auto-approve most YELLOW tools (human reviews the PR, not the push).
  // Tools that communicate externally on the user's behalf always require approval.
  const ALWAYS_REQUIRE_APPROVAL = new Set(["send_email", "create_calendar_event", "update_calendar_event", "delete_calendar_event", "respond_to_calendar_event"]);
  if (context.isAutonomous && !ALWAYS_REQUIRE_APPROVAL.has(block.name)) {
    logger.info({ toolName: block.name }, "yellow-tier tool auto-approved for autonomous session");
    return executeSharedTool(block, services, context);
  }

  const timeoutMs = autonomyTierService?.getTimeoutMs(block.name) ?? 300_000;
  const reason = `Tool "${block.name}" requires approval before execution (yellow tier). Input: ${JSON.stringify(block.input).slice(0, 200)}`;

  const approval = await createApproval(db, {
    taskId: context.goalId ?? undefined,
    requestedBy: (context.agentRole ?? "orchestrator") as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner",
    reason,
  });

  // Notify via available channels (fire-and-forget)
  notifyApprovalCreated({
    approvalId: approval.id,
    taskId: approval.taskId ?? "ad-hoc",
    reason,
    requestedBy: context.agentRole ?? "orchestrator",
  }).catch(() => {});

  logger.info({ approvalId: approval.id, toolName: block.name, timeoutMs }, "yellow-tier approval requested");

  // Poll until approved/rejected/timeout
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL = 2000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    const current = await getApproval(db, approval.id);
    if (!current) break;

    if (current.status === "approved") {
      logger.info({ approvalId: approval.id, toolName: block.name }, "yellow-tier tool approved, executing");
      return executeSharedTool(block, services, context);
    }

    if (current.status === "rejected") {
      logger.info({ approvalId: approval.id, toolName: block.name }, "yellow-tier tool rejected");
      return { error: `Tool "${block.name}" was rejected by the user. Reason: ${current.decision ?? "No reason provided"}` };
    }
  }

  // Timeout — auto-deny
  await resolveApproval(db, approval.id, "rejected", "Auto-denied: approval timeout exceeded");
  logger.warn({ approvalId: approval.id, toolName: block.name, timeoutMs }, "yellow-tier tool timed out");
  return { error: `Tool "${block.name}" approval timed out after ${Math.round(timeoutMs / 1000)}s. The request has been auto-denied.` };
}

/**
 * Tier-aware tool execution wrapper.
 * - Green: passes directly to executeSharedTool
 * - Yellow: creates approval record, polls until resolved
 * - Red: blocks with error (defense-in-depth even if LLM somehow calls a red tool)
 *
 * Falls through to executeSharedTool when no autonomyTierService is provided (backward compat).
 */
export async function executeWithTierCheck(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { autonomyTierService } = services;

  // Backward compat: no tier service — behave as if all tools are green
  if (!autonomyTierService) {
    return executeSharedTool(block, services, context);
  }

  const tier = autonomyTierService.getTier(block.name);

  if (tier === "red") {
    logger.warn({ toolName: block.name }, "red-tier tool execution blocked");
    return {
      error: `Tool "${block.name}" is in the red tier and cannot be executed. This operation has been blocked for safety.`,
    };
  }

  if (tier === "yellow") {
    return executeYellowTierTool(block, services, context);
  }

  // Green — pass through immediately
  return executeSharedTool(block, services, context);
}

/**
 * Execute a single tool call. Shared between Orchestrator and SubagentRunner.
 * Does NOT handle orchestrator-only tools (create_plan, create_milestone, request_approval,
 * delegate_to_subagent, delegate_parallel, check_subagent).
 */
export async function executeSharedTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, embeddingService, n8nService, sandboxService, workspaceService, messagingService, projectRegistryService, monitoringService, browserService } = services;

  switch (block.name) {
    case "save_memory": {
      if (!context.userId || !db) return { error: "No user context available" };
      const input = block.input as { category: string; key: string; content: string };
      let embedding: number[] | undefined;
      if (embeddingService) {
        try {
          embedding = await embeddingService.embed(`${input.key}: ${input.content}`);
        } catch (err) {
          logger.warn({ err }, "failed to generate embedding for memory");
        }
      }
      const mem = await saveMemory(db, {
        userId: context.userId,
        category: input.category as Parameters<typeof saveMemory>[1]["category"],
        key: input.key,
        content: input.content,
        source: context.conversationId,
        agentRole: context.agentRole,
        embedding,
      });
      return { saved: true, key: mem.key, category: mem.category };
    }

    case "recall_memories": {
      if (!context.userId || !db) return { error: "No user context available" };
      const input = block.input as { category?: string; query?: string; scope?: "own" | "all" };

      if (input.query && embeddingService) {
        try {
          const queryEmbedding = await embeddingService.embed(input.query);
          const agentRoleForSearch = input.scope !== "all" ? context.agentRole : undefined;
          const results = await searchMemoriesByVector(db, queryEmbedding, context.userId, 10, agentRoleForSearch);
          if (results.length > 0) {
            for (const m of results) {
              touchMemory(db, m.id).catch(() => {});
            }
            return results.map((m) => ({
              key: m.key,
              category: m.category,
              content: m.content,
              agentRole: m.agent_role,
              updatedAt: m.updated_at,
              distance: m.distance,
            }));
          }
        } catch (err) {
          logger.warn({ err }, "vector search failed, falling back to text search");
        }
      }

      const memories = await recallMemories(db, context.userId, {
        ...input,
        agentRole: context.agentRole,
        scope: input.scope,
      });
      for (const m of memories) {
        touchMemory(db, m.id).catch(() => {});
      }
      const memoryResults = memories.map((m) => ({
        key: m.key,
        category: m.category,
        content: m.content,
        updatedAt: m.updatedAt,
      }));

      let ragContext = "";
      if (input.query && embeddingService) {
        try {
          const chunks = await retrieve(
            db,
            (text) => embeddingService.embed(text),
            input.query,
            { limit: 5 },
          );
          ragContext = formatContext(chunks);
        } catch (err) {
          logger.warn({ err }, "RAG retrieval failed");
        }
      }

      return ragContext ? { memories: memoryResults, ragContext } : memoryResults;
    }

    case "search_web": {
      const input = block.input as { query: string; max_results?: number };
      return executeWebSearch(input.query, input.max_results);
    }

    case "browse_web": {
      const input = block.input as { url: string; max_length?: number };
      return executeBrowseWeb(input.url, input.max_length);
    }

    case "trigger_workflow": {
      if (!n8nService || !db) return { error: "n8n integration not available" };
      const input = block.input as { workflow_name: string; payload: Record<string, unknown> };
      const workflow = await getN8nWorkflowByName(db, input.workflow_name);
      if (!workflow) return { error: `Workflow "${input.workflow_name}" not found` };
      if (workflow.direction === "inbound") {
        return { error: `Workflow "${input.workflow_name}" is inbound-only` };
      }
      return n8nService.trigger(workflow.webhookUrl, workflow.name, input.payload);
    }

    case "list_workflows": {
      if (!db) return { error: "Database not available" };
      const workflows = await listN8nWorkflows(db, "outbound");
      return workflows.map((w) => ({
        name: w.name,
        description: w.description,
        inputSchema: w.inputSchema,
      }));
    }

    case "list_n8n_workflows": {
      if (!n8nService) return { error: "n8n not available" };
      const workflows = await n8nService.listApiWorkflows();
      return { count: workflows.length, workflows: workflows.map((w) => ({ id: w.id, name: w.name, active: w.active })) };
    }

    case "list_n8n_executions": {
      if (!n8nService) return { error: "n8n not available" };
      const { status, limit } = block.input as { status?: string; limit?: number };
      const executions = await n8nService.listExecutions({ status, limit: limit ?? 10 });
      return { count: executions.length, executions: executions.map((e) => ({ id: e.id, workflowId: e.workflowId, status: e.status, mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt })) };
    }

    case "toggle_n8n_workflow": {
      if (!n8nService) return { error: "n8n not available" };
      const { workflow_id, active } = block.input as { workflow_id: string; active: boolean };
      const success = active
        ? await n8nService.activateWorkflow(workflow_id)
        : await n8nService.deactivateWorkflow(workflow_id);
      return { workflow_id, active, success };
    }

    case "create_schedule": {
      if (!db) return { error: "Database not available" };
      const input = block.input as { cron_expression: string; action_prompt: string; description?: string };
      try {
        const { CronExpressionParser } = await import("cron-parser");
        const interval = CronExpressionParser.parse(input.cron_expression);
        const nextRunAt = interval.next().toDate();
        const schedule = await createSchedule(db, {
          cronExpression: input.cron_expression,
          actionPrompt: input.action_prompt,
          description: input.description,
          userId: context.userId,
          enabled: true,
          nextRunAt,
        });
        return {
          scheduleId: schedule.id,
          cronExpression: schedule.cronExpression,
          nextRunAt: nextRunAt.toISOString(),
          message: `Schedule created: ${input.description ?? input.action_prompt}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Invalid cron expression: ${msg}` };
      }
    }

    case "list_schedules": {
      if (!db) return { error: "Database not available" };
      const allSchedules = await listSchedules(db, context.userId);
      return allSchedules.map((s) => ({
        id: s.id,
        cronExpression: s.cronExpression,
        actionPrompt: s.actionPrompt,
        description: s.description,
        enabled: s.enabled,
        lastRunAt: s.lastRunAt,
        nextRunAt: s.nextRunAt,
      }));
    }

    case "delete_schedule": {
      if (!db) return { error: "Database not available" };
      const input = block.input as { schedule_id: string };
      const deleted = await deleteSchedule(db, input.schedule_id);
      if (!deleted) return { error: "Schedule not found" };
      return { deleted: true, scheduleId: input.schedule_id };
    }

    case "execute_code": {
      if (!sandboxService?.available) return { error: "Sandbox execution not available" };
      const input = block.input as { code: string; language: string; timeout_ms?: number; dependencies?: string[] };
      const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 60_000);
      const result = await sandboxService.execute({
        code: input.code,
        language: input.language as "typescript" | "javascript" | "python" | "bash",
        timeoutMs,
        dependencies: input.dependencies,
      });
      // Record sandbox metrics
      try {
        const { recordSandboxMetrics } = await import("../plugins/observability.js");
        recordSandboxMetrics({
          language: result.language,
          success: result.exitCode === 0,
          oomKilled: result.oomKilled,
          timedOut: result.timedOut,
        });
      } catch { /* metrics are best-effort */ }
      if (db) {
        try {
          const { hashCode } = await import("@ai-cofounder/sandbox");
          await saveCodeExecution(db, {
            language: input.language,
            codeHash: hashCode(input.code),
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
          });
        } catch (err) {
          logger.warn({ err }, "failed to persist code execution result");
        }
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        oomKilled: result.oomKilled,
        language: result.language,
      };
    }

    case "read_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string };
      try {
        const content = await workspaceService.readFile(input.path);
        return { path: input.path, content };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "write_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string; content: string };
      try {
        await workspaceService.writeFile(input.path, input.content);
        return { written: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "list_directory": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path?: string };
      try {
        const entries = await workspaceService.listDirectory(input.path);
        return { path: input.path ?? ".", entries };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "delete_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string };
      try {
        await workspaceService.deleteFile(input.path);
        return { deleted: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "delete_directory": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string; force?: boolean };
      try {
        await workspaceService.deleteDirectory(input.path, input.force);
        return { deleted: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "git_clone": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_url: string; directory_name?: string; depth?: number };
      const result = await workspaceService.gitClone(input.repo_url, input.directory_name, input.depth);

      // Auto-ingest project documentation on workspace registration (MEM-03)
      try {
        const { enqueueRagIngestion } = await import("@ai-cofounder/queue");
        const dirName =
          input.directory_name ??
          input.repo_url
            .split("/")
            .pop()
            ?.replace(".git", "") ??
          "repo";
        enqueueRagIngestion({
          action: "ingest_repo",
          sourceId: dirName,
        }).catch(() => {}); // fire-and-forget
      } catch {
        /* non-fatal */
      }

      return { ...result, repoUrl: input.repo_url };
    }

    case "git_status": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string };
      return workspaceService.gitStatus(input.repo_dir);
    }

    case "git_diff": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; staged?: boolean };
      return workspaceService.gitDiff(input.repo_dir, input.staged);
    }

    case "git_add": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; paths: string[] };
      return workspaceService.gitAdd(input.repo_dir, input.paths);
    }

    case "git_commit": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; message: string };
      return workspaceService.gitCommit(input.repo_dir, input.message);
    }

    case "git_pull": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; remote?: string; branch?: string };
      return workspaceService.gitPull(input.repo_dir, input.remote, input.branch);
    }

    case "git_log": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; max_count?: number };
      return workspaceService.gitLog(input.repo_dir, input.max_count);
    }

    case "git_branch": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; name?: string };
      return workspaceService.gitBranch(input.repo_dir, input.name);
    }

    case "git_checkout": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; branch: string; create?: boolean };
      return workspaceService.gitCheckout(input.repo_dir, input.branch, input.create);
    }

    case "git_push": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; remote?: string; branch?: string };
      return workspaceService.gitPush(input.repo_dir, input.remote, input.branch);
    }

    case "run_tests": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; command?: string; timeout_ms?: number };
      return workspaceService.runTests(input.repo_dir, input.command, input.timeout_ms);
    }

    case "create_pr": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as unknown as CreatePrInput;
      return executeCreatePr(input);
    }

    case "send_message": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as {
        target_role: string;
        message_type: "request" | "response" | "notification" | "handoff";
        subject: string;
        body: string;
        in_reply_to?: string;
        correlation_id?: string;
        priority?: "low" | "medium" | "high" | "critical";
      };
      const result = await messagingService.send({
        senderRole: context.agentRole ?? "orchestrator",
        senderRunId: context.agentRunId,
        targetRole: input.target_role,
        messageType: input.message_type,
        subject: input.subject,
        body: input.body,
        inReplyTo: input.in_reply_to,
        correlationId: input.correlation_id,
        priority: input.priority,
        goalId: context.goalId,
        conversationId: context.conversationId,
        metadata: { messageDepth: 0 },
      });
      return {
        sent: true,
        messageId: result.messageId,
        correlationId: result.correlationId,
        message: result.correlationId
          ? `Message sent. Use check_messages with correlation_id="${result.correlationId}" to check for a response.`
          : "Message sent.",
      };
    }

    case "check_messages": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as {
        correlation_id?: string;
        sender_role?: string;
        message_type?: string;
        channel?: string;
        unread_only?: boolean;
      };

      // If checking a broadcast channel
      if (input.channel) {
        const messages = await messagingService.checkBroadcast(input.channel, {
          goalId: context.goalId,
        });
        return {
          channel: input.channel,
          count: messages.length,
          messages: messages.map((m) => ({
            id: m.id,
            senderRole: m.senderRole,
            subject: m.subject,
            body: m.body,
            createdAt: m.createdAt,
          })),
        };
      }

      // Check personal inbox
      const messages = await messagingService.checkInbox({
        targetRole: context.agentRole ?? "orchestrator",
        targetRunId: context.agentRunId,
        correlationId: input.correlation_id,
        senderRole: input.sender_role,
        messageType: input.message_type,
        unreadOnly: input.unread_only,
      });

      return {
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          senderRole: m.senderRole,
          targetRole: m.targetRole,
          messageType: m.messageType,
          subject: m.subject,
          body: m.body,
          correlationId: m.correlationId,
          inReplyTo: m.inReplyTo,
          createdAt: m.createdAt,
        })),
      };
    }

    case "broadcast_update": {
      if (!messagingService) return { error: "Messaging not available" };
      const input = block.input as { channel: string; subject: string; body: string };
      const result = await messagingService.broadcast({
        senderRole: context.agentRole ?? "orchestrator",
        senderRunId: context.agentRunId,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        goalId: context.goalId,
        conversationId: context.conversationId,
      });
      return { broadcast: true, messageId: result.messageId, channel: input.channel };
    }

    case "register_project": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as {
        name: string;
        workspace_path: string;
        repo_url?: string;
        description?: string;
        language?: "typescript" | "python" | "javascript" | "go" | "other";
        test_command?: string;
        default_branch?: string;
      };

      if (!projectRegistryService.validateProjectPath(input.workspace_path)) {
        return { error: `Path "${input.workspace_path}" is outside allowed base directories. Configure PROJECTS_BASE_DIR to allow this path.` };
      }

      const slug = input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const project = await createRegisteredProject(db, {
        name: input.name,
        slug,
        workspacePath: input.workspace_path,
        repoUrl: input.repo_url,
        description: input.description,
        language: input.language ?? "typescript",
        defaultBranch: input.default_branch ?? "main",
        testCommand: input.test_command,
      });

      try {
        await projectRegistryService.registerProject({
          id: project.id,
          name: project.name,
          slug: project.slug,
          workspacePath: project.workspacePath,
          repoUrl: project.repoUrl,
          description: project.description,
          language: project.language ?? "typescript",
          defaultBranch: project.defaultBranch ?? "main",
          testCommand: project.testCommand,
          config: project.config as Record<string, unknown> | null,
        });
      } catch (err) {
        logger.warn({ err, projectId: project.id }, "failed to register project workspace (non-fatal)");
      }

      // Optionally enqueue RAG ingestion (fire-and-forget)
      try {
        const { enqueueRagIngestion } = await import("@ai-cofounder/queue");
        enqueueRagIngestion({ action: "ingest_repo", sourceId: slug }).catch(() => {});
      } catch { /* non-fatal */ }

      return { projectId: project.id, name: project.name, slug, message: `Project "${project.name}" registered successfully. Use switch_project to make it active.` };
    }

    case "switch_project": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as { project_name: string };

      const project = await getRegisteredProjectByName(db, input.project_name);
      if (!project) {
        const available = projectRegistryService.listProjects().map((p) => p.name);
        return { error: `Project "${input.project_name}" not found. Available projects: ${available.join(", ") || "none registered yet"}` };
      }

      await updateConversationMetadata(db, context.conversationId, { activeProjectId: project.id });
      return { switched: true, projectId: project.id, name: project.name, slug: project.slug, message: `Switched to project "${project.name}". RAG retrieval and workspace operations are now scoped to this project.` };
    }

    case "list_projects": {
      if (!projectRegistryService) return { error: "Project registry not available" };
      const projects = projectRegistryService.listProjects();
      return {
        count: projects.length,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          language: p.language,
          workspacePath: p.workspacePath,
          description: p.description,
          defaultBranch: p.defaultBranch,
        })),
      };
    }

    case "analyze_cross_project_impact": {
      if (!projectRegistryService || !db) return { error: "Project registry not available" };
      const input = block.input as { project_name: string; change_description: string };

      const project = await getRegisteredProjectByName(db, input.project_name);
      if (!project) {
        return { error: `Project "${input.project_name}" not found` };
      }

      const deps = await listProjectDependencies(db, project.id);
      const dependencyDetails = await Promise.all(
        deps.map(async (dep) => {
          const targetId = dep.sourceProjectId === project.id ? dep.targetProjectId : dep.sourceProjectId;
          const direction = dep.sourceProjectId === project.id ? "depends_on" : "depended_on_by";
          const targetProject = await getRegisteredProjectById(db, targetId);
          return {
            targetProjectId: targetId,
            targetProjectName: targetProject?.name ?? "unknown",
            direction,
            dependencyType: dep.dependencyType,
            description: dep.description,
          };
        }),
      );

      return {
        project: { id: project.id, name: project.name, slug: project.slug, description: project.description },
        change_description: input.change_description,
        dependency_count: deps.length,
        dependencies: dependencyDetails,
        analysis_note: "Review all 'depended_on_by' projects to assess impact of your change.",
      };
    }

    case "query_database": {
      if (!db) return { error: "Database not available" };
      const input = block.input as { sql: string; limit?: number };
      return executeQueryDatabase(db, input.sql, input.limit);
    }

    case "create_follow_up": {
      if (!db) return { error: "Database not available" };
      const input = block.input as { title: string; description?: string; due_date?: string; source?: string };
      const followUp = await createFollowUp(db, {
        title: input.title,
        description: input.description,
        dueDate: input.due_date ? new Date(input.due_date) : undefined,
        source: input.source,
      });
      return { created: true, followUpId: followUp.id, title: followUp.title };
    }

    case "query_vps": {
      if (!monitoringService) return { error: "Monitoring service not available" };
      const health = await monitoringService.checkVPSHealth();
      if (!health) return { error: "VPS is not configured or health check failed" };
      return health;
    }

    case "browser_action": {
      if (!browserService?.available) return { error: "Browser automation not available" };
      const input = block.input as unknown as BrowserActionInput;
      return browserService.execute(input);
    }

    /* ── Gmail tools ── */

    case "list_emails": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { maxResults } = block.input as { maxResults?: number };
      const emails = await gmail.listInbox(Math.min(maxResults ?? 10, 20));
      return { emails, count: emails.length };
    }

    case "read_email": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { messageId } = block.input as { messageId: string };
      if (!messageId) return { error: "messageId is required" };
      return gmail.getMessage(messageId);
    }

    case "search_emails": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const { query, maxResults } = block.input as { query: string; maxResults?: number };
      if (!query) return { error: "query is required" };
      const emails = await gmail.searchEmails(query, Math.min(maxResults ?? 10, 20));
      return { emails, count: emails.length };
    }

    case "draft_reply": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const input = block.input as { to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string };
      if (!input.to || !input.subject || !input.body) return { error: "to, subject, and body are required" };
      const draft = await gmail.createDraft(input);
      return { success: true, draftId: draft.id };
    }

    case "send_email": {
      if (!db || !context.userId) return { error: "Gmail not connected — no authenticated user" };
      const gmail = services.gmailService ?? new GmailService(db, context.userId);
      const input = block.input as { to: string; subject: string; body: string; cc?: string; threadId?: string };
      if (!input.to || !input.subject || !input.body) return { error: "to, subject, and body are required" };
      const sent = await gmail.sendEmail(input);
      return { success: true, messageId: sent.id, threadId: sent.threadId };
    }

    /* ── Calendar tools ── */

    case "list_calendar_events": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { timeMin, timeMax, maxResults } = block.input as { timeMin?: string; timeMax?: string; maxResults?: number };
      const events = await cal.listEvents({ timeMin, timeMax, maxResults: maxResults ? Math.min(maxResults, 50) : undefined });
      return { events, count: events.length };
    }

    case "get_calendar_event": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId } = block.input as { eventId: string };
      if (!eventId) return { error: "eventId is required" };
      return cal.getEvent(eventId);
    }

    case "search_calendar_events": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { query, maxResults } = block.input as { query: string; maxResults?: number };
      if (!query) return { error: "query is required" };
      const events = await cal.searchEvents(query, Math.min(maxResults ?? 10, 50));
      return { events, count: events.length };
    }

    case "get_free_busy": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { timeMin, timeMax } = block.input as { timeMin: string; timeMax: string };
      if (!timeMin || !timeMax) return { error: "timeMin and timeMax are required" };
      return cal.getFreeBusy(timeMin, timeMax);
    }

    case "create_calendar_event": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const input = block.input as { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[]; timeZone?: string };
      if (!input.summary || !input.start || !input.end) return { error: "summary, start, and end are required" };
      const event = await cal.createEvent(input);
      return { success: true, eventId: event.id, summary: event.summary, htmlLink: event.htmlLink };
    }

    case "update_calendar_event": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId, ...updates } = block.input as { eventId: string; summary?: string; start?: string; end?: string; description?: string; location?: string; attendees?: string[]; timeZone?: string };
      if (!eventId) return { error: "eventId is required" };
      const event = await cal.updateEvent(eventId, updates);
      return { success: true, eventId: event.id, summary: event.summary };
    }

    case "delete_calendar_event": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId } = block.input as { eventId: string };
      if (!eventId) return { error: "eventId is required" };
      await cal.deleteEvent(eventId);
      return { success: true, eventId };
    }

    case "respond_to_calendar_event": {
      if (!db || !context.userId) return { error: "Calendar not connected — no authenticated user" };
      const cal = services.calendarService ?? new CalendarService(db, context.userId);
      const { eventId, responseStatus } = block.input as { eventId: string; responseStatus: "accepted" | "declined" | "tentative" };
      if (!eventId || !responseStatus) return { error: "eventId and responseStatus are required" };
      const event = await cal.respondToEvent(eventId, responseStatus);
      return { success: true, eventId: event.id, responseStatus };
    }

    case "recall_episodes": {
      const { episodicMemoryService } = services;
      if (!episodicMemoryService) return { error: "Episodic memory not available" };
      const { query, limit } = block.input as { query: string; limit?: number };
      const episodes = await episodicMemoryService.recallEpisodes(query, { limit });
      return { episodes, count: episodes.length };
    }

    case "recall_procedures": {
      const { proceduralMemoryService } = services;
      if (!proceduralMemoryService) return { error: "Procedural memory not available" };
      const { query, limit } = block.input as { query: string; limit?: number };
      const procedures = await proceduralMemoryService.findMatchingProcedures(query, limit);
      return { procedures, count: procedures.length };
    }

    /* ── PR review tool ── */

    case "review_pr": {
      if (!services.prReviewService) return { error: "PR review service not available" };
      const { pr_identifier, repo_dir } = block.input as {
        pr_identifier: string;
        repo_dir?: string;
      };
      const result = await services.prReviewService.reviewPr(repo_dir ?? ".", pr_identifier);
      return result;
    }

    /* ── Knowledge base tools ── */

    case "search_knowledge": {
      if (!services.db || !services.embeddingService) return { error: "Knowledge base not available" };
      const { query, limit: kLimit, source_type } = block.input as {
        query: string;
        limit?: number;
        source_type?: string;
      };
      const chunks = await retrieve(services.db, services.embeddingService.embed.bind(services.embeddingService), query, {
        limit: kLimit ?? 5,
        sourceType: source_type as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown" | undefined,
      });
      if (chunks.length === 0) return { results: [], message: "No matching documents found." };
      return {
        results: chunks.map((c) => ({
          content: c.content.slice(0, 500),
          source_type: c.sourceType,
          source_id: c.sourceId,
          score: c.score,
        })),
        count: chunks.length,
      };
    }

    case "ingest_document": {
      if (!services.db || !services.embeddingService) return { error: "Knowledge base not available" };
      const { content, source_id, source_type } = block.input as {
        content: string;
        source_id: string;
        source_type?: string;
      };
      const { ingestText } = await import("@ai-cofounder/rag");
      const result = await ingestText(
        services.db,
        services.embeddingService.embed.bind(services.embeddingService),
        (source_type ?? "markdown") as "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown",
        source_id,
        content,
      );
      return { ingested: true, source_id, chunks_created: result.chunksCreated };
    }

    case "knowledge_status": {
      if (!services.db) return { error: "Database not available" };
      const [chunkCount, ingestions] = await Promise.all([
        getChunkCount(services.db),
        listIngestionStates(services.db),
      ]);
      return {
        total_chunks: chunkCount,
        ingestions: ingestions.map((i) => ({
          source_type: i.sourceType,
          source_id: i.sourceId,
          chunk_count: i.chunkCount,
          last_ingested: i.lastIngestedAt,
        })),
        ingestion_count: ingestions.length,
      };
    }

    /* ── Analytics tool ── */

    case "query_analytics": {
      if (!services.db) return { error: "Database not available" };
      const { metric, time_range } = block.input as {
        metric: string;
        time_range?: string;
      };
      const since = new Date();
      if (time_range === "today") {
        since.setHours(0, 0, 0, 0);
      } else if (time_range === "month") {
        since.setDate(since.getDate() - 30);
      } else {
        since.setDate(since.getDate() - 7); // default: week
      }

      switch (metric) {
        case "cost_summary": {
          const usage = await getUsageSummary(services.db, { since });
          const costSince = new Date();
          costSince.setDate(costSince.getDate() - 7);
          const daily = await getCostByDay(services.db, costSince);
          return { ...usage, daily_breakdown: daily, period: time_range ?? "week" };
        }
        case "tool_performance": {
          const stats = await getToolStats(services.db);
          return { tools: stats, period: time_range ?? "week" };
        }
        case "provider_health": {
          const health = await getProviderHealthRecords(services.db);
          return { providers: health };
        }
        case "usage_trend": {
          const trendSince = new Date();
          trendSince.setDate(trendSince.getDate() - (time_range === "month" ? 30 : 7));
          const daily = await getCostByDay(services.db, trendSince);
          return { daily, period: time_range ?? "week" };
        }
        case "error_rate": {
          const stats = await getToolStats(services.db);
          const withErrors = stats.filter((s) => s.errorCount > 0);
          return { tools_with_errors: withErrors, total_tools_tracked: stats.length };
        }
        default:
          return { error: `Unknown metric: ${metric}` };
      }
    }

    /* ── Template tools ── */

    case "list_templates": {
      if (!services.db) return { error: "Database not available" };
      const templates = await listPipelineTemplates(services.db);
      return {
        templates: templates.map((t) => ({
          name: t.name,
          stages: t.stages,
          created_at: t.createdAt,
        })),
        count: templates.length,
      };
    }

    case "run_template": {
      if (!services.db) return { error: "Database not available" };
      const { template_name, context: templateCtx } = block.input as {
        template_name: string;
        context?: Record<string, unknown>;
      };
      const template = await getPipelineTemplateByName(services.db, template_name);
      if (!template) return { error: `Template "${template_name}" not found` };
      const { enqueuePipeline } = await import("@ai-cofounder/queue");
      const stages = (template.stages as Array<{ agent: string; prompt: string; dependsOnPrevious?: boolean }>).map((s) => ({
        agent: s.agent as "researcher" | "coder" | "reviewer" | "planner",
        prompt: s.prompt,
        dependsOnPrevious: s.dependsOnPrevious ?? false,
      }));
      const pipelineId = await enqueuePipeline({
        goalId: context.goalId ?? context.conversationId,
        stages,
        context: templateCtx,
      });
      return { started: true, pipeline_id: pipelineId, template_name, stages: stages.length };
    }

    case "create_template": {
      if (!services.db) return { error: "Database not available" };
      const { name, stages, default_context } = block.input as {
        name: string;
        stages: Array<{ agent: string; prompt: string; depends_on_previous?: boolean }>;
        default_context?: Record<string, unknown>;
      };
      const pipelineStages = stages.map((s) => ({
        agent: s.agent,
        prompt: s.prompt,
        dependsOnPrevious: s.depends_on_previous ?? false,
      }));
      const created = await createPipelineTemplate(services.db, {
        name,
        stages: pipelineStages,
        defaultContext: default_context ?? {},
      });
      return { created: true, name: created.name };
    }

    /* ── Webhook tools ── */

    case "register_webhook": {
      if (!services.outboundWebhookService) return { error: "Webhook service not available" };
      const { url, event_types, description, headers } = block.input as {
        url: string; event_types: string[]; description?: string; headers?: Record<string, string>;
      };
      const webhook = await services.outboundWebhookService.register(url, event_types, headers, description);
      return { registered: true, id: webhook.id, url, event_types };
    }

    case "list_webhooks": {
      if (!services.outboundWebhookService) return { error: "Webhook service not available" };
      const webhooks = await services.outboundWebhookService.list();
      return {
        webhooks: webhooks.map((w) => ({
          id: w.id, url: w.url, event_types: w.eventTypes, description: w.description,
        })),
        count: webhooks.length,
      };
    }

    /* ── Conversation branching ── */

    case "branch_conversation": {
      if (!services.conversationBranchingService) return { error: "Branching not available" };
      const { branch_point_message_id } = block.input as { branch_point_message_id?: string };
      if (!context.userId) return { error: "User ID required for branching" };
      const result = await services.conversationBranchingService.branch(
        context.conversationId, context.userId, branch_point_message_id,
      );
      return { branched: true, new_conversation_id: result.id, messages_copied: result.messagesCopied };
    }

    /* ── VPS command execution ── */

    case "execute_vps_command": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { command, timeout_seconds } = block.input as { command: string; timeout_seconds?: number };
      return services.vpsCommandService.execute(command, { timeoutSeconds: timeout_seconds });
    }

    case "docker_service_logs": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { service, lines } = block.input as { service: string; lines?: number };
      const logs = await services.vpsCommandService.getServiceLogs(service, Math.min(lines ?? 50, 200));
      return { service, logs };
    }

    case "docker_restart_service": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { service, compose_file } = block.input as { service: string; compose_file?: string };
      return services.vpsCommandService.restartService(service, compose_file);
    }

    /* ── Discord channel reading ── */

    case "read_discord_messages": {
      if (!services.discordService) return { error: "Discord integration not available" };
      const { channel_id, limit } = block.input as { channel_id: string; limit?: number };
      const messages = await services.discordService.fetchMessages(channel_id, { limit });
      return { channel_id, count: messages.length, messages };
    }

    case "list_discord_channels": {
      if (!services.discordService) return { error: "Discord integration not available" };
      const { guild_id } = block.input as { guild_id?: string };
      const channels = await services.discordService.fetchChannels(guild_id);
      return { count: channels.length, channels };
    }

    default:
      return null; // Unknown tool — caller handles
  }
}
