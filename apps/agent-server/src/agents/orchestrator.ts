import Anthropic from "@anthropic-ai/sdk";
import { createLogger, requireEnv, optionalEnv } from "@ai-cofounder/shared";
import type { AgentRole, AgentMessage } from "@ai-cofounder/shared";

export interface OrchestratorResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You are the Orchestrator agent in the AI Cofounder system.
Your job is to understand what the user needs and provide a helpful, actionable response.

You have access to the following specialist roles (not yet wired up):
- researcher: deep-dives into topics, gathers information
- coder: writes and reviews code
- reviewer: critiques plans and deliverables
- planner: breaks complex goals into actionable steps

For now, handle all requests directly. Be concise and practical.
When a request would clearly benefit from a specialist, note which role you would delegate to.`;

export class Orchestrator {
  private logger = createLogger("orchestrator");
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({
      apiKey: requireEnv("ANTHROPIC_API_KEY"),
    });
    this.model = optionalEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514");
  }

  async run(
    message: string,
    conversationId?: string,
    history?: AgentMessage[]
  ): Promise<OrchestratorResult> {
    const id = conversationId ?? crypto.randomUUID();
    this.logger.info({ conversationId: id }, "orchestrator run started");

    // Build message history for context
    const messages: Anthropic.MessageParam[] = [];

    if (history?.length) {
      for (const msg of history) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: message });

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      this.logger.info(
        {
          conversationId: id,
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        "orchestrator run completed"
      );

      return {
        conversationId: id,
        agentRole: "orchestrator",
        response: text,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (err) {
      this.logger.error({ conversationId: id, err }, "orchestrator run failed");
      throw err;
    }
  }
}
