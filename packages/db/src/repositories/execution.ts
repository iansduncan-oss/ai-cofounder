import {
  eq,
  and,
  desc,
  asc,
  ilike,
  or,
  sql,
  lte,
  gte,
  isNull,
  isNotNull,
  inArray,
  gt,
} from "drizzle-orm";
import type { Db } from "../client.js";

/** Coerce empty string to undefined for UUID columns */
function nullifyEmpty(val: string | undefined | null): string | undefined {
  return val ? val : undefined;
}
import type { AgentRole } from "@ai-cofounder/shared";
import {
  codeExecutions,
  goals,
  llmUsage,
} from "../schema.js";

/* ────────────────────── Code Executions ────────────────────── */

export async function saveCodeExecution(
  db: Db,
  data: {
    taskId?: string;
    language: string;
    codeHash: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    timedOut?: boolean;
  },
) {
  const [execution] = await db
    .insert(codeExecutions)
    .values({
      taskId: data.taskId,
      language: data.language,
      codeHash: data.codeHash,
      stdout: data.stdout,
      stderr: data.stderr,
      exitCode: data.exitCode,
      durationMs: data.durationMs,
      timedOut: data.timedOut ?? false,
    })
    .returning();
  return execution;
}

export async function listCodeExecutionsByTask(db: Db, taskId: string) {
  return db
    .select()
    .from(codeExecutions)
    .where(eq(codeExecutions.taskId, taskId))
    .orderBy(desc(codeExecutions.createdAt));
}

/* ────────────────── LLM Usage Tracking ─────────────────── */

/** Per-model pricing in microdollars per token ($0.000001 = 1 microdollar) */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-20250514": { input: 15_000, output: 75_000 }, // $15/$75 per MTok
  "claude-sonnet-4-20250514": { input: 3_000, output: 15_000 }, // $3/$15 per MTok
  // Groq (free tier)
  "llama-3.1-8b-instant": { input: 0, output: 0 },
  "llama-3.3-70b-versatile": { input: 0, output: 0 },
  // Gemini
  "gemini-2.5-pro": { input: 1_250, output: 10_000 }, // $1.25/$10 per MTok
  "gemini-2.5-flash": { input: 150, output: 600 }, // $0.15/$0.60 per MTok
  // OpenRouter free models
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
};

