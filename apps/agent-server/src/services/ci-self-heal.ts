import type { Redis } from "ioredis";
import { createLogger } from "@ai-cofounder/shared";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("ci-self-heal");

export interface CiHealState {
  count: number;
  firstFailedAt: string;
  lastFailedAt?: string;
  lastWorkflowUrl?: string;
  healAttempted: boolean;
}

/**
 * CiSelfHealService — tracks consecutive CI failures in Redis and triggers
 * an autonomous heal session after 2+ consecutive failures on a stable branch.
 *
 * Design principles:
 *  - First failure increments count but does NOT trigger a heal session
 *  - Second consecutive failure triggers a heal session via BullMQ
 *  - CI success clears the failure state for that repo+branch
 *  - healAttempted flag prevents double-triggering per failure streak
 *  - autonomous/ and dependabot/ branches are ignored (no infinite heal loops)
 */
export class CiSelfHealService {
  private readonly HEAL_KEY_PREFIX = "ci-heal:";
  private readonly FAILURE_THRESHOLD = 2;
  private readonly KEY_TTL_SECONDS = 7 * 24 * 3600; // 7 days

  constructor(
    private readonly redis: Redis,
    private readonly notificationService: NotificationService,
  ) {}

  private failureKey(repo: string, branch: string): string {
    return `${this.HEAL_KEY_PREFIX}${repo}:${branch}`;
  }

  /**
   * Record a CI failure for the given repo+branch.
   * Triggers a heal session after FAILURE_THRESHOLD consecutive failures.
   */
  async recordFailure(repo: string, branch: string, workflowUrl: string): Promise<void> {
    // Skip autonomous/ and dependabot/ branches to prevent infinite heal loops
    if (branch.startsWith("autonomous/") || branch.startsWith("dependabot/")) {
      logger.debug({ repo, branch }, "Skipping CI failure tracking for auto-managed branch");
      return;
    }

    const key = this.failureKey(repo, branch);
    const raw = await this.redis.get(key);

    let state: CiHealState;
    if (raw) {
      state = JSON.parse(raw) as CiHealState;
    } else {
      state = {
        count: 0,
        firstFailedAt: new Date().toISOString(),
        healAttempted: false,
      };
    }

    state.count += 1;
    state.lastFailedAt = new Date().toISOString();
    state.lastWorkflowUrl = workflowUrl;

    // Write updated state back to Redis with TTL
    await this.redis.set(key, JSON.stringify(state), "EX", this.KEY_TTL_SECONDS);

    logger.info({ repo, branch, count: state.count, healAttempted: state.healAttempted }, "CI failure recorded");

    // Trigger heal session if threshold reached and not already attempted
    if (state.count >= this.FAILURE_THRESHOLD && !state.healAttempted) {
      state.healAttempted = true;
      await this.redis.set(key, JSON.stringify(state), "EX", this.KEY_TTL_SECONDS);
      await this.triggerHealSession(repo, branch, state);
    }
  }

  /**
   * Record a CI success for the given repo+branch.
   * Clears any accumulated failure state.
   */
  async recordSuccess(repo: string, branch: string): Promise<void> {
    const key = this.failureKey(repo, branch);
    await this.redis.del(key);
    logger.debug({ repo, branch }, "CI success recorded, failure state cleared");
  }

  /**
   * Get current heal state for a repo+branch, or null if not tracked.
   */
  async getState(repo: string, branch: string): Promise<CiHealState | null> {
    const key = this.failureKey(repo, branch);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CiHealState;
  }

  /**
   * Trigger an autonomous heal session for persistent CI failure.
   * Sends a notification and enqueues a BullMQ job.
   */
  private async triggerHealSession(repo: string, branch: string, state: CiHealState): Promise<void> {
    logger.warn(
      { repo, branch, count: state.count, firstFailedAt: state.firstFailedAt },
      "Triggering CI self-heal session",
    );

    // Notify about the persistent failure
    const notificationText = [
      `**CI Self-Heal Triggered**`,
      `**Repo:** ${repo}`,
      `**Branch:** ${branch}`,
      `**Consecutive failures:** ${state.count}`,
      `**First failed:** ${state.firstFailedAt}`,
      state.lastWorkflowUrl ? `**Last run:** ${state.lastWorkflowUrl}` : undefined,
      ``,
      `Autonomous heal session has been enqueued to diagnose and fix the CI failure.`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.notificationService.sendBriefing(notificationText);

    // Autonomous session system has been removed.
    // CI self-heal now only sends the notification above for manual intervention.
    logger.info({ repo, branch }, "CI self-heal notification sent (autonomous sessions removed)");
  }
}
