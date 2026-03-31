/**
 * Self-Healing Service: tracks agent/tool failure patterns, implements circuit breakers,
 * computes health scores, and provides recommendations for the autonomous session loop.
 *
 * All state is in-memory (Map-based) for minimal overhead. Designed to be opt-in
 * via ENABLE_SELF_HEALING env var (default true since it's non-destructive).
 */

import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { AgentRole } from "@ai-cofounder/shared";

const logger = createLogger("self-healing");

// ── Types ──

export interface FailureRecord {
  agentRole: AgentRole;
  toolName?: string;
  errorCategory: string;
  errorMessage: string;
  taskCategory?: string;
  timestamp: Date;
}

export interface CircuitBreakerState {
  status: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureAt: Date | null;
  openedAt: Date | null;
  successCount: number;
}

export interface AgentHealthScore {
  agentRole: AgentRole;
  score: number; // 0-100
  recentSuccesses: number;
  recentFailures: number;
  circuitBreaker: CircuitBreakerState;
}

export interface FailurePattern {
  key: string; // e.g. "coder:timeout" or "git_push:connection"
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  samples: string[]; // up to 3 error message samples
}

export interface SelfHealingRecommendation {
  action: "skip" | "escalate" | "pause_sessions" | "disable_tool" | "proceed";
  reason: string;
  agentRole?: AgentRole;
  toolName?: string;
}

export interface SelfHealingReport {
  healthScores: AgentHealthScore[];
  activeCircuitBreakers: Array<{ agentRole: AgentRole; state: CircuitBreakerState }>;
  systematicFailures: FailurePattern[];
  recommendations: string[];
  generatedAt: Date;
}

export interface SelfHealingStatus {
  enabled: boolean;
  healthScores: AgentHealthScore[];
  circuitBreakers: Record<string, CircuitBreakerState>;
  recentFailurePatterns: FailurePattern[];
  recommendations: string[];
  totalFailuresTracked: number;
  oldestRecord: Date | null;
}

// ── Constants ──

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_HALF_OPEN_MS = 5 * 60 * 1000; // 5 minutes
const ROLLING_WINDOW_SIZE = 20;
const SYSTEMATIC_THRESHOLD = 3;
const SYSTEMATIC_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const CONSECUTIVE_FAILURE_ESCALATE = 2;
const CONSECUTIVE_FAILURE_SKIP = 3;
const MAX_FAILURE_RECORDS = 500; // Cap in-memory records

// ── Service ──

export class SelfHealingService {
  private failures: FailureRecord[] = [];
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private rollingResults = new Map<string, Array<{ success: boolean; timestamp: Date }>>();
  private consecutiveFailures = new Map<string, number>(); // key: taskType or agentRole

  constructor() {
    logger.info("self-healing service initialized");
  }

  // ── Failure Recording ──

  recordFailure(record: FailureRecord): void {
    this.failures.push(record);

    // Cap in-memory records
    if (this.failures.length > MAX_FAILURE_RECORDS) {
      this.failures = this.failures.slice(-MAX_FAILURE_RECORDS);
    }

    // Update rolling results
    this.pushRollingResult(record.agentRole, false);

    // Update consecutive failures
    const consecutiveKey = `${record.agentRole}:${record.taskCategory ?? "general"}`;
    const current = this.consecutiveFailures.get(consecutiveKey) ?? 0;
    this.consecutiveFailures.set(consecutiveKey, current + 1);

    // Update circuit breaker
    this.recordCircuitBreakerFailure(record.agentRole);

    logger.debug(
      { agentRole: record.agentRole, errorCategory: record.errorCategory, toolName: record.toolName },
      "failure recorded",
    );
  }

  recordSuccess(agentRole: AgentRole, taskCategory?: string): void {
    this.pushRollingResult(agentRole, true);

    // Reset consecutive failures for this agent+category
    const consecutiveKey = `${agentRole}:${taskCategory ?? "general"}`;
    this.consecutiveFailures.set(consecutiveKey, 0);

    // Update circuit breaker on success
    this.recordCircuitBreakerSuccess(agentRole);
  }

  // ── Pre-execution Check ──

