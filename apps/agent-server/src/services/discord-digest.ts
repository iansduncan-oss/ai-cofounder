import Redis from "ioredis";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { TriageCategory } from "./discord-triage.js";

const logger = createLogger("discord-digest");

const REDIS_KEY_PREFIX = "discord-digest";

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const url = optionalEnv("REDIS_URL", "redis://localhost:6379");
    redisClient = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return redisClient;
}

export interface DigestItem {
  channelName: string;
  summary: string;
  category: TriageCategory;
  suggestedAction: string;
  urgency: string;
  timestamp: string;
}

export class DiscordDigestService {
  private getKey(bucket: "hourly" | "daily"): string {
    return `${REDIS_KEY_PREFIX}:${bucket}`;
  }

  async accumulate(bucket: "hourly" | "daily", item: DigestItem): Promise<void> {
    const redis = getRedis();
    await redis.rpush(this.getKey(bucket), JSON.stringify(item));
    logger.debug({ bucket, channelName: item.channelName }, "digest item accumulated");
  }

  async flush(bucket: "hourly" | "daily"): Promise<DigestItem[]> {
    const redis = getRedis();
    const key = this.getKey(bucket);
    const raw = await redis.lrange(key, 0, -1);
    if (raw.length === 0) return [];
    await redis.del(key);
    return raw.map((r: string) => JSON.parse(r) as DigestItem);
  }

  async peek(bucket: "hourly" | "daily"): Promise<DigestItem[]> {
    const redis = getRedis();
    const raw = await redis.lrange(this.getKey(bucket), 0, -1);
    return raw.map((r: string) => JSON.parse(r) as DigestItem);
  }

  formatDigest(items: DigestItem[]): { text: string; blocks: object[] } {
    const byChannel = new Map<string, DigestItem[]>();
    for (const item of items) {
      const list = byChannel.get(item.channelName) ?? [];
      list.push(item);
      byChannel.set(item.channelName, list);
    }

    const channelCount = byChannel.size;
    const text = `Discord digest: ${items.length} item${items.length === 1 ? "" : "s"} across ${channelCount} channel${channelCount === 1 ? "" : "s"}`;

    const blocks: object[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `Your Discord digest, sir — ${items.length} item${items.length === 1 ? "" : "s"}` },
      },
    ];

    for (const [channel, channelItems] of byChannel) {
      const summaries = channelItems
        .map((item) => {
          const urgencyDot = { high: "🔴", medium: "🟡", low: "🟢" }[item.urgency] ?? "⚪";
          const action = item.suggestedAction ? `\n    _${item.suggestedAction}_` : "";
          return `${urgencyDot} ${item.summary}${action}`;
        })
        .join("\n");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*#${channel}*\n${summaries}`,
        },
      });
    }

    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `_Jarvis · ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}_`,
      }],
    });

    return { text, blocks };
  }
}
