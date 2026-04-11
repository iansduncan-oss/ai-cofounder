/**
 * Procedural Memory Service: learns and recalls step-by-step procedures
 * extracted from successfully completed goals.
 */

import type { Db } from "@ai-cofounder/db";
import {
  createProceduralMemory,
  searchProceduralMemoriesByVector,
  incrementProceduralSuccess,
  incrementProceduralFailure,
  getGoal,
  listTasksByGoal,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import { sanitizeMemoryContent } from "../agents/prompts/system.js";

const logger = createLogger("procedural-memory");

export interface EmbedFn {
  (text: string): Promise<number[]>;
}

export class ProceduralMemoryService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embed: EmbedFn,
  ) {}

  /**
   * Extract a reusable procedure from a completed goal.
   * Called asynchronously via the reflection queue after goal completion.
   */
  async learnProcedure(goalId: string): Promise<{ id: string; triggerPattern: string } | null> {
    const goal = await getGoal(this.db, goalId);
    if (!goal || goal.status !== "completed") {
      logger.debug({ goalId }, "Goal not found or not completed, skipping procedure extraction");
      return null;
    }

    const tasks = await listTasksByGoal(this.db, goalId);
    const completedTasks = tasks.filter((t) => t.status === "completed");

    if (completedTasks.length < 2) {
      logger.debug(
        { goalId, taskCount: completedTasks.length },
        "Too few completed tasks for procedure",
      );
      return null;
    }

    const taskSummary = completedTasks
      .map(
        (t, i) =>
          `${i + 1}. [${t.assignedAgent}] ${t.title}${t.output ? `: ${String(t.output).slice(0, 200)}` : ""}`,
      )
      .join("\n");

    try {
      const result = await this.llmRegistry.complete("simple", {
        messages: [
          {
            role: "user",
            content: `Extract a reusable procedure from this completed goal and its tasks.

Goal: ${goal.title}
Description: ${goal.description ?? ""}

Completed tasks:
${taskSummary}

Return ONLY valid JSON:
{
  "triggerPattern": "A description of when this procedure should be triggered (1-2 sentences)",
  "steps": [{"description": "step description", "agent": "assigned_agent", "details": "specifics"}],
  "preconditions": ["condition that must be true before running"],
  "tags": ["relevant", "tags"]
}`,
          },
        ],
      });

      const textContent = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = JSON.parse(textContent.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

      if (!parsed.triggerPattern || !parsed.steps?.length) {
        logger.warn({ goalId }, "LLM returned incomplete procedure");
        return null;
      }

      let embedding: number[] | undefined;
      try {
        embedding = await this.embed(parsed.triggerPattern);
      } catch {
        logger.warn("Failed to embed trigger pattern");
      }

      const sanitizedSteps = (
        parsed.steps as Array<{ description: string; agent?: string; details?: string }>
      ).map((s) => ({
        ...s,
        description: sanitizeMemoryContent(s.description),
        details: s.details ? sanitizeMemoryContent(s.details) : s.details,
      }));

      const procedure = await createProceduralMemory(this.db, {
        triggerPattern: sanitizeMemoryContent(parsed.triggerPattern),
        steps: sanitizedSteps,
        preconditions: (parsed.preconditions ?? []).map((p: string) => sanitizeMemoryContent(p)),
        createdFromGoalId: goalId,
        tags: parsed.tags ?? [],
        embedding,
      });

      logger.info({ goalId, procedureId: procedure.id }, "Learned procedure from goal");
      return { id: procedure.id, triggerPattern: parsed.triggerPattern };
    } catch (err) {
      logger.error({ err, goalId }, "Failed to learn procedure");
      return null;
    }
  }

  /**
   * Learn a lesson from a completed autonomous session.
   * Uses "simple" task category (Groq = free) for the reflection LLM call.
   */
  async learnFromSession(
    summary: string,
    status: string,
  ): Promise<{ id: string; triggerPattern: string } | null> {
    if (!summary || summary.length < 20) {
      logger.debug("Session summary too short for lesson extraction");
      return null;
    }

    try {
      const result = await this.llmRegistry.complete("simple", {
        messages: [
          {
            role: "user",
            content: `You just completed an autonomous work session. Review what happened and extract a lesson for future sessions.

Session status: ${status}
Session summary: ${summary.slice(0, 2000)}

Return ONLY valid JSON:
{
  "triggerPattern": "When this lesson applies (1-2 sentences, e.g. 'When deploying services after code changes')",
  "steps": [{"description": "what to do", "details": "specifics"}],
  "preconditions": ["when this lesson is relevant"],
  "tags": ["relevant", "tags"]
}

Focus on actionable insights: what worked, what to avoid, what to do differently next time.`,
          },
        ],
      });

      const textContent = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = JSON.parse(textContent.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

      if (!parsed.triggerPattern || !parsed.steps?.length) {
        logger.warn("LLM returned incomplete lesson from session");
        return null;
      }

      let embedding: number[] | undefined;
      try {
        embedding = await this.embed(parsed.triggerPattern);
      } catch {
        logger.warn("Failed to embed session lesson trigger pattern");
      }

      const sanitizedSessionSteps = (
        parsed.steps as Array<{ description: string; details?: string }>
      ).map((s) => ({
        ...s,
        description: sanitizeMemoryContent(s.description),
        details: s.details ? sanitizeMemoryContent(s.details) : s.details,
      }));

      const procedure = await createProceduralMemory(this.db, {
        triggerPattern: sanitizeMemoryContent(parsed.triggerPattern),
        steps: sanitizedSessionSteps,
        preconditions: (parsed.preconditions ?? []).map((p: string) => sanitizeMemoryContent(p)),
        tags: [...(parsed.tags ?? []), "session-lesson"],
        embedding,
      });

      logger.info({ procedureId: procedure.id }, "Learned lesson from autonomous session");
      return { id: procedure.id, triggerPattern: parsed.triggerPattern };
    } catch (err) {
      logger.error({ err }, "Failed to learn from session");
      return null;
    }
  }

  /**
   * Find procedures matching a task description via vector search.
   */
  async findMatchingProcedures(
    taskDescription: string,
    limit = 3,
  ): Promise<
    Array<{
      id: string;
      triggerPattern: string;
      steps: unknown[];
      successCount: number;
      failureCount: number;
    }>
  > {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embed(taskDescription);
    } catch {
      logger.warn("Failed to embed query for procedure search");
      return [];
    }

    const results = await searchProceduralMemoriesByVector(this.db, queryEmbedding, limit, 0.3);

    return results.map((r) => ({
      id: r.id,
      triggerPattern: r.trigger_pattern,
      steps: r.steps,
      successCount: r.success_count,
      failureCount: r.failure_count,
    }));
  }

  /**
   * Record that a procedure was used successfully.
   */
  async recordSuccess(procedureId: string): Promise<void> {
    await incrementProceduralSuccess(this.db, procedureId);
  }

  /**
   * Record that a procedure was used but failed.
   */
  async recordFailure(procedureId: string): Promise<void> {
    await incrementProceduralFailure(this.db, procedureId);
  }
}
