import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { markEventProcessed } from "@ai-cofounder/db";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./services/workspace.js";
import type { AgentMessagingService } from "./services/agent-messaging.js";

const logger = createLogger("events");

interface EventRecord {
  id: string;
  source: string;
  type: string;
  payload: unknown;
}

export async function processEvent(
  db: Db,
  _registry: LlmRegistry,
  event: EventRecord,
  _embeddingService?: EmbeddingService,
  _sandboxService?: SandboxService,
  _workspaceService?: WorkspaceService,
  _messagingService?: AgentMessagingService,
): Promise<void> {
  logger.info({ eventId: event.id, source: event.source, type: event.type }, "processing event");

  // Autonomous session system has been removed.
  // Events are recorded but no longer trigger autonomous processing.
  await markEventProcessed(db, event.id, "Event recorded (autonomous processing removed)");

  logger.info({ eventId: event.id }, "event marked as processed");
}
