import { createLogger } from "@ai-cofounder/shared";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import {
  insertReflection,
  listReflections,
  getDistinctActionUserIds,
  getUserActionsForAnalysis,
  upsertUserPattern,
  deleteOldUserActions,
} from "@ai-cofounder/db";

const logger = createLogger("reflection-service");

export interface Lesson {
  lesson: string;
  category: string;
  confidence: number;
}

export interface AgentPerformanceEntry {
  success: number;
  fail: number;
  insights: string[];
}

export interface TaskResult {
  id: string;
  title: string;
  agent: string;
  status: string;
  output?: string;
}

export class ReflectionService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embeddingService?: EmbeddingService,
  ) {}

  /**
   * Generate a structured reflection after goal completion.
   * Analyzes what worked, what failed, and extracts lessons.
   */
  async reflectOnGoal(
    goalId: string,
    goalTitle: string,
    status: string,
    taskResults: TaskResult[],
  ) {
    const succeeded = taskResults.filter((t) => t.status === "completed");
    const failed = taskResults.filter((t) => t.status === "failed");

    // Build agent performance stats
    const agentPerformance: Record<string, AgentPerformanceEntry> = {};
    for (const t of taskResults) {
      const entry = agentPerformance[t.agent] ??= { success: 0, fail: 0, insights: [] };
      if (t.status === "completed") entry.success++;
      else if (t.status === "failed") entry.fail++;
    }

    // Generate structured reflection via LLM
    const prompt = this.buildReflectionPrompt(goalTitle, status, taskResults, succeeded, failed);

    const response = await this.llmRegistry.complete("planning", {
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Parse lessons from LLM response
    const lessons = this.parseLessons(responseText);

    // Add failure insights to agent performance
    for (const t of failed) {
      const entry = agentPerformance[t.agent];
      if (entry) {
        entry.insights.push(`Failed: ${t.title} — ${(t.output ?? "unknown").slice(0, 200)}`);
      }
    }

    const reflectionType = failed.length > 0 && succeeded.length === 0
      ? "failure_analysis" as const
      : "goal_completion" as const;

    // Embed the reflection content for RAG retrieval
    let embedding: number[] | undefined;
    if (this.embeddingService) {
      try {
        embedding = await this.embeddingService.embed(responseText.slice(0, 4000));
      } catch (err) {
        logger.warn({ err }, "failed to embed reflection (non-fatal)");
      }
    }

    const reflection = await insertReflection(this.db, {
      goalId,
      reflectionType,
      content: responseText,
      embedding,
      lessons,
      agentPerformance,
      metadata: {
        goalTitle,
        goalStatus: status,
        totalTasks: taskResults.length,
        succeededTasks: succeeded.length,
        failedTasks: failed.length,
      },
    });

    // Ingest into RAG for future retrieval
    if (this.embeddingService) {
      try {
        const { ingestText } = await import("@ai-cofounder/rag");
        await ingestText(
          this.db,
          this.embeddingService.embed.bind(this.embeddingService),
          "reflection",
          reflection.id,
          responseText,
          { metadata: { goalId, reflectionType } },
        );
      } catch (err) {
        logger.warn({ err }, "failed to ingest reflection into RAG (non-fatal)");
      }
    }

    logger.info(
      { reflectionId: reflection.id, goalId, type: reflectionType, lessonCount: lessons.length },
      "goal reflection created",
    );

    return reflection;
  }

  /**
   * Extract cross-goal patterns from recent reflections.
   * Runs weekly to distill higher-level insights.
   */
  async extractWeeklyPatterns() {
    // Fetch recent goal_completion and failure_analysis reflections
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentReflections } = await listReflections(this.db, {
      limit: 100,
    });

    // Filter to only recent goal reflections (not weekly summaries)
    const goalReflections = recentReflections.filter(
      (r) =>
        (r.reflectionType === "goal_completion" || r.reflectionType === "failure_analysis") &&
        r.createdAt >= sevenDaysAgo,
    );

    if (goalReflections.length < 3) {
      logger.info(
        { count: goalReflections.length },
        "not enough reflections for weekly pattern extraction (need ≥3)",
      );
      return null;
    }

    // Build a summary of all recent reflections for pattern analysis
    const reflectionSummaries = goalReflections.map((r, i) => {
      const lessons = Array.isArray(r.lessons) ? r.lessons as Lesson[] : [];
      return `Reflection ${i + 1} (${r.reflectionType}):\n${r.content.slice(0, 500)}\nLessons: ${lessons.map((l) => l.lesson).join("; ")}`;
    }).join("\n\n---\n\n");

    const prompt = `You are analyzing ${goalReflections.length} goal reflections from the past week to extract cross-cutting patterns and meta-lessons.

Here are the individual reflections:

${reflectionSummaries}

Analyze these reflections and identify:
1. Recurring patterns (what keeps working or failing)
2. Agent performance trends (which agents excel, which struggle)
3. Process improvements (what should change in how goals are planned/executed)
4. Meta-lessons that apply across multiple goals

Format your response as:
WEEKLY PATTERNS SUMMARY
[2-3 paragraph narrative of key patterns observed]

LESSONS:
- lesson: [insight] | category: [technical/process/agent/planning] | confidence: [0.0-1.0]
- lesson: [insight] | category: [...] | confidence: [...]
(include 3-8 lessons)`;

    const response = await this.llmRegistry.complete("planning", {
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const lessons = this.parseLessons(responseText);

    // Aggregate agent performance across all reflections
    const aggregatePerf: Record<string, AgentPerformanceEntry> = {};
    for (const r of goalReflections) {
      const perf = r.agentPerformance as Record<string, AgentPerformanceEntry> | null;
      if (!perf) continue;
      for (const [role, stats] of Object.entries(perf)) {
        const entry = aggregatePerf[role] ??= { success: 0, fail: 0, insights: [] };
        entry.success += stats.success ?? 0;
        entry.fail += stats.fail ?? 0;
      }
    }

    let embedding: number[] | undefined;
    if (this.embeddingService) {
      try {
        embedding = await this.embeddingService.embed(responseText.slice(0, 4000));
      } catch (err) {
        logger.warn({ err }, "failed to embed weekly patterns (non-fatal)");
      }
    }

    const reflection = await insertReflection(this.db, {
      reflectionType: "weekly_summary",
      content: responseText,
      embedding,
      lessons,
      agentPerformance: aggregatePerf,
      metadata: {
        reflectionCount: goalReflections.length,
        periodStart: sevenDaysAgo.toISOString(),
        periodEnd: new Date().toISOString(),
      },
    });

    // Ingest into RAG
    if (this.embeddingService) {
      try {
        const { ingestText } = await import("@ai-cofounder/rag");
        await ingestText(
          this.db,
          this.embeddingService.embed.bind(this.embeddingService),
          "reflection",
          reflection.id,
          responseText,
          { metadata: { reflectionType: "weekly_summary" } },
        );
      } catch (err) {
        logger.warn({ err }, "failed to ingest weekly patterns into RAG (non-fatal)");
      }
    }

    logger.info(
      { reflectionId: reflection.id, inputReflections: goalReflections.length, lessonCount: lessons.length },
      "weekly pattern extraction complete",
    );

    return reflection;
  }

  /**
   * Analyze user actions over the past 30 days to identify behavioral patterns.
   * Runs per-user: fetches distinct userIds, analyzes each separately,
   * and upserts patterns with the actual userId.
   */
  async analyzeUserPatterns() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let userIds: string[];
    try {
      userIds = await getDistinctActionUserIds(this.db, thirtyDaysAgo);
    } catch (err) {
      logger.warn({ err }, "failed to fetch distinct user IDs for pattern analysis");
      return [];
    }

    if (userIds.length === 0) {
      logger.info("no users with recent actions — skipping pattern analysis");
      return [];
    }

    const allResults = [];

    for (const userId of userIds) {
      try {
        const actions = await getUserActionsForAnalysis(this.db, userId, thirtyDaysAgo);

        if (actions.length < 5) {
          logger.debug({ userId, count: actions.length }, "skipping user with < 5 actions");
          continue;
        }

        const patterns = await this.analyzeActionsForUser(userId, actions);
        allResults.push(...patterns);
      } catch (err) {
        logger.warn({ err, userId }, "failed to analyze patterns for user");
      }
    }

    // Clean up old actions (> 90 days) — once after all users
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    try {
      const deleted = await deleteOldUserActions(this.db, ninetyDaysAgo);
      if (deleted > 0) {
        logger.info({ deleted }, "cleaned up old user actions");
      }
    } catch {
      // cleanup failure is non-fatal
    }

    logger.info(
      { patternsFound: allResults.length, usersAnalyzed: userIds.length },
      "user pattern analysis complete",
    );

    return allResults;
  }

  /** Analyze actions for a single user and upsert discovered patterns. */
  private async analyzeActionsForUser(
    userId: string,
    actions: Array<{
      actionType: string;
      actionDetail: string | null;
      dayOfWeek: number;
      hourOfDay: number;
      createdAt: Date;
    }>,
  ) {
    // Build summary stats
    const dayCounts: Record<number, number> = {};
    const hourCounts: Record<number, number> = {};
    const actionTypeCounts: Record<string, number> = {};

    for (const a of actions) {
      dayCounts[a.dayOfWeek] = (dayCounts[a.dayOfWeek] ?? 0) + 1;
      hourCounts[a.hourOfDay] = (hourCounts[a.hourOfDay] ?? 0) + 1;
      actionTypeCounts[a.actionType] = (actionTypeCounts[a.actionType] ?? 0) + 1;
    }

    // Compute action-pair sequences (consecutive actions within 30 min)
    const sequences: string[] = [];
    for (let i = 1; i < actions.length; i++) {
      const prev = actions[i - 1];
      const curr = actions[i];
      const diffMs = curr.createdAt.getTime() - prev.createdAt.getTime();
      if (diffMs <= 30 * 60 * 1000) {
        sequences.push(`${prev.actionType} → ${curr.actionType}`);
      }
    }

    const sequenceCounts: Record<string, number> = {};
    for (const seq of sequences) {
      sequenceCounts[seq] = (sequenceCounts[seq] ?? 0) + 1;
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const summary = `Action counts by day: ${Object.entries(dayCounts)
      .map(([d, c]) => `${dayNames[Number(d)]}: ${c}`)
      .join(", ")}
Action counts by hour: ${Object.entries(hourCounts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([h, c]) => `${h}:00: ${c}`)
      .join(", ")}
Action type counts: ${Object.entries(actionTypeCounts)
      .map(([t, c]) => `${t}: ${c}`)
      .join(", ")}
Action sequences (within 30 min): ${Object.entries(sequenceCounts)
      .filter(([, c]) => c >= 2)
      .map(([s, c]) => `${s} (${c}x)`)
      .join(", ") || "none"}
Total actions analyzed: ${actions.length}`;

    const prompt = `You are analyzing a single user's behavioral patterns over the past 30 days to enable anticipatory suggestions.

${summary}

Identify recurring patterns such as:
1. Time-based preferences (e.g., "usually active on weekday mornings", "deploys on Fridays")
2. Action sequences (e.g., "after creating a goal, usually sends a chat message within an hour")
3. Recurring activities (e.g., "frequently uses deploy on Wednesdays around 3 PM")

For each pattern, provide:
- A human-readable description
- The trigger condition (dayOfWeek 0-6, hourRange [start, end])
- A suggested anticipatory action

Format as JSON array:
[
  {
    "patternType": "time_preference" | "sequence" | "recurring_action",
    "description": "human-readable description",
    "triggerCondition": { "dayOfWeek": 5, "hourRange": [14, 16] },
    "suggestedAction": "Run the test suite before deploying",
    "confidence": 75
  }
]

Return ONLY the JSON array, no other text. Return an empty array [] if no clear patterns are found.`;

    const response = await this.llmRegistry.complete("simple", {
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    const match = responseText.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as Array<{
      patternType: string;
      description: string;
      triggerCondition: Record<string, unknown>;
      suggestedAction: string;
      confidence: number;
    }>;

    if (!Array.isArray(parsed)) return [];

    const results = [];
    for (const p of parsed) {
      try {
        const result = await upsertUserPattern(this.db, {
          userId,
          patternType: p.patternType,
          description: p.description,
          triggerCondition: p.triggerCondition,
          suggestedAction: p.suggestedAction,
          confidence: Math.min(100, Math.max(0, p.confidence)),
          workspaceId: "",
        });
        results.push(result);
      } catch (err) {
        logger.warn({ err, pattern: p.description }, "failed to upsert pattern");
      }
    }

    return results;
  }

  private buildReflectionPrompt(
    goalTitle: string,
    status: string,
    taskResults: TaskResult[],
    succeeded: TaskResult[],
    failed: TaskResult[],
  ): string {
    const taskSummary = taskResults
      .map((t) => `- ${t.title} (${t.agent}): ${t.status}${t.output ? ` — ${t.output.slice(0, 200)}` : ""}`)
      .join("\n");

    return `You are a reflective AI system analyzing the results of a completed goal.

Goal: "${goalTitle}"
Status: ${status}
Tasks completed: ${succeeded.length}/${taskResults.length}
Tasks failed: ${failed.length}/${taskResults.length}

Task details:
${taskSummary}

Analyze this execution and provide:
1. A concise narrative reflection (2-3 paragraphs) covering what went well, what failed, and why
2. Structured lessons learned

Format the lessons section as:
LESSONS:
- lesson: [specific actionable insight] | category: [technical/process/agent/planning] | confidence: [0.0-1.0]
- lesson: [...] | category: [...] | confidence: [...]
(include 2-6 lessons)`;
  }

  /** Parse structured lessons from LLM response text */
  parseLessons(text: string): Lesson[] {
    const lessons: Lesson[] = [];
    const lessonRegex = /- lesson:\s*(.+?)\s*\|\s*category:\s*(\w+)\s*\|\s*confidence:\s*([\d.]+)/gi;
    let match;

    while ((match = lessonRegex.exec(text)) !== null) {
      lessons.push({
        lesson: match[1].trim(),
        category: match[2].trim().toLowerCase(),
        confidence: Math.min(1, Math.max(0, parseFloat(match[3]))),
      });
    }

    return lessons;
  }
}
