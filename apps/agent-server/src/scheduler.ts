import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { eq, and, lt } from "drizzle-orm";
import { goals, channelConversations } from "@ai-cofounder/db";

const logger = createLogger("scheduler");

const STALE_HOURS = 24;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface StaleGoal {
  id: string;
  title: string;
  conversationId: string;
  channelId?: string;
}

async function findStaleGoals(db: Db): Promise<StaleGoal[]> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

  const staleGoals = await db
    .select({
      id: goals.id,
      title: goals.title,
      conversationId: goals.conversationId,
      channelId: channelConversations.channelId,
    })
    .from(goals)
    .leftJoin(channelConversations, eq(goals.conversationId, channelConversations.conversationId))
    .where(and(eq(goals.status, "active"), lt(goals.updatedAt, cutoff)));

  return staleGoals.map((g) => ({
    id: g.id,
    title: g.title,
    conversationId: g.conversationId,
    channelId: g.channelId ?? undefined,
  }));
}

async function sendReminder(webhookUrl: string, goal: StaleGoal): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "\u23f0 Stale Goal Reminder",
            description: `**${goal.title}** has been active for over ${STALE_HOURS}h without updates.\n\nUse \`/execute ${goal.id}\` to resume or update its status.`,
            color: 16098851, // amber
            footer: { text: `Goal: ${goal.id}` },
          },
        ],
      }),
    });
  } catch (err) {
    logger.warn({ err, goalId: goal.id }, "failed to send stale goal reminder");
  }
}

export function startScheduler(db: Db): void {
  const webhookUrl = optionalEnv("DISCORD_FOLLOWUP_WEBHOOK_URL", "");
  if (!webhookUrl) {
    logger.info("DISCORD_FOLLOWUP_WEBHOOK_URL not set, scheduler disabled");
    return;
  }

  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "follow-up scheduler started");

  const check = async () => {
    try {
      const staleGoals = await findStaleGoals(db);
      if (staleGoals.length > 0) {
        logger.info({ count: staleGoals.length }, "found stale goals");
        for (const goal of staleGoals) {
          await sendReminder(webhookUrl, goal);
        }
      }
    } catch (err) {
      logger.error({ err }, "scheduler check failed");
    }
  };

  // Run first check after 5 minutes (let server warm up)
  setTimeout(check, 5 * 60 * 1000);
  setInterval(check, CHECK_INTERVAL_MS);
}
