import type { Db } from "@ai-cofounder/db";
import { getAgentPerformanceStats } from "@ai-cofounder/db";
import type { AgentRole } from "@ai-cofounder/shared";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("adaptive-routing");

const MIN_SAMPLES = 10;
const W_SUCCESS_RATE = 0.7;
const W_SPEED = 0.15;
const W_TREND = 0.15;

const DISPATCHABLE_ROLES = new Set<AgentRole>([
  "researcher", "coder", "reviewer", "planner", "debugger", "doc_writer",
]);

export interface AgentStats {
  agent: AgentRole;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgDurationMs: number | null;
  overallSuccessRate: number;
  recentSuccessRate: number | null;
  score: number;
  hasSufficientData: boolean;
}

export interface RoutingSuggestion {
  recommended: AgentRole;
  confidence: number;
  reasoning: string;
  stats: AgentStats[];
}

export interface RoutingDecision {
  taskId: string;
  originalAgent: AgentRole;
  recommendedAgent: AgentRole;
  confidence: number;
  overridden: boolean;
  timestamp: Date;
}

export interface RoutingStats {
  agentPerformance: AgentStats[];
  recentDecisions: RoutingDecision[];
  overrideRate: number;
  totalDecisions: number;
  totalOverrides: number;
}

export class AdaptiveRoutingService {
  private decisions: RoutingDecision[] = [];
  private readonly maxDecisions = 100;

  constructor(private db: Db) {}

  async suggestAgent(
    _taskDescription: string,
    currentAssignment: AgentRole,
  ): Promise<RoutingSuggestion> {
    const rawStats = await getAgentPerformanceStats(this.db);

    // Compute scores for dispatchable agents
    const fastestDuration = rawStats
      .filter((r) => DISPATCHABLE_ROLES.has(r.agent as AgentRole) && r.avgDurationMs != null && r.avgDurationMs > 0)
      .reduce((min, r) => Math.min(min, r.avgDurationMs!), Infinity);

    const stats: AgentStats[] = rawStats
      .filter((r) => DISPATCHABLE_ROLES.has(r.agent as AgentRole))
      .map((r) => {
        const terminalTasks = r.completedTasks + r.failedTasks;
        const hasSufficientData = terminalTasks >= MIN_SAMPLES;

        // Success rate component (0-1)
        const successScore = r.overallSuccessRate;

        // Speed component (0-1): faster = higher score
        const speedScore = r.avgDurationMs != null && r.avgDurationMs > 0 && isFinite(fastestDuration)
          ? fastestDuration / r.avgDurationMs
          : 0.5;

        // Trend component (0-1): use recent if available, else overall
        const trendScore = r.recentSuccessRate ?? r.overallSuccessRate;

        const score = W_SUCCESS_RATE * successScore + W_SPEED * speedScore + W_TREND * trendScore;

        return {
          agent: r.agent as AgentRole,
          totalTasks: r.totalTasks,
          completedTasks: r.completedTasks,
          failedTasks: r.failedTasks,
          avgDurationMs: r.avgDurationMs,
          overallSuccessRate: r.overallSuccessRate,
          recentSuccessRate: r.recentSuccessRate,
          score,
          hasSufficientData,
        };
      })
      .sort((a, b) => b.score - a.score);

    // Find current agent's stats
    const currentStats = stats.find((s) => s.agent === currentAssignment);

    // If current agent lacks data, keep it (no basis for override)
    if (!currentStats || !currentStats.hasSufficientData) {
      return {
        recommended: currentAssignment,
        confidence: 0,
        reasoning: `Insufficient data for ${currentAssignment} (need ${MIN_SAMPLES}+ completed tasks)`,
        stats,
      };
    }

    // Find best agent with sufficient data
    const best = stats.find((s) => s.hasSufficientData);
    if (!best || best.agent === currentAssignment) {
      return {
        recommended: currentAssignment,
        confidence: 0,
        reasoning: currentAssignment === best?.agent
          ? `${currentAssignment} is already the best-performing agent`
          : "No agents with sufficient data to compare",
        stats,
      };
    }

    // Confidence = normalized score gap
    const confidence = best.score > 0 ? (best.score - currentStats.score) / best.score : 0;

    return {
      recommended: best.agent,
      confidence: Math.round(confidence * 1000) / 1000,
      reasoning: `${best.agent} (score ${best.score.toFixed(3)}) outperforms ${currentAssignment} (score ${currentStats.score.toFixed(3)})`,
      stats,
    };
  }

  recordDecision(decision: RoutingDecision): void {
    this.decisions.push(decision);
    if (this.decisions.length > this.maxDecisions) {
      this.decisions.shift();
    }
  }

  async getRoutingStats(): Promise<RoutingStats> {
    const rawStats = await getAgentPerformanceStats(this.db);

    const fastestDuration = rawStats
      .filter((r) => DISPATCHABLE_ROLES.has(r.agent as AgentRole) && r.avgDurationMs != null && r.avgDurationMs > 0)
      .reduce((min, r) => Math.min(min, r.avgDurationMs!), Infinity);

    const agentPerformance: AgentStats[] = rawStats
      .filter((r) => DISPATCHABLE_ROLES.has(r.agent as AgentRole))
      .map((r) => {
        const terminalTasks = r.completedTasks + r.failedTasks;
        const successScore = r.overallSuccessRate;
        const speedScore = r.avgDurationMs != null && r.avgDurationMs > 0 && isFinite(fastestDuration)
          ? fastestDuration / r.avgDurationMs
          : 0.5;
        const trendScore = r.recentSuccessRate ?? r.overallSuccessRate;
        const score = W_SUCCESS_RATE * successScore + W_SPEED * speedScore + W_TREND * trendScore;

        return {
          agent: r.agent as AgentRole,
          totalTasks: r.totalTasks,
          completedTasks: r.completedTasks,
          failedTasks: r.failedTasks,
          avgDurationMs: r.avgDurationMs,
          overallSuccessRate: r.overallSuccessRate,
          recentSuccessRate: r.recentSuccessRate,
          score,
          hasSufficientData: terminalTasks >= MIN_SAMPLES,
        };
      })
      .sort((a, b) => b.score - a.score);

    const totalDecisions = this.decisions.length;
    const totalOverrides = this.decisions.filter((d) => d.overridden).length;

    return {
      agentPerformance,
      recentDecisions: [...this.decisions].reverse(),
      overrideRate: totalDecisions > 0 ? totalOverrides / totalDecisions : 0,
      totalDecisions,
      totalOverrides,
    };
  }
}