  checkBeforeExecution(
    agentRole: AgentRole,
    taskCategory?: string,
  ): SelfHealingRecommendation {
    // Check circuit breaker
    const cb = this.getCircuitBreakerState(agentRole);
    if (cb.status === "open") {
      // Check if enough time has passed to go half-open
      if (cb.openedAt && Date.now() - cb.openedAt.getTime() >= CIRCUIT_BREAKER_HALF_OPEN_MS) {
        this.transitionToHalfOpen(agentRole);
        return {
          action: "proceed",
          reason: `Circuit breaker for ${agentRole} is half-open — allowing one test execution`,
          agentRole,
        };
      }
      return {
        action: "skip",
        reason: `Circuit breaker OPEN for ${agentRole} (${cb.failureCount} consecutive failures). Waiting for cooldown.`,
        agentRole,
      };
    }

    // Check consecutive failures for escalation
    const consecutiveKey = `${agentRole}:${taskCategory ?? "general"}`;
    const consecutive = this.consecutiveFailures.get(consecutiveKey) ?? 0;

    if (consecutive >= CONSECUTIVE_FAILURE_SKIP) {
      return {
        action: "skip",
        reason: `${consecutive} consecutive failures for ${agentRole} on ${taskCategory ?? "general"} tasks. Skipping to avoid wasting tokens.`,
        agentRole,
      };
    }

    if (consecutive >= CONSECUTIVE_FAILURE_ESCALATE) {
      return {
        action: "escalate",
        reason: `${consecutive} consecutive failures for ${agentRole}. Consider escalating to a higher-tier agent.`,
        agentRole,
      };
    }

    // Check if all providers seem down (systematic LLM failure)
    const recentLlmFailures = this.failures.filter(
      (f) =>
        f.errorCategory === "rate_limit" || f.errorCategory === "connection" || f.errorCategory === "server_error",
    ).filter((f) => Date.now() - f.timestamp.getTime() < 10 * 60 * 1000); // last 10 min

    const uniqueAgentsFailing = new Set(recentLlmFailures.map((f) => f.agentRole));
    if (uniqueAgentsFailing.size >= 3 && recentLlmFailures.length >= 5) {
      return {
        action: "pause_sessions",
        reason: "Multiple agents experiencing LLM provider failures. Consider pausing autonomous sessions until providers recover.",
      };
    }

    return { action: "proceed", reason: "No known issues" };
  }

  // ── Circuit Breaker ──

  private getCircuitBreakerState(agentRole: AgentRole): CircuitBreakerState {
    return this.circuitBreakers.get(agentRole) ?? {
      status: "closed",
      failureCount: 0,
      lastFailureAt: null,
      openedAt: null,
      successCount: 0,
    };
  }

  private recordCircuitBreakerFailure(agentRole: AgentRole): void {
    const state = this.getCircuitBreakerState(agentRole);
    state.failureCount++;
    state.lastFailureAt = new Date();
    state.successCount = 0;

    if (state.failureCount >= CIRCUIT_BREAKER_THRESHOLD && state.status === "closed") {
      state.status = "open";
      state.openedAt = new Date();
      logger.warn({ agentRole, failureCount: state.failureCount }, "circuit breaker OPENED");
    }

    // If half-open and we get another failure, go back to open
    if (state.status === "half-open") {
      state.status = "open";
      state.openedAt = new Date();
      logger.warn({ agentRole }, "circuit breaker re-opened from half-open state");
    }

    this.circuitBreakers.set(agentRole, state);
  }

  private recordCircuitBreakerSuccess(agentRole: AgentRole): void {
    const state = this.getCircuitBreakerState(agentRole);
    state.successCount++;

    if (state.status === "half-open") {
      // Success in half-open → close
      state.status = "closed";
      state.failureCount = 0;
      state.openedAt = null;
      logger.info({ agentRole }, "circuit breaker CLOSED (success in half-open state)");
    } else if (state.status === "closed" && state.failureCount > 0) {
      // Gradual recovery: reduce failure count on success
      state.failureCount = Math.max(0, state.failureCount - 1);
    }

    this.circuitBreakers.set(agentRole, state);
  }

  private transitionToHalfOpen(agentRole: AgentRole): void {
    const state = this.getCircuitBreakerState(agentRole);
    state.status = "half-open";
    this.circuitBreakers.set(agentRole, state);
    logger.info({ agentRole }, "circuit breaker transitioned to HALF-OPEN");
  }

  // ── Rolling Window Health Score ──

  private pushRollingResult(agentRole: AgentRole, success: boolean): void {
    const key = agentRole;
    const results = this.rollingResults.get(key) ?? [];
    results.push({ success, timestamp: new Date() });

    // Keep only the last ROLLING_WINDOW_SIZE results
    if (results.length > ROLLING_WINDOW_SIZE) {
      results.splice(0, results.length - ROLLING_WINDOW_SIZE);
    }

    this.rollingResults.set(key, results);
  }

