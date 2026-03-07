import type { LlmRegistry } from "@ai-cofounder/llm";
import type { AgentMessage } from "@ai-cofounder/shared";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("summarizer");

const SUMMARIZE_PROMPT = `Summarize this conversation concisely in 2-4 paragraphs. Focus on:
- Key decisions made
- Important topics discussed
- Action items or outcomes
- Technical details worth preserving

Be factual and specific. Do not include pleasantries or meta-commentary about the summary itself.`;

export async function summarizeMessages(
  registry: LlmRegistry,
  messages: AgentMessage[],
): Promise<string> {
  const formatted = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const response = await registry.complete("simple", {
    system: SUMMARIZE_PROMPT,
    messages: [{ role: "user", content: formatted }],
    max_tokens: 1024,
  });

  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  logger.info(
    { messageCount: messages.length, summaryLength: text.length },
    "conversation summarized",
  );

  return text;
}
