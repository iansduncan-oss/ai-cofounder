import type { FastifyInstance } from "fastify";
import { Orchestrator } from "../agents/orchestrator.js";
import { PrReviewService } from "../services/pr-review.js";
import { OutboundWebhookService } from "../services/outbound-webhooks.js";
import { ConversationBranchingService } from "../services/conversation-branching.js";

/**
 * Create an Orchestrator wired to all services available on the Fastify app.
 * Eliminates the 12+ property copy-paste across routes.
 */
export function createOrchestrator(app: FastifyInstance): Orchestrator {
  // Create PrReviewService if workspace is available
  const prReviewService = app.workspaceService
    ? new PrReviewService(app.llmRegistry, app.workspaceService)
    : undefined;

  // Create services that only need db
  const outboundWebhookService = app.db ? new OutboundWebhookService(app.db) : undefined;
  const conversationBranchingService = app.db ? new ConversationBranchingService(app.db) : undefined;

  return new Orchestrator({
    registry: app.llmRegistry,
    db: app.db,
    embeddingService: app.embeddingService,
    n8nService: app.n8nService,
    sandboxService: app.sandboxService,
    workspaceService: app.workspaceService,
    messagingService: app.messagingService,
    autonomyTierService: app.autonomyTierService,
    projectRegistryService: app.projectRegistry,
    monitoringService: app.monitoringService,
    browserService: app.browserService,
    episodicMemoryService: app.episodicMemoryService,
    proceduralMemoryService: app.proceduralMemoryService,
    prReviewService,
    outboundWebhookService,
    conversationBranchingService,
    discordService: (app as unknown as Record<string, unknown>).discordService as import("../services/discord.js").DiscordService | undefined,
  });
}
