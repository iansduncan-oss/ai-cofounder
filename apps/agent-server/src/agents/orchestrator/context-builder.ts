import type { EmbeddingService, LlmRegistry } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { recallMemories, searchMemoriesByVector, getConversation } from "@ai-cofounder/db";
import { retrieve, formatContext } from "@ai-cofounder/rag";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { sanitizeForPrompt } from "../prompts/system.js";
import { ContextualAwarenessService } from "../../services/contextual-awareness.js";
import { SessionContextService } from "../../services/session-context.js";
import type { EpisodicMemoryService } from "../../services/episodic-memory.js";
import type { ProceduralMemoryService } from "../../services/procedural-memory.js";
import type { ProjectRegistryService } from "../../services/project-registry.js";
import type { FailurePatternService } from "../../services/failure-patterns.js";
import { ToolEfficacyService } from "../../services/tool-efficacy.js";

const logger = createLogger("orchestrator-context-builder");

export interface MemoryContextOptions {
  db?: Db;
  userId?: string;
  message: string;
  embeddingService?: EmbeddingService;
  episodicMemoryService?: EpisodicMemoryService;
  proceduralMemoryService?: ProceduralMemoryService;
  /** When true, emit the richer prompt with decision surfacing + episodic/procedural priming. */
  fullContext?: boolean;
}

/**
 * Build the user-specific memory/awareness block for the orchestrator system prompt.
 * Shared by run() and runStream().
 */
