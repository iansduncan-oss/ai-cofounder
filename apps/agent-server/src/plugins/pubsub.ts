import { EventEmitter } from "node:events";
import fp from "fastify-plugin";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  getRedisConnection,
  createSubscriber,
  goalChannel,
  subagentChannel,
  RedisPubSub,
  type AgentEvent,
} from "@ai-cofounder/queue";

// Augment Fastify types for pub/sub decorators
declare module "fastify" {
  interface FastifyInstance {
    agentEvents: EventEmitter;
    subscribeGoal: (goalId: string) => Promise<void>;
    unsubscribeGoal: (goalId: string) => Promise<void>;
    subscribeSubagent: (subagentRunId: string) => Promise<void>;
    unsubscribeSubagent: (subagentRunId: string) => Promise<void>;
    redisPubSub: RedisPubSub;
  }
}

const logger = createLogger("pubsub-plugin");

export const pubsubPlugin = fp(async (app) => {
  const redisUrl = optionalEnv("REDIS_URL", "");

  if (!redisUrl) {
    logger.warn("REDIS_URL not set — pubsub system disabled (no-op decorators registered)");

    // No-op decorators so routes don't need to guard against undefined
    const noopEmitter = new EventEmitter();
    noopEmitter.setMaxListeners(200);

    app.decorate("agentEvents", noopEmitter);
    app.decorate("subscribeGoal", async (_goalId: string) => {});
    app.decorate("unsubscribeGoal", async (_goalId: string) => {});
    app.decorate("subscribeSubagent", async (_subagentRunId: string) => {});
    app.decorate("unsubscribeSubagent", async (_subagentRunId: string) => {});
    app.decorate("redisPubSub", {
      publish: async () => {},
      getHistory: async () => [] as AgentEvent[],
      publishSubagent: async () => {},
      getSubagentHistory: async () => [],
      close: async () => {},
    } as unknown as RedisPubSub);

    return;
  }

  // Shared EventEmitter — routes listen on per-goal channels
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);

  // Dedicated subscriber connection (Redis protocol: subscribe mode is exclusive)
  const connection = getRedisConnection(redisUrl);
  const subscriber = createSubscriber(connection);

  // Publisher / history reader
  const redisPubSub = new RedisPubSub(connection);

  // Route all incoming pub/sub messages to the EventEmitter
  subscriber.on("message", (channel: string, message: string) => {
    emitter.emit(channel, message);
  });

  /**
   * Subscribe to a goal's Redis channel if this is the first listener.
   * Reference-counted: Redis subscribe only on first SSE client for a given goal.
   */
  async function subscribeGoal(goalId: string): Promise<void> {
    const channel = goalChannel(goalId);
    if (emitter.listenerCount(channel) === 0) {
      await subscriber.subscribe(channel);
      logger.info({ goalId, channel }, "subscribed to goal channel");
    }
  }

  /**
   * Unsubscribe from a goal's Redis channel when the last listener disconnects.
   * Reference-counted: Redis unsubscribe only when last SSE client disconnects.
   */
  async function unsubscribeGoal(goalId: string): Promise<void> {
    const channel = goalChannel(goalId);
    if (emitter.listenerCount(channel) === 0) {
      try {
        await subscriber.unsubscribe(channel);
        logger.info({ goalId, channel }, "unsubscribed from goal channel");
      } catch (err) {
        logger.warn({ goalId, err }, "failed to unsubscribe from goal channel (non-fatal)");
      }
    }
  }

  async function subscribeSubagent(subagentRunId: string): Promise<void> {
    const channel = subagentChannel(subagentRunId);
    if (emitter.listenerCount(channel) === 0) {
      await subscriber.subscribe(channel);
      logger.info({ subagentRunId, channel }, "subscribed to subagent channel");
    }
  }

  async function unsubscribeSubagent(subagentRunId: string): Promise<void> {
    const channel = subagentChannel(subagentRunId);
    if (emitter.listenerCount(channel) === 0) {
      try {
        await subscriber.unsubscribe(channel);
        logger.info({ subagentRunId, channel }, "unsubscribed from subagent channel");
      } catch (err) {
        logger.warn({ subagentRunId, err }, "failed to unsubscribe from subagent channel (non-fatal)");
      }
    }
  }

  app.decorate("agentEvents", emitter);
  app.decorate("subscribeGoal", subscribeGoal);
  app.decorate("unsubscribeGoal", unsubscribeGoal);
  app.decorate("subscribeSubagent", subscribeSubagent);
  app.decorate("unsubscribeSubagent", unsubscribeSubagent);
  app.decorate("redisPubSub", redisPubSub);

  app.addHook("onClose", async () => {
    await subscriber.quit();
    await redisPubSub.close();
    logger.info("pubsub connections closed");
  });

  logger.info("pubsub plugin initialized");
});
