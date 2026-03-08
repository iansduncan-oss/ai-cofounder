import { createLogger } from "@ai-cofounder/shared";
import { type ConnectionOptions } from "bullmq";

const logger = createLogger("queue");

let connectionOptions: ConnectionOptions | null = null;

export function getRedisConnection(url?: string): ConnectionOptions {
  if (connectionOptions) return connectionOptions;

  const redisUrl = url ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(redisUrl);

  connectionOptions = {
    host: parsed.hostname || "localhost",
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 500, 5000);
      logger.warn({ attempt: times, delay }, "Redis reconnecting");
      return delay;
    },
  };

  logger.info({ host: parsed.hostname, port: parsed.port }, "Redis connection configured");
  return connectionOptions;
}

export function resetRedisConnection(): void {
  connectionOptions = null;
}
