import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { getConversationMessageCount, saveConversationSummary } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { summarizeMessages } from "../agents/summarizer.js";

const logger = createLogger("conversation-ingestion");

/**
 * ConversationIngestionService
 *
 * Handles eager summarization and RAG ingestion of conversation turns.
 * MEM-01: Every agent response triggers conversation summary ingestion within 30s.
 * Short conversations (< 30 messages) get eagerly summarized; long conversations
 * rely on the existing lazy summarization path in agents.ts.
 */
export class ConversationIngestionService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embeddingService?: EmbeddingService,
  ) {}

  /**
   * Fire-and-forget: summarize the conversation turn (if short) and enqueue RAG ingestion.
   * Errors are logged as warn and never propagate — this is non-fatal.
   */
  async ingestAfterResponse(
    conversationId: string,
    userMessage: string,
    agentResponse: string,
  ): Promise<void> {
    try {
      const messageCount = await getConversationMessageCount(this.db, conversationId);

      // For short conversations (< 30 messages), eagerly create a summary for RAG indexing.
      // Long conversations (>= 30 messages) already have summaries from the lazy path in agents.ts.
      if (messageCount < 30) {
        const summaryText = await summarizeMessages(this.llmRegistry, [
          {
            id: "tmp-user",
            conversationId,
            role: "user",
            content: userMessage,
            createdAt: new Date(),
          },
          {
            id: "tmp-agent",
            conversationId,
            role: "agent",
            content: agentResponse,
            createdAt: new Date(),
          },
        ]);

        await saveConversationSummary(this.db, {
          conversationId,
          summary: summaryText,
          messageCount,
          fromMessageCreatedAt: new Date(),
          toMessageCreatedAt: new Date(),
        });

        logger.info(
          { conversationId, messageCount },
          "eager summary created for short conversation",
        );
      }

      // Enqueue RAG ingestion for this conversation (picks up latest summary)
      const { enqueueRagIngestion } = await import("@ai-cofounder/queue");
      enqueueRagIngestion({
        action: "ingest_conversations",
        sourceId: conversationId,
      }).catch((err) => logger.warn({ err }, "conversation ingestion enqueue failed")); // fire-and-forget
    } catch (err) {
      logger.warn({ err, conversationId }, "conversation ingestion failed (non-fatal)");
    }
  }
}
