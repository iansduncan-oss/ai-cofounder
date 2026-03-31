import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("complexity-estimator");

export interface ComplexityScore {
  score: number; // 0-1
  level: "low" | "medium" | "high" | "critical";
  roundBudget: number;
  thinkingTokenBudget: number;
  factors: Record<string, number>;
}

// Score thresholds
const LEVELS = [
  { max: 0.25, level: "low" as const, rounds: 3, thinking: 0 },
  { max: 0.5, level: "medium" as const, rounds: 5, thinking: 4096 },
  { max: 0.75, level: "high" as const, rounds: 8, thinking: 8192 },
  { max: 1.0, level: "critical" as const, rounds: 12, thinking: 16384 },
];

/**
 * Estimates task complexity from observable signals.
 * No LLM calls — pure heuristics for speed.
 */
export class ComplexityEstimator {
  /**
   * Score a task's complexity based on available signals.
   */
  estimate(input: {
    description: string;
    taskCount?: number;
    toolCount?: number;
    priorFailureRate?: number; // 0-1
    hasSubtasks?: boolean;
    goalPriority?: "low" | "medium" | "high" | "critical";
  }): ComplexityScore {
    const factors: Record<string, number> = {};

    // Factor 1: Description length/complexity (0-1)
    // Longer descriptions with technical terms signal more complex tasks
    const descLen = input.description.length;
    const descScore = Math.min(descLen / 2000, 1);
    factors.descriptionLength = descScore;

    // Factor 2: Keyword complexity signals
    const complexKeywords = [
      "refactor", "migrate", "architecture", "distributed", "concurrent",
      "security", "authentication", "encryption", "multi-step", "complex",
      "integration", "database", "schema", "performance", "optimization",
      "debug", "investigate", "analyze", "comprehensive", "thorough",
    ];
    const keywordCount = complexKeywords.filter((kw) =>
      input.description.toLowerCase().includes(kw),
    ).length;
    const keywordScore = Math.min(keywordCount / 5, 1);
    factors.keywords = keywordScore;

    // Factor 3: Task/subtask count (0-1)
    const taskCount = input.taskCount ?? 1;
    const taskScore = Math.min(taskCount / 10, 1);
    factors.taskCount = taskScore;

    // Factor 4: Tool count (0-1)
    const toolCount = input.toolCount ?? 0;
    const toolScore = Math.min(toolCount / 15, 1);
    factors.toolCount = toolScore;

    // Factor 5: Prior failure rate (0-1)
    const failureRate = input.priorFailureRate ?? 0;
    factors.priorFailures = failureRate;

    // Factor 6: Priority boost
    const priorityScores: Record<string, number> = { low: 0, medium: 0.2, high: 0.5, critical: 0.8 };
    const priorityScore = priorityScores[input.goalPriority ?? "medium"] ?? 0.2;
    factors.priority = priorityScore;

    // Weighted combination
    const score = Math.min(1, Math.max(0,
      descScore * 0.15 +
      keywordScore * 0.2 +
      taskScore * 0.2 +
      toolScore * 0.1 +
      failureRate * 0.2 +
      priorityScore * 0.15,
    ));

    const tier = LEVELS.find((l) => score <= l.max) ?? LEVELS[LEVELS.length - 1];

    const result: ComplexityScore = {
      score: Math.round(score * 1000) / 1000,
      level: tier.level,
      roundBudget: tier.rounds,
      thinkingTokenBudget: tier.thinking,
      factors,
    };

    logger.debug(result, "complexity estimated");
    return result;
  }
}
