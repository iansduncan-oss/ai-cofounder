import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { GitHubCIStatus } from "../services/monitoring.js";
import type { TriageResult } from "../services/discord-triage.js";
import type { DiscordTriageMessage } from "@ai-cofounder/queue";

const logger = createLogger("queue-processors");

interface MinimalNotificationService {
  notifySystemInsights(insights: string[]): Promise<void>;
}

/**
 * Format and send a system-insights notification for any failing CI runs.
 * Pure function extracted from the monitoring processor so it can be tested
 * in isolation. Returns the number of failures reported.
 */
export async function notifyCiFailures(
  notificationService: MinimalNotificationService,
  ciResults: GitHubCIStatus[],
): Promise<number> {
  const ciFailures = ciResults.filter((ci) => ci.status === "failure");
  if (ciFailures.length === 0) return 0;

  const lines = ciFailures.map(
    (ci) => `- **${ci.repo}** (${ci.branch}): ${ci.conclusion ?? "failed"} — ${ci.url}`,
  );
  await notificationService.notifySystemInsights([
    `CI failure(s) detected:\n${lines.join("\n")}`,
  ]);
  logger.warn({ count: ciFailures.length }, "CI failure notification sent");
  return ciFailures.length;
}

/**
 * Fire the n8n action webhook for a discord triage result when a category→URL
 * mapping exists in the N8N_ACTION_WEBHOOKS env var. Best-effort: swallows all
 * errors and logs them. Returns true if a webhook was actually fired.
 */
export async function fireN8nActionWebhook(opts: {
  result: TriageResult;
  messages: DiscordTriageMessage[];
  channelName: string;
  batchedAt: string;
}): Promise<boolean> {
  const { result, messages, channelName, batchedAt } = opts;
  try {
    const webhooksJson = optionalEnv("N8N_ACTION_WEBHOOKS", "");
    if (!webhooksJson) return false;

    const webhooks: Record<string, string> = JSON.parse(webhooksJson);
    const webhookUrl = webhooks[result.category];
    if (!webhookUrl) return false;

    const relevantText = messages
      .filter((m) => result.relevantMessageIds.includes(m.messageId))
      .map((m) => `${m.authorName}: ${m.content.slice(0, 300)}`)
      .join("\n");

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: result.category,
        summary: result.summary,
        suggestedAction: result.suggestedAction,
        urgency: result.urgency,
        channelName,
        messages: relevantText,
        batchedAt,
      }),
    });
    logger.info({ category: result.category, webhookUrl }, "n8n action webhook triggered");
    return true;
  } catch (err) {
    logger.warn({ err, category: result.category }, "n8n action webhook failed (non-fatal)");
    return false;
  }
}
