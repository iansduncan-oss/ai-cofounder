import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getDeployCircuitBreaker,
  upsertDeployCircuitBreaker,
  resetCircuitBreaker,
  getRecentFailedDeployments,
} from "@ai-cofounder/db";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("deploy-circuit-breaker");

export interface CircuitBreakerStatus {
  isPaused: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  failureCount: number;
  failureWindowStart: string | null;
  resumedAt: string | null;
  resumedBy: string | null;
}

/**
 * DeployCircuitBreakerService — pauses auto-deploys after repeated failures.
 *
 * Tracks deploy failures in the DB (unlike CiSelfHealService which uses Redis,
 * since deploys are less frequent and benefit from persistence).
 *
 * Threshold: 3 failures within a 4-hour window triggers pause.
 */
export class DeployCircuitBreakerService {
  private readonly FAILURE_THRESHOLD = 3;
  private readonly WINDOW_HOURS = 4;

  constructor(
    private readonly db: Db,
    private readonly notificationService: NotificationService,
  ) {}

  async recordFailure(commitSha: string, errorSummary?: string): Promise<void> {
    const state = await getDeployCircuitBreaker(this.db);
    const now = new Date();

    // Reset window if it has expired
    let failureCount = (state?.failureCount ?? 0) + 1;
    let windowStart = state?.failureWindowStart ?? now;

    if (state?.failureWindowStart) {
      const windowAge = now.getTime() - new Date(state.failureWindowStart).getTime();
      if (windowAge > this.WINDOW_HOURS * 60 * 60 * 1000) {
        // Window expired, start fresh
        failureCount = 1;
        windowStart = now;
      }
    }

    const shouldPause = failureCount >= this.FAILURE_THRESHOLD && !state?.isPaused;

    await upsertDeployCircuitBreaker(this.db, {
      isPaused: shouldPause || (state?.isPaused ?? false),
      pausedAt: shouldPause ? now : (state?.pausedAt ?? null),
      pausedReason: shouldPause
        ? `${failureCount} deploy failures in ${this.WINDOW_HOURS}h window (last: ${commitSha.slice(0, 7)})`
        : (state?.pausedReason ?? null),
      failureCount,
      failureWindowStart: windowStart,
    });

    logger.info({ commitSha: commitSha.slice(0, 7), failureCount, shouldPause }, "deploy failure recorded");

    if (shouldPause) {
      const message = [
        `**Deploy Circuit Breaker Activated**`,
        `Auto-deploys have been paused after ${failureCount} consecutive failures within ${this.WINDOW_HOURS}h.`,
        `Last failing commit: \`${commitSha.slice(0, 7)}\``,
        errorSummary ? `Error: ${errorSummary}` : "",
        ``,
        `Resume manually via \`POST /api/deploys/circuit-breaker/resume\` or the dashboard.`,
      ].filter(Boolean).join("\n");

      await this.notificationService.sendBriefing(message).catch((err) => logger.warn({ err }, "circuit breaker notification failed"));
    }
  }

  async isDeployPaused(): Promise<boolean> {
    const state = await getDeployCircuitBreaker(this.db);
    if (!state?.isPaused) return false;

    // Check if window has expired since pause
    if (state.failureWindowStart) {
      const windowAge = Date.now() - new Date(state.failureWindowStart).getTime();
      if (windowAge > this.WINDOW_HOURS * 60 * 60 * 1000) {
        // Auto-resume: window expired
        await resetCircuitBreaker(this.db, "auto-expired");
        logger.info("circuit breaker auto-resumed: failure window expired");
        return false;
      }
    }

    return true;
  }

  async resume(resumedBy?: string): Promise<void> {
    await resetCircuitBreaker(this.db, resumedBy);
    logger.info({ resumedBy }, "circuit breaker resumed");

    await this.notificationService.sendBriefing(
      `**Deploy Circuit Breaker Resumed**\nAuto-deploys have been re-enabled${resumedBy ? ` by ${resumedBy}` : ""}.`,
    ).catch((err) => logger.warn({ err }, "circuit breaker event write failed"));
  }

  async getStatus(): Promise<CircuitBreakerStatus> {
    const state = await getDeployCircuitBreaker(this.db);
    if (!state) {
      return {
        isPaused: false,
        pausedAt: null,
        pausedReason: null,
        failureCount: 0,
        failureWindowStart: null,
        resumedAt: null,
        resumedBy: null,
      };
    }

    // Also check window expiry for accurate status
    if (state.isPaused && state.failureWindowStart) {
      const windowAge = Date.now() - new Date(state.failureWindowStart).getTime();
      if (windowAge > this.WINDOW_HOURS * 60 * 60 * 1000) {
        await resetCircuitBreaker(this.db, "auto-expired");
        return {
          isPaused: false,
          pausedAt: null,
          pausedReason: null,
          failureCount: 0,
          failureWindowStart: null,
          resumedAt: new Date().toISOString(),
          resumedBy: "auto-expired",
        };
      }
    }

    return {
      isPaused: state.isPaused,
      pausedAt: state.pausedAt?.toISOString() ?? null,
      pausedReason: state.pausedReason,
      failureCount: state.failureCount,
      failureWindowStart: state.failureWindowStart?.toISOString() ?? null,
      resumedAt: state.resumedAt?.toISOString() ?? null,
      resumedBy: state.resumedBy,
    };
  }

  async getRecentFailures(windowHours?: number) {
    return getRecentFailedDeployments(this.db, windowHours ?? this.WINDOW_HOURS);
  }
}