  getHealthScore(agentRole: AgentRole): AgentHealthScore {
    const results = this.rollingResults.get(agentRole) ?? [];
    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).length;
    const total = results.length;
    const score = total > 0 ? Math.round((successes / total) * 100) : 100; // Default to healthy

    return {
      agentRole,
      score,
      recentSuccesses: successes,
      recentFailures: failures,
      circuitBreaker: this.getCircuitBreakerState(agentRole),
    };
  }

  getAllHealthScores(): AgentHealthScore[] {
    const roles: AgentRole[] = ["researcher", "coder", "reviewer", "planner", "debugger", "doc_writer"];
    return roles.map((role) => this.getHealthScore(role));
  }

  // ── Pattern Detection ──

  detectSystematicFailures(): FailurePattern[] {
    const now = Date.now();
    const recentFailures = this.failures.filter(
      (f) => now - f.timestamp.getTime() < SYSTEMATIC_WINDOW_MS,
    );

    // Group by pattern key
    const groups = new Map<string, FailureRecord[]>();
    for (const f of recentFailures) {
      const key = f.toolName
        ? `${f.agentRole}:${f.toolName}:${f.errorCategory}`
        : `${f.agentRole}:${f.errorCategory}`;
      const group = groups.get(key) ?? [];
      group.push(f);
      groups.set(key, group);
    }

    // Filter to systematic patterns (3+ occurrences)
    const patterns: FailurePattern[] = [];
    for (const [key, records] of groups) {
      if (records.length >= SYSTEMATIC_THRESHOLD) {
        patterns.push({
          key,
          count: records.length,
          firstSeen: records[0].timestamp,
          lastSeen: records[records.length - 1].timestamp,
          samples: records.slice(0, 3).map((r) => r.errorMessage.slice(0, 200)),
        });
      }
    }

    return patterns.sort((a, b) => b.count - a.count);
  }

  // ── Reporting ──

  generateReport(): SelfHealingReport {
    const healthScores = this.getAllHealthScores();
    const systematicFailures = this.detectSystematicFailures();

    const activeCircuitBreakers = Array.from(this.circuitBreakers.entries())
      .filter(([, state]) => state.status !== "closed")
      .map(([agentRole, state]) => ({ agentRole: agentRole as AgentRole, state }));

    const recommendations: string[] = [];

    // Degraded agents
    for (const hs of healthScores) {
      if (hs.score < 50 && (hs.recentSuccesses + hs.recentFailures) >= 5) {
        recommendations.push(
          `Agent "${hs.agentRole}" is degraded (health ${hs.score}%). Consider investigating root cause.`,
        );
      }
    }

    // Systematic failures
    for (const pattern of systematicFailures.slice(0, 3)) {
      recommendations.push(
        `Systematic failure: "${pattern.key}" occurred ${pattern.count} times in 24h. Sample: ${pattern.samples[0]?.slice(0, 100) ?? "unknown"}`,
      );
    }

    // Open circuit breakers
    for (const cb of activeCircuitBreakers) {
      recommendations.push(
        `Circuit breaker ${cb.state.status.toUpperCase()} for "${cb.agentRole}" — ${cb.state.failureCount} failures.`,
      );
    }

    return {
      healthScores,
      activeCircuitBreakers,
      systematicFailures,
      recommendations,
      generatedAt: new Date(),
    };
  }

  // ── Status (for REST endpoint) ──

  getStatus(): SelfHealingStatus {
    const circuitBreakers: Record<string, CircuitBreakerState> = {};
    for (const [key, state] of this.circuitBreakers) {
      circuitBreakers[key] = state;
    }

    const oldest = this.failures.length > 0 ? this.failures[0].timestamp : null;

    return {
      enabled: optionalEnv("ENABLE_SELF_HEALING", "true") === "true",
      healthScores: this.getAllHealthScores(),
      circuitBreakers,
      recentFailurePatterns: this.detectSystematicFailures(),
      recommendations: this.generateReport().recommendations,
      totalFailuresTracked: this.failures.length,
      oldestRecord: oldest,
    };
  }

  // ── Error Categorization (reuses pattern from FailurePatternService) ──

  static categorizeError(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
    if (lower.includes("econnrefused") || lower.includes("econnreset")) return "connection";
    if (lower.includes("rate limit") || lower.includes("429")) return "rate_limit";
    if (lower.includes("permission") || lower.includes("403") || lower.includes("unauthorized")) return "permission";
    if (lower.includes("not found") || lower.includes("404")) return "not_found";
    if (lower.includes("500") || lower.includes("internal server")) return "server_error";
    if (lower.includes("out of memory") || lower.includes("oom")) return "resource";
    return "unknown";
  }
}
