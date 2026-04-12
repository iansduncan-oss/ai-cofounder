import type { LlmToolUseContent } from "@ai-cofounder/llm";
import {
  getN8nWorkflowByName,
  listN8nWorkflows,
  saveCodeExecution,
  createSchedule,
  listSchedules,
  deleteSchedule,
  createFollowUp,
  upsertProductivityLog,
  getProductivityLog,
  getPrimaryAdminUserId,
  getToolStats,
  getProviderHealthRecords,
  getUsageSummary,
  getCostByDay,
  listPipelineTemplates,
  getPipelineTemplateByName,
  createPipelineTemplate,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { executeWebSearch } from "../../tools/web-search.js";
import { executeBrowseWeb } from "../../tools/browse-web.js";
import { executeQueryDatabase } from "../../tools/database-tools.js";
import type { ToolExecutorServices, ToolExecutorContext } from "../types.js";

const logger = createLogger("tool-executor:workflows");

const HANDLED = new Set([
  "search_web",
  "browse_web",
  "trigger_workflow",
  "list_workflows",
  "list_n8n_workflows",
  "list_n8n_executions",
  "toggle_n8n_workflow",
  "create_schedule",
  "remind_me",
  "list_schedules",
  "delete_schedule",
  "execute_code",
  "query_database",
  "create_follow_up",
  "log_productivity",
  "query_analytics",
  "list_templates",
  "run_template",
  "create_template",
]);

export function handlesWorkflowTool(name: string): boolean {
  return HANDLED.has(name);
}

export async function executeWorkflowTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, n8nService, sandboxService } = services;

  switch (block.name) {
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
      const input = block.input as {
        workflow_name: string;
        payload: Record<string, unknown>;
      };
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
      return {
        count: workflows.length,
        workflows: workflows.map((w) => ({ id: w.id, name: w.name, active: w.active })),
      };
    }

    case "list_n8n_executions": {
      if (!n8nService) return { error: "n8n not available" };
      const { status, limit } = block.input as { status?: string; limit?: number };
      const executions = await n8nService.listExecutions({ status, limit: limit ?? 10 });
      return {
        count: executions.length,
        executions: executions.map((e) => ({
          id: e.id,
          workflowId: e.workflowId,
          status: e.status,
          mode: e.mode,
          startedAt: e.startedAt,
          stoppedAt: e.stoppedAt,
        })),
      };
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
      const input = block.input as {
        cron_expression: string;
        action_prompt: string;
        description?: string;
      };
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
          workspaceId: context.workspaceId ?? "",
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

    case "remind_me": {
      if (!db) return { error: "Database not available" };
      const input = block.input as {
        reminder_text: string;
        cron_expression: string;
        description?: string;
      };
      try {
        const { CronExpressionParser } = await import("cron-parser");
        const interval = CronExpressionParser.parse(input.cron_expression);
        const nextRunAt = interval.next().toDate();

        const reminderPrompt = `[REMINDER for sir] ${input.reminder_text}. Send this reminder to sir via notification. Be brief: "Sir, a reminder: ${input.reminder_text}"`;
        const desc = input.description ?? `Reminder: ${input.reminder_text}`;

        const schedule = await createSchedule(db, {
          cronExpression: input.cron_expression,
          actionPrompt: reminderPrompt,
          description: desc,
          userId: context.userId,
          enabled: true,
          nextRunAt,
          workspaceId: context.workspaceId ?? "",
          metadata: { isOneShot: true },
        });

        return {
          scheduleId: schedule.id,
          nextRunAt: nextRunAt.toISOString(),
          message: `Very well, sir. I shall remind you at ${nextRunAt.toLocaleString()} regarding: ${input.reminder_text}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Failed to set reminder: ${msg}` };
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
      const input = block.input as {
        code: string;
        language: string;
        timeout_ms?: number;
        dependencies?: string[];
      };
      const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 60_000);
      const result = await sandboxService.execute({
        code: input.code,
        language: input.language as "typescript" | "javascript" | "python" | "bash",
        timeoutMs,
        dependencies: input.dependencies,
      });
      // Record sandbox metrics
      try {
        const { recordSandboxMetrics } = await import("../../../plugins/observability.js");
        recordSandboxMetrics({
          language: result.language,
          success: result.exitCode === 0,
          oomKilled: result.oomKilled,
          timedOut: result.timedOut,
        });
      } catch {
        /* metrics are best-effort */
      }
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

    case "query_database": {
      if (!db) return { error: "Database not available" };
      const input = block.input as { sql: string; limit?: number };
      return executeQueryDatabase(db, input.sql, input.limit);
    }

    case "create_follow_up": {
      if (!db) return { error: "Database not available" };
      const input = block.input as {
        title: string;
        description?: string;
        due_date?: string;
        source?: string;
      };
      const followUp = await createFollowUp(db, {
        title: input.title,
        description: input.description,
        dueDate: input.due_date ? new Date(input.due_date) : undefined,
        source: input.source,
        workspaceId: context.workspaceId ?? "",
      });
      return { created: true, followUpId: followUp.id, title: followUp.title };
    }

    case "log_productivity": {
      if (!db) return { error: "Database not available" };
      const adminUserId = await getPrimaryAdminUserId(db);
      if (!adminUserId) return { error: "No admin user configured" };

      const input = block.input as {
        planned_items?: { text: string; completed: boolean }[];
        mood?: "great" | "good" | "okay" | "rough" | "terrible";
        energy_level?: number;
        highlights?: string;
        blockers?: string;
        reflection_notes?: string;
      };

      const today = new Date().toISOString().slice(0, 10);

      // Calculate completion score if planned items provided
      let completionScore: number | undefined;
      if (input.planned_items && input.planned_items.length > 0) {
        const done = input.planned_items.filter((i) => i.completed).length;
        completionScore = Math.round((done / input.planned_items.length) * 100);
      }

      // Compute streak from yesterday
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const prevLog = await getProductivityLog(
        db,
        adminUserId,
        yesterday.toISOString().slice(0, 10),
      );
      const streakDays = prevLog ? prevLog.streakDays + 1 : 1;

      const row = await upsertProductivityLog(db, {
        userId: adminUserId,
        date: today,
        plannedItems: input.planned_items,
        mood: input.mood,
        energyLevel: input.energy_level,
        highlights: input.highlights,
        blockers: input.blockers,
        reflectionNotes: input.reflection_notes,
        completionScore,
        streakDays,
      });

      return {
        logged: true,
        date: today,
        streakDays: row.streakDays,
        completionScore: row.completionScore,
        itemsPlanned: (row.plannedItems as unknown[] | null)?.length ?? 0,
      };
    }

    case "query_analytics": {
      if (!db) return { error: "Database not available" };
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
          const usage = await getUsageSummary(db, { since });
          const costSince = new Date();
          costSince.setDate(costSince.getDate() - 7);
          const daily = await getCostByDay(db, costSince);
          return { ...usage, daily_breakdown: daily, period: time_range ?? "week" };
        }
        case "tool_performance": {
          const stats = await getToolStats(db);
          return { tools: stats, period: time_range ?? "week" };
        }
        case "provider_health": {
          const health = await getProviderHealthRecords(db);
          return { providers: health };
        }
        case "usage_trend": {
          const trendSince = new Date();
          trendSince.setDate(trendSince.getDate() - (time_range === "month" ? 30 : 7));
          const daily = await getCostByDay(db, trendSince);
          return { daily, period: time_range ?? "week" };
        }
        case "error_rate": {
          const stats = await getToolStats(db);
          const withErrors = stats.filter((s) => s.errorCount > 0);
          return { tools_with_errors: withErrors, total_tools_tracked: stats.length };
        }
        default:
          return { error: `Unknown metric: ${metric}` };
      }
    }

    case "list_templates": {
      if (!db) return { error: "Database not available" };
      const templates = await listPipelineTemplates(db);
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
      if (!db) return { error: "Database not available" };
      const { template_name, context: templateCtx } = block.input as {
        template_name: string;
        context?: Record<string, unknown>;
      };
      const template = await getPipelineTemplateByName(db, template_name);
      if (!template) return { error: `Template "${template_name}" not found` };
      const { enqueuePipeline } = await import("@ai-cofounder/queue");
      const stages = (
        template.stages as Array<{
          agent: string;
          prompt: string;
          dependsOnPrevious?: boolean;
        }>
      ).map((s) => ({
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
      if (!db) return { error: "Database not available" };
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
      const created = await createPipelineTemplate(db, {
        name,
        stages: pipelineStages,
        defaultContext: default_context ?? {},
      });
      return { created: true, name: created.name };
    }

    default:
      return { error: `Workflow handler got unexpected tool: ${block.name}` };
  }
}
