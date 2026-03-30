import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("discord-service");

const DISCORD_API = "https://discord.com/api/v10";

interface DiscordMessage {
  id: string;
  author: string;
  content: string;
  timestamp: string;
  embeds: Array<{ title?: string; description?: string }>;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

export class DiscordService {
  private defaultGuildId?: string;

  constructor(private token: string) {
    this.defaultGuildId = optionalEnv("DISCORD_GUILD_ID", "");
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async fetchMessages(
    channelId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<DiscordMessage[]> {
    const limit = Math.min(opts?.limit ?? 20, 50);
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.before) params.set("before", opts.before);

    const raw = await this.request<Array<{
      id: string;
      author: { username: string; bot?: boolean };
      content: string;
      timestamp: string;
      embeds: Array<{ title?: string; description?: string }>;
    }>>(`/channels/${channelId}/messages?${params}`);

    return raw.map((m) => ({
      id: m.id,
      author: `${m.author.username}${m.author.bot ? " [bot]" : ""}`,
      content: m.content,
      timestamp: m.timestamp,
      embeds: m.embeds.map((e) => ({ title: e.title, description: e.description })),
    }));
  }

  async fetchChannels(guildId?: string): Promise<DiscordChannel[]> {
    const id = guildId || this.defaultGuildId;
    if (!id) throw new Error("No guild ID provided and DISCORD_GUILD_ID not set");

    const raw = await this.request<Array<{
      id: string;
      name: string;
      type: number;
    }>>(`/guilds/${id}/channels`);

    const typeMap: Record<number, string> = {
      0: "text", 2: "voice", 4: "category", 5: "announcement",
      10: "thread", 11: "thread", 12: "thread", 13: "stage", 15: "forum",
    };

    return raw
      .filter((c) => c.type === 0 || c.type === 5) // text + announcement only
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: typeMap[c.type] ?? "unknown",
      }));
  }
}

export function createDiscordService(): DiscordService | undefined {
  const token = optionalEnv("DISCORD_TOKEN", "");
  if (!token) {
    logger.warn("DISCORD_TOKEN not set — Discord reading tools disabled");
    return undefined;
  }
  logger.info("discord service initialized");
  return new DiscordService(token);
}
