import type { Client, Message } from "discord.js";
import { Events } from "discord.js";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("message-watcher");

interface BufferedMessage {
  messageId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: string;
  hasAttachments: boolean;
  referencedMessageId?: string;
}

const buffer = new Map<string, { channelName: string; messages: BufferedMessage[] }>();

let flushTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
let isBackedOff = false;
const MAX_BACKOFF_MS = 600_000; // 10 min

function getChannelAllowlist(): Set<string> {
  const raw = optionalEnv("DISCORD_WATCHER_CHANNEL_ALLOWLIST", "");
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function getChannelBlocklist(): Set<string> {
  const raw = optionalEnv("DISCORD_WATCHER_CHANNEL_BLOCKLIST", "");
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function shouldIgnore(message: Message, allowlist: Set<string>, blocklist: Set<string>): boolean {
  if (message.author.bot) return true;
  if (message.system) return true;
  if (!message.content && message.attachments.size === 0) return true;
  if (blocklist.has(message.channelId)) return true;
  if (allowlist.size > 0 && !allowlist.has(message.channelId)) return true;
  return false;
}

async function flushAll(): Promise<void> {
  if (buffer.size === 0) return;

  const baseUrl = optionalEnv("AGENT_SERVER_URL", "http://localhost:3100");
  const apiSecret = process.env.API_SECRET || "";
  const guildId = optionalEnv("DISCORD_GUILD_ID", "");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiSecret) {
    headers["Authorization"] = `Bearer ${apiSecret}`;
  }

  // Snapshot entries but don't clear — re-insert failures
  const entries = [...buffer.entries()];
  buffer.clear();

  let hadFailure = false;

  for (const [channelId, { channelName, messages }] of entries) {
    if (messages.length === 0) continue;

    try {
      const res = await fetch(`${baseUrl}/api/discord-watcher/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channelId, channelName, guildId, messages }),
      });

      if (res.ok) {
        logger.debug(
          { channelId, channelName, messageCount: messages.length },
          "flushed message batch to agent server",
        );
      } else {
        hadFailure = true;
        // Re-insert failed messages back into buffer
        const existing = buffer.get(channelId);
        if (existing) {
          existing.messages.unshift(...messages);
        } else {
          buffer.set(channelId, { channelName, messages });
        }
        logger.warn(
          { channelId, status: res.status },
          "agent server rejected message batch — messages re-buffered",
        );
      }
    } catch (err) {
      hadFailure = true;
      // Re-insert failed messages back into buffer
      const existing = buffer.get(channelId);
      if (existing) {
        existing.messages.unshift(...messages);
      } else {
        buffer.set(channelId, { channelName, messages });
      }
      logger.warn(
        { err, channelId },
        "failed to flush message batch — messages re-buffered",
      );
    }
  }

  if (hadFailure) {
    consecutiveFailures++;
  } else {
    consecutiveFailures = 0;
  }

  // Exponential backoff on repeated failures
  if (consecutiveFailures > 3 && flushTimer && !isBackedOff) {
    const backoffMs = Math.min(
      getFlushInterval() * Math.pow(2, consecutiveFailures - 3),
      MAX_BACKOFF_MS,
    );
    clearInterval(flushTimer);
    flushTimer = setInterval(() => void flushAll(), backoffMs);
    isBackedOff = true;
    logger.warn({ backoffMs }, "backing off flush interval due to consecutive failures");
  }

  // Restore normal interval on recovery
  if (consecutiveFailures === 0 && isBackedOff && flushTimer) {
    const normalMs = getFlushInterval();
    clearInterval(flushTimer);
    flushTimer = setInterval(() => void flushAll(), normalMs);
    isBackedOff = false;
    logger.info({ intervalMs: normalMs }, "flush interval restored to normal after recovery");
  }
}

function getFlushInterval(): number {
  return parseInt(optionalEnv("DISCORD_WATCHER_BATCH_INTERVAL_MS", "120000"), 10);
}

function getMaxMessagesPerBatch(): number {
  return parseInt(optionalEnv("DISCORD_WATCHER_MAX_MESSAGES_PER_BATCH", "100"), 10);
}

export function setupMessageWatcher(client: Client): void {
  const allowlist = getChannelAllowlist();
  const blocklist = getChannelBlocklist();
  const maxPerBatch = getMaxMessagesPerBatch();

  client.on(Events.MessageCreate, (message: Message) => {
    if (shouldIgnore(message, allowlist, blocklist)) return;

    const channelId = message.channelId;
    const channelName = "name" in message.channel ? (message.channel.name ?? channelId) : channelId;

    if (!buffer.has(channelId)) {
      buffer.set(channelId, { channelName, messages: [] });
    }

    const entry = buffer.get(channelId)!;

    // Cap per-channel buffer
    if (entry.messages.length >= maxPerBatch) {
      logger.debug({ channelId, channelName }, "channel buffer full, dropping oldest message");
      entry.messages.shift();
    }

    entry.messages.push({
      messageId: message.id,
      channelId,
      channelName,
      authorId: message.author.id,
      authorName: message.author.displayName ?? message.author.username,
      content: message.content,
      timestamp: message.createdAt.toISOString(),
      hasAttachments: message.attachments.size > 0,
      referencedMessageId: message.reference?.messageId ?? undefined,
    });
  });

  // Start flush timer
  const intervalMs = getFlushInterval();
  flushTimer = setInterval(() => void flushAll(), intervalMs);

  logger.info(
    {
      intervalMs,
      maxPerBatch,
      allowlistSize: allowlist.size,
      blocklistSize: blocklist.size,
    },
    "Discord message watcher active",
  );
}
