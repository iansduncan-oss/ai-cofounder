import type { LlmRegistry, LlmTool, LlmToolUseContent } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { recallMemories } from "@ai-cofounder/db";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "../tools/web-search.js";
import { RECALL_MEMORIES_TOOL } from "../tools/memory-tools.js";

export class ResearcherAgent extends SpecialistAgent {
  readonly role: AgentRole = "researcher";
  readonly taskCategory = "research" as const;

  constructor(registry: LlmRegistry, db?: Db) {
    super("researcher", registry, db);
  }

  getSystemPrompt(context: SpecialistContext): string {
    return `You are a research specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to gather comprehensive, accurate information to complete the assigned research task. You have access to web search and memory recall tools.

Guidelines:
- Search broadly first, then drill down into specifics
- Cross-reference multiple sources when possible
- Note confidence levels — flag anything uncertain
- Structure your output clearly with sections and bullet points
- Include source URLs for any claims
- Focus on actionable findings, not just raw data
- If the task asks for recommendations, provide ranked options with trade-offs`;
  }

  getTools(): LlmTool[] {
    return [SEARCH_WEB_TOOL, RECALL_MEMORIES_TOOL];
  }

  protected override async executeTool(
    block: LlmToolUseContent,
    context: SpecialistContext,
  ): Promise<unknown> {
    switch (block.name) {
      case "search_web": {
        const input = block.input as { query: string; max_results?: number };
        return executeWebSearch(input.query, input.max_results);
      }
      case "recall_memories": {
        if (!context.userId || !this.db) return { error: "No user context available" };
        const input = block.input as { category?: string; query?: string };
        const memories = await recallMemories(this.db, context.userId, input);
        return memories.map((m) => ({
          key: m.key,
          category: m.category,
          content: m.content,
        }));
      }
      default:
        return { error: `Unknown tool: ${block.name}` };
    }
  }
}
