import type { LlmRegistry } from "@ai-cofounder/llm";
import type { AgentMessage } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getConversationMessages,
  getConversationMessageCount,
  getLatestConversationSummary,
  saveConversationSummary,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { summarizeMessages } from "../agents/summarizer.js";

const logger = createLogger("context-window");

export interface ContextWindowConfig {
  /** Max token estimate for the message history window (default: 80_000) */
  maxHistoryTokens: number;
  /** Number of recent messages to always keep verbatim (default: 20) */
  recentMessageCount: number;
  /** Number of messages in the DB window to load (default: 50) */
  dbFetchLimit: number;
  /** Message count threshold before summarization kicks in (default: 30) */
  summarizationThreshold: number;
  /** After how many new messages a cached summary is considered stale (default: 10) */
  staleSummaryDelta: number;
}

const DEFAULT_CONFIG: ContextWindowConfig = {
  maxHistoryTokens: 80_000,
  recentMessageCount: 20,
  dbFetchLimit: 50,
  summarizationThreshold: 30,
  staleSummaryDelta: 10,
};

export interface PreparedHistory {
  messages: AgentMessage[];
  wasSummarized: boolean;
  totalDbMessages: number;
  estimatedTokens: number;
}

/**
 * ContextWindowManager
 *
 * Manages conversation history to fit within LLM context windows.
 * When conversations get long, it:
 * 1. Loads recent messages verbatim
 * 2. Summarizes older messages using the LLM
 * 3. Caches summaries in the conversation_summaries table
 * 4. Prepends the summary as a synthetic system message
 *
 * Token estimation uses chars/4 as a rough heuristic.
 */
export class ContextWindowManager {
  private config: ContextWindowConfig;

  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    config?: Partial<ContextWindowConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Prepare conversation history for the orchestrator.
   * Loads from DB if no history provided, applies summarization if needed.
   */
  async prepareHistory(
    conversationId: string,
    clientHistory?: AgentMessage[],
  ): Promise<PreparedHistory> {
    // Use client-provided history or load from DB
    let history = clientHistory;
    if (!history) {
      const dbMessages = await getConversationMessages(
        this.db,
        conversationId,
        this.config.dbFetchLimit,
      );
      history = dbMessages.reverse().map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role as "user" | "agent" | "system",
        agentRole: m.agentRole ?? undefined,
        content: m.content,
        metadata: m.metadata as Record<string, unknown> | undefined,
        createdAt: m.createdAt,
      }));
    }

    const totalDbMessages = await getConversationMessageCount(this.db, conversationId);

    // Check if summarization is needed
    if (totalDbMessages <= this.config.summarizationThreshold) {
      return {
        messages: history,
        wasSummarized: false,
        totalDbMessages,
        estimatedTokens: this.estimateTokens(history),
      };
    }

    // Try to use cached summary or create a new one
    const summarized = await this.applySummarization(
      conversationId,
      history,
      totalDbMessages,
    );

    return {
      messages: summarized,
      wasSummarized: true,
      totalDbMessages,
      estimatedTokens: this.estimateTokens(summarized),
    };
  }

  /**
   * Apply summarization: check for cached summary, create if stale, prepend to recent messages.
   */
  private async applySummarization(
    conversationId: string,
    history: AgentMessage[],
    totalDbMessages: number,
  ): Promise<AgentMessage[]> {
    const existingSummary = await getLatestConversationSummary(this.db, conversationId);
    const isStale =
      !existingSummary ||
      existingSummary.messageCount < totalDbMessages - this.config.staleSummaryDelta;

    let summaryText: string;

    if (isStale) {
      // Fetch older messages beyond the recent window for summarization
      const olderMessages = await getConversationMessages(
        this.db,
        conversationId,
        this.config.dbFetchLimit,
        this.config.dbFetchLimit,
      );

      if (olderMessages.length === 0) {
        // No older messages to summarize — just return history as-is
        if (existingSummary) {
          return this.prependSummary(existingSummary.summary, history);
        }
        return history;
      }

      const olderFormatted = olderMessages.reverse().map((m) => ({
        role: m.role as "user" | "agent" | "system",
        content: m.content,
      }));

      summaryText = await summarizeMessages(
        this.llmRegistry,
        olderFormatted as AgentMessage[],
      );

      await saveConversationSummary(this.db, {
        conversationId,
        summary: summaryText,
        messageCount: totalDbMessages,
        fromMessageCreatedAt: olderMessages[olderMessages.length - 1]?.createdAt,
        toMessageCreatedAt: olderMessages[0]?.createdAt,
      });

      logger.info(
        { conversationId, totalDbMessages, olderCount: olderMessages.length },
        "conversation summary created/updated",
      );
    } else {
      summaryText = existingSummary.summary;
      logger.debug({ conversationId }, "using cached conversation summary");
    }

    return this.prependSummary(summaryText, history);
  }

  /**
   * Prepend a summary as a synthetic system message at the start of history.
   */
  private prependSummary(summary: string, history: AgentMessage[]): AgentMessage[] {
    return [
      {
        role: "system" as const,
        content: `[Previous conversation summary]\n${summary}`,
      } as AgentMessage,
      ...history,
    ];
  }

  /**
   * Estimate token count for a set of messages using chars/4 heuristic.
   */
  estimateTokens(messages: AgentMessage[]): number {
    return messages.reduce((total, msg) => total + Math.ceil(msg.content.length / 4), 0);
  }

  /**
   * Trim history from the oldest end to fit within the max token budget.
   * Preserves at least the most recent `recentMessageCount` messages.
   */
  trimToFit(messages: AgentMessage[]): AgentMessage[] {
    let tokenCount = 0;
    const trimmed: AgentMessage[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const est = Math.ceil(messages[i].content.length / 4);
      if (tokenCount + est > this.config.maxHistoryTokens) break;
      tokenCount += est;
      trimmed.unshift(messages[i]);
    }

    // Ensure we keep at least the last N messages
    if (trimmed.length < this.config.recentMessageCount && messages.length > 0) {
      return messages.slice(-this.config.recentMessageCount);
    }

    return trimmed;
  }
}
