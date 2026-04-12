import type { LlmTool } from "@ai-cofounder/llm";
import type { AutonomyTierService } from "../../services/autonomy-tier.js";
import type { ToolExecutorServices } from "./types.js";
import { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } from "../tools/memory-tools.js";
import { SEARCH_WEB_TOOL } from "../tools/web-search.js";
import { BROWSE_WEB_TOOL } from "../tools/browse-web.js";
import {
  TRIGGER_N8N_WORKFLOW_TOOL,
  LIST_N8N_WORKFLOWS_TOOL,
  LIST_N8N_API_WORKFLOWS_TOOL,
  LIST_N8N_EXECUTIONS_TOOL,
  TOGGLE_N8N_WORKFLOW_TOOL,
} from "../tools/n8n-tools.js";
import { EXECUTE_CODE_TOOL } from "../tools/sandbox-tools.js";
import {
  CREATE_SCHEDULE_TOOL,
  LIST_SCHEDULES_TOOL,
  DELETE_SCHEDULE_TOOL,
} from "../tools/schedule-tools.js";
import { REMIND_ME_TOOL } from "../tools/reminder-tools.js";
import {
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  DELETE_FILE_TOOL,
  DELETE_DIRECTORY_TOOL,
} from "../tools/filesystem-tools.js";
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
} from "../tools/git-tools.js";
import { RUN_TESTS_TOOL } from "../tools/workspace-tools.js";
import { CREATE_PR_TOOL } from "../tools/github-tools.js";
import {
  SEND_MESSAGE_TOOL,
  CHECK_MESSAGES_TOOL,
  BROADCAST_UPDATE_TOOL,
} from "../tools/messaging-tools.js";
import {
  REGISTER_PROJECT_TOOL,
  SWITCH_PROJECT_TOOL,
  LIST_PROJECTS_TOOL,
  ANALYZE_CROSS_PROJECT_IMPACT_TOOL,
} from "../tools/project-tools.js";
import { QUERY_VPS_TOOL } from "../tools/vps-tools.js";
import { CREATE_FOLLOW_UP_TOOL } from "../tools/follow-up-tools.js";
import { LOG_PRODUCTIVITY_TOOL } from "../tools/productivity-tools.js";
import { QUERY_DATABASE_TOOL } from "../tools/database-tools.js";
import { BROWSER_ACTION_TOOL } from "../tools/browser-tools.js";
import { RECALL_EPISODES_TOOL } from "../tools/episodic-tools.js";
import { RECALL_PROCEDURES_TOOL } from "../tools/procedural-tools.js";
import {
  SEARCH_KNOWLEDGE_TOOL,
  INGEST_DOCUMENT_TOOL,
  KNOWLEDGE_STATUS_TOOL,
} from "../tools/knowledge-tools.js";
import { QUERY_ANALYTICS_TOOL } from "../tools/analytics-tools.js";
import {
  LIST_TEMPLATES_TOOL,
  RUN_TEMPLATE_TOOL,
  CREATE_TEMPLATE_TOOL,
} from "../tools/template-tools.js";
import { REVIEW_PR_TOOL } from "../tools/review-tools.js";
import { REGISTER_WEBHOOK_TOOL, LIST_WEBHOOKS_TOOL } from "../tools/webhook-tools.js";
import { READ_DISCORD_MESSAGES_TOOL, LIST_DISCORD_CHANNELS_TOOL } from "../tools/discord-tools.js";
import {
  EXECUTE_VPS_COMMAND_TOOL,
  DOCKER_SERVICE_LOGS_TOOL,
  DOCKER_RESTART_SERVICE_TOOL,
} from "../tools/vps-command-tools.js";
import {
  LIST_EMAILS_TOOL,
  READ_EMAIL_TOOL,
  SEARCH_EMAILS_TOOL,
  DRAFT_REPLY_TOOL,
  SEND_EMAIL_TOOL,
} from "../tools/gmail-tools.js";
import {
  LIST_CALENDAR_EVENTS_TOOL,
  GET_CALENDAR_EVENT_TOOL,
  SEARCH_CALENDAR_EVENTS_TOOL,
  GET_FREE_BUSY_TOOL,
  CREATE_CALENDAR_EVENT_TOOL,
  UPDATE_CALENDAR_EVENT_TOOL,
  DELETE_CALENDAR_EVENT_TOOL,
  RESPOND_TO_CALENDAR_EVENT_TOOL,
} from "../tools/calendar-tools.js";

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
    : redTierExclude.size > 0
      ? redTierExclude
      : undefined;
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
    add(REMIND_ME_TOOL);
    add(QUERY_DATABASE_TOOL);
    add(CREATE_FOLLOW_UP_TOOL);
    add(LOG_PRODUCTIVITY_TOOL);
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