export async function buildMemoryContext(options: MemoryContextOptions): Promise<string> {
  const {
    db,
    userId,
    message,
    embeddingService,
    episodicMemoryService,
    proceduralMemoryService,
    fullContext = true,
  } = options;

  if (!userId || !db) return "";

  let memoryContext = "";

  const userMemories = await recallMemories(db, userId, { limit: 10 });

  let relevantMemories: Array<{ id: string; category: string; key: string; content: string }> = [];
  if (embeddingService) {
    try {
      const queryEmbedding = await embeddingService.embed(message);
      const vectorResults = await searchMemoriesByVector(db, queryEmbedding, userId, 5);
      relevantMemories = vectorResults.map((m) => ({
        id: m.id,
        category: m.category,
        key: m.key,
        content: m.content,
      }));
    } catch (err) {
      logger.warn({ err }, "auto semantic memory retrieval failed (non-fatal)");
    }
  }

  const seenIds = new Set(relevantMemories.map((m) => m.id));
  const generalMemories = userMemories.filter((m) => !seenIds.has(m.id));

  const parts: string[] = [];
  if (relevantMemories.length > 0) {
    parts.push("Relevant to this conversation:");
    parts.push(
      ...relevantMemories.map(
        (m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`,
      ),
    );
  }
  if (generalMemories.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("General knowledge:");
    parts.push(
      ...generalMemories.map(
        (m) => `- [${m.category}] ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`,
      ),
    );
  }

  // Proactive decision surfacing (SESS-02): highlight decisions separately
  if (fullContext && relevantMemories.length > 0) {
    const decisionMemories = relevantMemories.filter((m) => m.category === "decisions");
    if (decisionMemories.length > 0) {
      const decisionBlock = decisionMemories
        .map((m) => `- ${sanitizeForPrompt(m.key)}: ${sanitizeForPrompt(m.content)}`)
        .join("\n");
      parts.push("");
      parts.push(
        "Past decisions relevant to this topic (reference these naturally when applicable):",
      );
      parts.push(decisionBlock);
    }
  }

  if (parts.length > 0) {
    memoryContext = parts.join("\n");
  }

  // Proactive episodic memory priming
  if (fullContext && episodicMemoryService) {
    try {
      const episodes = await episodicMemoryService.recallEpisodes(message, { limit: 3 });
      if (episodes.length > 0) {
        const episodeBlock = [
          "Recent relevant episodes:",
          ...episodes.map(
            (e) => `- ${sanitizeForPrompt(e.summary)} (importance: ${e.importance.toFixed(1)})`,
          ),
        ].join("\n");
        memoryContext = memoryContext ? `${memoryContext}\n\n${episodeBlock}` : episodeBlock;
      }
    } catch (err) {
      logger.warn({ err }, "episodic memory priming failed (non-fatal)");
    }
  }

  // Proactive procedural memory priming
  if (fullContext && proceduralMemoryService) {
    try {
      const procedures = await proceduralMemoryService.findMatchingProcedures(message, 3);
      if (procedures.length > 0) {
        const procBlock = [
          "Relevant procedures from past successes:",
          ...procedures.map((p) => {
            const total = p.successCount + p.failureCount;
            const reliability = total > 0 ? ` (${p.successCount}/${total} successes)` : "";
            return `- ${sanitizeForPrompt(p.triggerPattern)}${reliability}`;
          }),
        ].join("\n");
        memoryContext = memoryContext ? `${memoryContext}\n\n${procBlock}` : procBlock;
      }
    } catch (err) {
      logger.warn({ err }, "procedural memory priming failed (non-fatal)");
    }
  }

  // Contextual awareness: inject time-of-day, recent activity, tone guidance
  try {
    const awarenessService = new ContextualAwarenessService(db, {
      timezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
    });
    const contextBlock = await awarenessService.getContextBlock(userId);
    if (contextBlock) {
      memoryContext = contextBlock + (memoryContext ? "\n\n" + memoryContext : "");
    }
  } catch (err) {
    logger.warn({ err }, "contextual awareness failed (non-fatal)");
  }

  // Session continuity context (MEM-04, SESS-01)
  try {
    const sessionContextService = new SessionContextService(db);
    const returnBlock = await sessionContextService.getReturnContext(userId);
    if (returnBlock) {
      memoryContext = returnBlock + (memoryContext ? "\n\n" + memoryContext : "");
    } else {
      const sessionBlock = await sessionContextService.getRecentContext(userId);
      if (sessionBlock) {
        memoryContext = sessionBlock + (memoryContext ? `\n\n${memoryContext}` : "");
      }
    }
  } catch (err) {
    logger.warn({ err }, "session context retrieval failed (non-fatal)");
  }

  return memoryContext;
}

/**
 * Resolve the active project slug from conversation metadata (used to scope RAG retrieval).
 */
export async function resolveActiveProjectSlug(
  db: Db | undefined,
  conversationId: string | undefined,
  projectRegistryService: ProjectRegistryService | undefined,
): Promise<string | undefined> {
  if (!db || !conversationId) return undefined;
  try {
    const conv = await getConversation(db, conversationId);
    const meta = conv?.metadata as { activeProjectId?: string } | null;
    if (meta?.activeProjectId && projectRegistryService) {
      const proj = projectRegistryService.getActiveProject(meta.activeProjectId);
      return proj?.slug;
    }
  } catch {
    /* non-fatal */
  }
  return undefined;
}

/**
 * RAG retrieval: find relevant document chunks (optionally scoped to a project).
 */
export async function retrieveRagContext(
  db: Db | undefined,
  embeddingService: EmbeddingService | undefined,
  registry: LlmRegistry,
  query: string,
  sourceId?: string,
): Promise<string | null> {
  if (!db || !embeddingService) return null;
  try {
    const chunks = await retrieve(db, embeddingService.embed.bind(embeddingService), query, {
      limit: 5,
      minScore: 0.3,
      diversifySources: true,
      llmRegistry: registry,
      enableReranking: true,
      ...(sourceId ? { sourceId } : {}),
    });
    if (chunks.length === 0) return null;
    return formatContext(chunks);
  } catch (err) {
    logger.warn({ err }, "RAG retrieval failed (non-fatal)");
    return null;
  }
}

/**
 * Append tool efficacy hints + failure pattern hints to the memory context.
 */
export async function appendEfficacyAndFailureHints(
  memoryContext: string,
  db: Db | undefined,
  failurePatternsService: FailurePatternService | undefined,
): Promise<string> {
  let ctx = memoryContext;

  if (db) {
    try {
      const efficacyService = new ToolEfficacyService(db);
      const hints = await efficacyService.getEfficacyHints();
      if (hints) {
        ctx = ctx ? `${ctx}\n\n${hints}` : hints;
      }
    } catch {
      /* non-fatal */
    }
  }

  if (failurePatternsService) {
    try {
      const failureHints = await failurePatternsService.formatPatternsForPrompt();
      if (failureHints) {
        ctx = ctx ? `${ctx}\n\n${failureHints}` : failureHints;
      }
    } catch {
      /* non-fatal */
    }
  }

  return ctx;
}
