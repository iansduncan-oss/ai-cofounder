import { createLogger } from "@ai-cofounder/shared";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { insertReflection, listReflections } from "@ai-cofounder/db";

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
