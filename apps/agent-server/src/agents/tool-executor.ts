// Shared tool executor used by both Orchestrator and SubagentRunner.
// Extracted from the orchestrator's executeToolInner() to avoid duplication.

import type { LlmTool, LlmToolUseContent, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { retrieve, formatContext } from "@ai-cofounder/rag";
import {
  createGoal,
  createTask,
  updateGoalStatus,
  saveMemory,
  recallMemories,
  searchMemoriesByVector,
  createApproval,
  getN8nWorkflowByName,
  listN8nWorkflows,
  saveCodeExecution,
  createSchedule,
  listSchedules,
  deleteSchedule,
  createMilestone,
  touchMemory,
} from "@ai-cofounder/db";
import { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } from "./tools/memory-tools.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "./tools/web-search.js";
import { BROWSE_WEB_TOOL, executeBrowseWeb } from "./tools/browse-web.js";
import { TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL } from "./tools/n8n-tools.js";
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
import type { N8nService } from "../services/n8n.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { notifyApprovalCreated } from "../services/notifications.js";

const logger = createLogger("tool-executor");

export interface ToolExecutorServices {
  db?: Db;
  embeddingService?: EmbeddingService;
  n8nService?: N8nService;
  sandboxService?: SandboxService;
  workspaceService?: WorkspaceService;
}

/**
 * Builds the full shared tool list based on available services.
 * Used by both Orchestrator and SubagentRunner.
 *
 * @param services - available services
 * @param exclude - tool names to exclude (e.g. delegation tools for subagents)
 */
export function buildSharedToolList(
  services: ToolExecutorServices,
  exclude?: Set<string>,
): LlmTool[] {
  const tools: LlmTool[] = [];
  const add = (tool: LlmTool) => {
    if (!exclude?.has(tool.name)) tools.push(tool);
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
  }

  if (services.n8nService && services.db) {
    add(TRIGGER_N8N_WORKFLOW_TOOL);
    add(LIST_N8N_WORKFLOWS_TOOL);
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

  return tools;
}

/**
 * Execute a single tool call. Shared between Orchestrator and SubagentRunner.
 * Does NOT handle orchestrator-only tools (create_plan, create_milestone, request_approval,
 * delegate_to_subagent, delegate_parallel, check_subagent).
 */
export async function executeSharedTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: { conversationId: string; userId?: string },
): Promise<unknown> {
  const { db, embeddingService, n8nService, sandboxService, workspaceService } = services;

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
        embedding,
      });
      return { saved: true, key: mem.key, category: mem.category };
    }

    case "recall_memories": {
      if (!context.userId || !db) return { error: "No user context available" };
      const input = block.input as { category?: string; query?: string };

      if (input.query && embeddingService) {
        try {
          const queryEmbedding = await embeddingService.embed(input.query);
          const results = await searchMemoriesByVector(db, queryEmbedding, context.userId, 10);
          if (results.length > 0) {
            for (const m of results) {
              touchMemory(db, m.id).catch(() => {});
            }
            return results.map((m) => ({
              key: m.key,
              category: m.category,
              content: m.content,
              updatedAt: m.updated_at,
              distance: m.distance,
            }));
          }
        } catch (err) {
          logger.warn({ err }, "vector search failed, falling back to text search");
        }
      }

      const memories = await recallMemories(db, context.userId, input);
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

    default:
      return null; // Unknown tool — caller handles
  }
}
