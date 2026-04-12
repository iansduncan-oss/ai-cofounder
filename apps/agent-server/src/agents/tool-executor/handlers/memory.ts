import type { LlmToolUseContent } from "@ai-cofounder/llm";
import { saveMemory, recallMemories, searchMemoriesByVector, touchMemory } from "@ai-cofounder/db";
import { retrieve, formatContext } from "@ai-cofounder/rag";
import { createLogger } from "@ai-cofounder/shared";
import type { ToolExecutorServices, ToolExecutorContext } from "../types.js";

const logger = createLogger("tool-executor:memory");

const HANDLED = new Set(["save_memory", "recall_memories", "recall_episodes", "recall_procedures"]);

export function handlesMemoryTool(name: string): boolean {
  return HANDLED.has(name);
}

export async function executeMemoryTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  const { db, embeddingService } = services;

  switch (block.name) {
    case "save_memory": {
      if (!context.userId || !db) return { error: "No user context available" };
      const input = block.input as { category: string; key: string; content: string };
      let embedding: number[] | undefined;
      if (embeddingService) {
        try {
          embedding = await embeddingService.embed(`${input.key}: ${input.content}`);
        } catch (err) {
          logger.warn({ err }, "failed to generate embedding for memory");
        }
      }
      const mem = await saveMemory(db, {
        userId: context.userId,
        category: input.category as Parameters<typeof saveMemory>[1]["category"],
        key: input.key,
        content: input.content,
        source: context.conversationId,
        agentRole: context.agentRole,
        embedding,
        workspaceId: context.workspaceId ?? "",
      });
      return { saved: true, key: mem.key, category: mem.category };
    }

    case "recall_memories": {
      if (!context.userId || !db) return { error: "No user context available" };
      const input = block.input as {
        category?: string;
        query?: string;
        scope?: "own" | "all";
      };

      if (input.query && embeddingService) {
        try {
          const queryEmbedding = await embeddingService.embed(input.query);
          const agentRoleForSearch = input.scope !== "all" ? context.agentRole : undefined;
          const results = await searchMemoriesByVector(
            db,
            queryEmbedding,
            context.userId,
            10,
            agentRoleForSearch,
          );
          if (results.length > 0) {
            for (const m of results) {
              touchMemory(db, m.id).catch((err) => logger.warn({ err }, "memory touch failed"));
            }
            return results.map((m) => ({
              key: m.key,
              category: m.category,
              content: m.content,
              agentRole: m.agent_role,
              updatedAt: m.updated_at,
              distance: m.distance,
            }));
          }
        } catch (err) {
          logger.warn({ err }, "vector search failed, falling back to text search");
        }
      }

      const memories = await recallMemories(db, context.userId, {
        ...input,
        agentRole: context.agentRole,
        scope: input.scope,
      });
      for (const m of memories) {
        touchMemory(db, m.id).catch((err) => logger.warn({ err }, "memory touch failed"));
      }
      const memoryResults = memories.map((m) => ({
        key: m.key,
        category: m.category,
        content: m.content,
        updatedAt: m.updatedAt,
      }));

      let ragContext = "";
      if (input.query && embeddingService) {
        try {
          const chunks = await retrieve(db, (text) => embeddingService.embed(text), input.query, {
            limit: 5,
          });
          ragContext = formatContext(chunks);
        } catch (err) {
          logger.warn({ err }, "RAG retrieval failed");
        }
      }

      return ragContext ? { memories: memoryResults, ragContext } : memoryResults;
    }

    case "recall_episodes": {
      const { episodicMemoryService } = services;
      if (!episodicMemoryService) return { error: "Episodic memory not available" };
      const { query, limit } = block.input as { query: string; limit?: number };
      const episodes = await episodicMemoryService.recallEpisodes(query, { limit });
      return { episodes, count: episodes.length };
    }

    case "recall_procedures": {
      const { proceduralMemoryService } = services;
      if (!proceduralMemoryService) return { error: "Procedural memory not available" };
      const { query, limit } = block.input as { query: string; limit?: number };
      const procedures = await proceduralMemoryService.findMatchingProcedures(query, limit);
      return { procedures, count: procedures.length };
    }

    default:
      return { error: `Memory handler got unexpected tool: ${block.name}` };
  }
}
