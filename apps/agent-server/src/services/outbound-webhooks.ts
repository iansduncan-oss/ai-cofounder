import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { outboundWebhooks } from "@ai-cofounder/db";
import { eq } from "drizzle-orm";

const logger = createLogger("outbound-webhooks");

export class OutboundWebhookService {
  constructor(private db: Db) {}

  async register(url: string, eventTypes: string[], headers?: Record<string, string>, description?: string) {
    const [webhook] = await this.db.insert(outboundWebhooks).values({
      url, eventTypes, headers, description,
    }).returning();
    return webhook;
  }

  async list() {
    return this.db.select().from(outboundWebhooks).where(eq(outboundWebhooks.active, true));
  }

  async fire(eventType: string, payload: Record<string, unknown>) {
    const webhooks = await this.list();
    const matching = webhooks.filter((w) => w.eventTypes.includes(eventType));
    if (matching.length === 0) return;

    const results = await Promise.allSettled(
      matching.map(async (w) => {
        const res = await fetch(w.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(w.headers ?? {}),
          },
          body: JSON.stringify({ event: eventType, payload, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          logger.warn({ url: w.url, status: res.status, eventType }, "webhook delivery failed");
        }
        return { url: w.url, status: res.status };
      }),
    );

    logger.info({ eventType, sent: matching.length, results: results.length }, "outbound webhooks fired");
  }
}
