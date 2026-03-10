import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { markEventProcessed } from "@ai-cofounder/db";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./services/workspace.js";
import type { AgentMessagingService } from "./services/agent-messaging.js";
import { runAutonomousSession } from "./autonomous-session.js";

const logger = createLogger("events");

interface EventRecord {
  id: string;
  source: string;
  type: string;
  payload: unknown;
}

export async function processEvent(
  db: Db,
  registry: LlmRegistry,
  event: EventRecord,
  embeddingService?: EmbeddingService,
  sandboxService?: SandboxService,
  workspaceService?: WorkspaceService,
  messagingService?: AgentMessagingService,
): Promise<void> {
  logger.info({ eventId: event.id, source: event.source, type: event.type }, "processing event");

  const prompt =
    `An external event was received. React appropriately.\n\n` +
    `**Source:** ${event.source}\n` +
    `**Type:** ${event.type}\n` +
    `**Payload:**\n\`\`\`json\n${JSON.stringify(event.payload, null, 2)}\n\`\`\``;

  try {
    const result = await runAutonomousSession(db, registry, embeddingService, sandboxService, workspaceService, messagingService, {
      trigger: "event",
      eventId: event.id,
      prompt,
      timeBudgetMs: 300_000, // 5 min budget for event-driven sessions
      tokenBudget: 30_000,
    });

    await markEventProcessed(db, event.id, result.summary);

    logger.info(
      { eventId: event.id, sessionId: result.sessionId, status: result.status },
      "event processed",
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await markEventProcessed(db, event.id, `Error: ${errorMsg}`);
    logger.error({ eventId: event.id, err }, "event processing failed");
  }
}
