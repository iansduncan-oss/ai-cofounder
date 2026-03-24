import type { FastifyInstance } from "fastify";
import { Orchestrator } from "../agents/orchestrator.js";

/**
 * Create an Orchestrator wired to all services available on the Fastify app.
 * Eliminates the 12+ property copy-paste across routes.
 */
export function createOrchestrator(app: FastifyInstance): Orchestrator {
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
  });
}
