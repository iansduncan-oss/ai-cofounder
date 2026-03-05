import type { LlmRegistry, LlmTool, LlmToolUseContent } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "../tools/web-search.js";

export class PlannerAgent extends SpecialistAgent {
  readonly role: AgentRole = "planner";
  readonly taskCategory = "planning" as const;

  constructor(registry: LlmRegistry, db?: Db) {
    super("planner", registry, db);
  }

  getSystemPrompt(context: SpecialistContext): string {
    return `You are a planning specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to break down complex or ambiguous tasks into clear, actionable sub-plans.

Guidelines:
- Analyze the task requirements thoroughly before planning
- Break work into concrete, measurable steps
- Identify dependencies between steps
- Estimate relative complexity (simple / moderate / complex) for each step
- Flag risks and potential blockers
- Consider multiple approaches and recommend the best one with rationale
- Output should be a structured plan that other specialists can execute`;
  }

  getTools(): LlmTool[] {
    return [SEARCH_WEB_TOOL];
  }

  protected override async executeTool(
    block: LlmToolUseContent,
    _context: SpecialistContext,
  ): Promise<unknown> {
    if (block.name === "search_web") {
      const input = block.input as { query: string; max_results?: number };
      return executeWebSearch(input.query, input.max_results);
    }
    return { error: `Unknown tool: ${block.name}` };
  }
}