function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  // pricing is per million tokens, so divide by 1_000_000
  return Math.round((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

export async function recordLlmUsage(
  db: Db,
  data: {
    provider: string;
    model: string;
    taskCategory: string;
    agentRole?: AgentRole;
    inputTokens: number;
    outputTokens: number;
    workspaceId?: string;
    userId?: string;
    goalId?: string;
    taskId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const costMicros = estimateCostMicros(data.model, data.inputTokens, data.outputTokens);
  const [record] = await db
    .insert(llmUsage)
    .values({
      ...data,
      workspaceId: nullifyEmpty(data.workspaceId),
      estimatedCostUsd: costMicros,
    })
    .returning();
  return record;
}

/**
 * Returns aggregated LLM cost and token usage for a specific goal.
 * Avoids the pre-existing TS errors in getUsageSummary() by using a simple aggregate query.
 * Note: estimatedCostUsd is stored in microdollars; divide by 1_000_000 to get USD.
 */
export async function getCostByGoal(
  db: Db,
  goalId: string,
): Promise<{
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
}> {
  const rows = await db
    .select({
      totalCostUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as(
        "total_cost_usd",
      ),
      totalInputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as(
        "total_input_tokens",
      ),
      totalOutputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as(
        "total_output_tokens",
      ),
      requestCount: sql<number>`count(*)::int`.as("request_count"),
    })
    .from(llmUsage)
    .where(eq(llmUsage.goalId, goalId));

  const row = rows[0];
  return {
    // Convert microdollars to dollars
    totalCostUsd: Number(row?.totalCostUsd ?? 0) / 1_000_000,
    totalInputTokens: row?.totalInputTokens ?? 0,
    totalOutputTokens: row?.totalOutputTokens ?? 0,
    requestCount: row?.requestCount ?? 0,
  };
}

/**
 * Returns the top most expensive goals by total LLM cost.
 * JOINs llmUsage with goals to include titles.
 */
export async function getTopExpensiveGoals(
  db: Db,
  options?: { limit?: number; since?: Date },
): Promise<
  Array<{
    goalId: string;
    goalTitle: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
  }>
> {
  const limit = options?.limit ?? 10;
  const conditions = [sql`${llmUsage.goalId} IS NOT NULL`];
  if (options?.since) {
    conditions.push(sql`${llmUsage.createdAt} >= ${options.since.toISOString()}`);
  }

  const rows = await db
    .select({
      goalId: llmUsage.goalId,
      goalTitle: goals.title,
      totalCostUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as(
        "total_cost_usd",
      ),
      totalInputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as(
        "total_input_tokens",
      ),
      totalOutputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as(
        "total_output_tokens",
      ),
      requestCount: sql<number>`count(*)::int`.as("request_count"),
    })
    .from(llmUsage)
    .innerJoin(goals, eq(llmUsage.goalId, goals.id))
    .where(and(...conditions))
    .groupBy(llmUsage.goalId, goals.title)
    .orderBy(sql`total_cost_usd desc`)
    .limit(limit);

  return rows.map((row) => ({
    goalId: row.goalId!,
    goalTitle: row.goalTitle,
    totalCostUsd: Number(row.totalCostUsd) / 1_000_000,
    totalInputTokens: row.totalInputTokens ?? 0,
    totalOutputTokens: row.totalOutputTokens ?? 0,
    requestCount: row.requestCount ?? 0,
  }));
}

/**
 * Returns daily cost aggregates for LLM usage within the given date range.
 * Divides microdollar values by 1_000_000 to return USD.
 * Results are ordered ascending by date for chart rendering.
 */
export async function getCostByDay(
  db: Db,
  since: Date,
  until?: Date,
  workspaceId?: string,
): Promise<
  Array<{
    date: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  }>
> {
  const conditions = [sql`${llmUsage.createdAt} >= ${since.toISOString()}`];
  if (until) {
    conditions.push(sql`${llmUsage.createdAt} <= ${until.toISOString()}`);
  }
  if (workspaceId) {
    conditions.push(eq(llmUsage.workspaceId, workspaceId));
  }

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${llmUsage.createdAt})::date::text`.as("date"),
      costUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as("cost_usd"),
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as("input_tokens"),
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as(
        "output_tokens",
      ),
      requests: sql<number>`count(*)::int`.as("requests"),
    })
    .from(llmUsage)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${llmUsage.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${llmUsage.createdAt})::date asc`);

  return rows.map((row) => ({
    date: row.date,
    // Convert microdollars to dollars
    costUsd: Number(row.costUsd) / 1_000_000,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    requests: row.requests ?? 0,
  }));
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number; // in dollars
  byProvider: Record<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number; requests: number }
  >;
  byModel: Record<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number; requests: number }
  >;
  byAgent: Record<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number; requests: number }
  >;
  requestCount: number;
}

export async function getTodayTokenTotal(db: Db): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)::int`,
    })
    .from(llmUsage)
    .where(sql`${llmUsage.createdAt} >= ${todayStart.toISOString()}`);
  return rows[0]?.total ?? 0;
}

export async function getUsageSummary(
  db: Db,
  options?: { since?: Date; until?: Date; workspaceId?: string },
): Promise<UsageSummary> {
  const conditions = [];
  if (options?.since) {
    conditions.push(sql`${llmUsage.createdAt} >= ${options.since.toISOString()}`);
  }
  if (options?.until) {
    conditions.push(sql`${llmUsage.createdAt} < ${options.until.toISOString()}`);
  }
  if (options?.workspaceId) {
    conditions.push(eq(llmUsage.workspaceId, options.workspaceId));
  }

  const rows = await db
    .select()
    .from(llmUsage)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(llmUsage.createdAt));

  const summary: UsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    byProvider: {},
    byModel: {},
    byAgent: {},
    requestCount: rows.length,
  };

  for (const row of rows) {
    const costUsd = (row.estimatedCostUsd ?? 0) / 1_000_000;
    summary.totalInputTokens += row.inputTokens;
    summary.totalOutputTokens += row.outputTokens;
    summary.totalCostUsd += costUsd;

    // By provider
    const prov = (summary.byProvider[row.provider] ??= {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    });
    prov.inputTokens += row.inputTokens;
    prov.outputTokens += row.outputTokens;
    prov.costUsd += costUsd;
    prov.requests++;

    // By model
    const mod = (summary.byModel[row.model] ??= {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    });
    mod.inputTokens += row.inputTokens;
    mod.outputTokens += row.outputTokens;
    mod.costUsd += costUsd;
    mod.requests++;

    // By agent
    const agent = row.agentRole ?? "unknown";
    const ag = (summary.byAgent[agent] ??= {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    });
    ag.inputTokens += row.inputTokens;
    ag.outputTokens += row.outputTokens;
    ag.costUsd += costUsd;
    ag.requests++;
  }

  // Round dollar amounts
  summary.totalCostUsd = Math.round(summary.totalCostUsd * 1_000_000) / 1_000_000;

  return summary;
}

