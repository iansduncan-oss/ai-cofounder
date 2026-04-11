/**
 * Episodic Memory Service: creates and recalls conversation-level episode summaries.
 * Episodes capture what happened in a conversation — decisions, tools used, goals worked on.
 */

import type { Db } from "@ai-cofounder/db";
import {
  createEpisodicMemory,
  searchEpisodicMemoriesByVector,
  touchEpisodicMemory,
  getConversationMessages,
  getConversation,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import { sanitizeMemoryContent } from "../agents/prompts/system.js";

const logger = createLogger("episodic-memory");

export interface EmbedFn {
  (text: string): Promise<number[]>;
}

export interface EpisodeRecallOptions {
  limit?: number;
  minScore?: number;
  includeRecent?: number;
}

export class EpisodicMemoryService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embed: EmbedFn,
  ) {}

  /**
   * Create an episode summary from a conversation's messages.
   * Called after meaningful conversations complete (via reflection queue).
   */
  async createEpisode(conversationId: string): Promise<{ id: string; summary: string } | null> {
    const messages = await getConversationMessages(this.db, conversationId, 50);
    if (messages.length < 3) {
      logger.debug(
        { conversationId, messageCount: messages.length },
        "Too few messages for episode",
      );
      return null;
    }

    const transcript = messages
      .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 500) : ""}`)
      .join("\n");

    try {
      const result = await this.llmRegistry.complete("simple", {
        messages: [
          {
            role: "user",
            content: `Summarize this conversation as an episodic memory. Extract:
1. A concise summary (2-3 sentences)
2. Key decisions made (as JSON array of strings)
3. Tools/capabilities used (as JSON array of strings)
4. Goals or topics worked on (as JSON array of strings)
5. The emotional tone/context (one phrase)
6. Importance score (0.0 to 1.0, where 1.0 = critical decision, 0.1 = casual chat)

Return ONLY valid JSON:
{"summary": "...", "keyDecisions": [], "toolsUsed": [], "goalsWorkedOn": [], "emotionalContext": "...", "importance": 0.5}

Conversation:
${transcript.slice(0, 3000)}`,
          },
        ],
      });

      const textContent = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = JSON.parse(textContent.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

      if (!parsed.summary) {
        logger.warn({ conversationId }, "LLM returned no summary for episode");
        return null;
      }

      let embedding: number[] | undefined;
      try {
        embedding = await this.embed(parsed.summary);
      } catch {
        logger.warn("Failed to embed episode summary");
      }

      // Look up the conversation's workspaceId
      const conv = await getConversation(this.db, conversationId);

      const episode = await createEpisodicMemory(this.db, {
        conversationId,
        summary: sanitizeMemoryContent(parsed.summary),
        keyDecisions: (parsed.keyDecisions ?? []).map((d: string) => sanitizeMemoryContent(d)),
        toolsUsed: parsed.toolsUsed ?? [],
        goalsWorkedOn: (parsed.goalsWorkedOn ?? []).map((g: string) => sanitizeMemoryContent(g)),
        emotionalContext: parsed.emotionalContext
          ? sanitizeMemoryContent(parsed.emotionalContext)
          : undefined,
        importance: typeof parsed.importance === "number" ? parsed.importance : 0.5,
        embedding,
        workspaceId: conv?.workspaceId ?? "",
      });

      logger.info({ conversationId, episodeId: episode.id }, "Created episodic memory");
      return { id: episode.id, summary: parsed.summary };
    } catch (err) {
      logger.error({ err, conversationId }, "Failed to create episodic memory");
      return null;
    }
  }

  /**
   * Recall relevant episodes by semantic similarity + recency + importance.
   */
  async recallEpisodes(
    query: string,
    options?: EpisodeRecallOptions,
  ): Promise<Array<{ id: string; summary: string; importance: number; createdAt: Date }>> {
    const limit = options?.limit ?? 5;
    const minScore = options?.minScore ?? 0.3;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embed(query);
    } catch {
      logger.warn("Failed to embed query for episode recall");
      return [];
    }

    const episodes = await searchEpisodicMemoriesByVector(
      this.db,
      queryEmbedding,
      limit * 2, // fetch extra for ranking
      minScore,
    );

    // Rank by combined score: similarity + importance + recency
    const now = Date.now();
    const ranked = episodes.map((e) => {
      const similarity = 1 - e.distance;
      const ageDays = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyBonus = Math.max(0, 0.1 * (1 - ageDays / 30));
      const importanceBonus = e.importance * 0.2;
      return {
        id: e.id,
        summary: e.summary,
        importance: e.importance,
        createdAt: e.created_at,
        finalScore: similarity + recencyBonus + importanceBonus,
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    const results = ranked.slice(0, limit);

    // Touch accessed episodes to update access count
    for (const ep of results) {
      touchEpisodicMemory(this.db, ep.id).catch((err) =>
        logger.warn({ err }, "episodic memory touch failed"),
      );
    }

    return results.map(({ finalScore: _, ...rest }) => rest);
  }
}
