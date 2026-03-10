import { createLogger } from "@ai-cofounder/shared";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { Db } from "@ai-cofounder/db";
import { saveMemory } from "@ai-cofounder/db";

const logger = createLogger("decision-extractor");

export const DECISION_EXTRACTION_PROMPT = `Read this agent response and determine if it contains a decision.
A decision is when the user or agent commits to an approach, technology, or direction.

If a decision exists, respond with JSON:
{
  "hasDecision": true,
  "title": "short decision title (5-10 words)",
  "decision": "what was decided (1-2 sentences)",
  "rationale": "why this was chosen",
  "alternatives": ["other option 1", "other option 2"]
}

If no decision, respond: {"hasDecision": false}

Agent response:
{RESPONSE}`;

export class DecisionExtractorService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embeddingService?: EmbeddingService,
  ) {}

  /**
   * Extract a decision from an agent response and store it as a memory.
   * - Skips responses shorter than 100 chars (trivial acknowledgements).
   * - Runs fully wrapped in try/catch — never throws.
   */
  async extractAndStore(
    response: string,
    userId: string,
    conversationId?: string,
  ): Promise<void> {
    try {
      // Skip trivial responses
      if (response.length < 100) return;

      // Truncate to 2000 chars for extraction prompt
      const truncated = response.slice(0, 2000);
      const prompt = DECISION_EXTRACTION_PROMPT.replace("{RESPONSE}", truncated);

      const result = await this.llmRegistry.complete("simple", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      });

      const text = result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      let parsed: {
        hasDecision: boolean;
        title?: string;
        decision?: string;
        rationale?: string;
        alternatives?: string[];
      };

      try {
        parsed = JSON.parse(text);
      } catch {
        // Malformed JSON — skip silently
        return;
      }

      if (!parsed.hasDecision || !parsed.title || !parsed.decision) return;

      // Generate embedding if available
      let embedding: number[] | undefined;
      if (this.embeddingService) {
        try {
          embedding = await this.embeddingService.embed(parsed.decision);
        } catch {
          // Embedding failure is non-fatal
        }
      }

      await saveMemory(this.db, {
        userId,
        category: "decisions",
        key: parsed.title,
        content: parsed.decision,
        metadata: {
          rationale: parsed.rationale,
          alternatives: parsed.alternatives,
          conversationId,
          extractedAt: new Date().toISOString(),
        },
        embedding,
      });

      logger.info({ title: parsed.title, conversationId }, "decision auto-extracted");
    } catch (err) {
      logger.warn({ err }, "decision extraction failed (non-fatal)");
    }
  }
}
