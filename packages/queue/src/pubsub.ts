// packages/queue/src/pubsub.ts
// Redis pub/sub infrastructure for real-time agent progress events.
// RedisPubSub publishes events and maintains history for late-joining SSE clients.

import Redis from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("pubsub");

// ── Constants ──

export const CHANNEL_PREFIX = "agent-events:goal:";
export const HISTORY_PREFIX = "agent-events:history:";
export const HISTORY_TTL_SECONDS = 3600; // 1 hour

// ── Types ──

/** Task-level progress event (emitted on task start/complete/fail) */
export interface AgentProgressEvent {
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskTitle: string;
  agent: string;
  status: "started" | "completed" | "failed";
  completedTasks: number;
  totalTasks: number;
  output?: string;
  timestamp: number;
}

/** Job-level lifecycle event (emitted at worker boundary) */
export interface AgentLifecycleEvent {
  goalId: string;
  type: "job_started" | "job_completed" | "job_failed";
  timestamp: number;
  error?: string;
}

/** Union of both event types */
export type AgentEvent = AgentProgressEvent | AgentLifecycleEvent;

// ── Helper functions ──

/** Returns the Redis pub/sub channel name for a given goal */
export function goalChannel(goalId: string): string {
  return `${CHANNEL_PREFIX}${goalId}`;
}

/** Returns the Redis LIST key for storing event history for a given goal */
export function historyKey(goalId: string): string {
  return `${HISTORY_PREFIX}${goalId}`;
}

// ── RedisPubSub class ──

/**
 * Manages publishing agent progress events to Redis pub/sub channels.
 * Also maintains a Redis LIST of events for late-joining SSE clients to catch up.
 *
 * Uses a dedicated ioredis connection (separate from BullMQ's connections)
 * to avoid protocol conflicts. Call createSubscriber() for the subscribe side.
 */
export class RedisPubSub {
  private publisher: Redis;

  constructor(connectionOptions: ConnectionOptions) {
    this.publisher = new Redis({
      host: (connectionOptions as { host?: string }).host ?? "localhost",
      port: (connectionOptions as { port?: number }).port ?? 6379,
      password: (connectionOptions as { password?: string }).password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.publisher.on("error", (err) => {
      logger.error({ err }, "RedisPubSub publisher error");
    });
  }

  /**
   * Publish an event to the goal's pub/sub channel and append to history LIST.
   * History LIST is set with TTL to allow late-joining SSE clients to catch up.
   */
  async publish(goalId: string, event: AgentEvent): Promise<void> {
    const channel = goalChannel(goalId);
    const key = historyKey(goalId);
    const payload = JSON.stringify(event);

    await Promise.all([
      this.publisher.publish(channel, payload),
      this.publisher.rpush(key, payload),
      this.publisher.expire(key, HISTORY_TTL_SECONDS),
    ]);
  }

  /**
   * Retrieve all stored events for a goal (for late-joining SSE clients).
   * Returns parsed AgentEvent objects in insertion order.
   */
  async getHistory(goalId: string): Promise<AgentEvent[]> {
    const key = historyKey(goalId);
    const items = await this.publisher.lrange(key, 0, -1);
    return items.map((item) => JSON.parse(item) as AgentEvent);
  }

  /** Close the publisher connection cleanly */
  async close(): Promise<void> {
    await this.publisher.quit();
  }
}

// ── Subscriber factory ──

/**
 * Create a separate ioredis subscriber connection.
 * Redis protocol requires dedicated connections for subscribe mode —
 * you cannot mix publish/subscribe on the same connection as regular commands.
 */
export function createSubscriber(connectionOptions: ConnectionOptions): Redis {
  const subscriber = new Redis({
    host: (connectionOptions as { host?: string }).host ?? "localhost",
    port: (connectionOptions as { port?: number }).port ?? 6379,
    password: (connectionOptions as { password?: string }).password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  subscriber.on("error", (err) => {
    logger.error({ err }, "RedisPubSub subscriber error");
  });

  return subscriber;
}
