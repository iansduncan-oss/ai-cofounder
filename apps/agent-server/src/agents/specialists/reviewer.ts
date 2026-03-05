import type { LlmRegistry, LlmTool } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { SpecialistAgent, type SpecialistContext } from "./base.js";

export class ReviewerAgent extends SpecialistAgent {
  readonly role: AgentRole = "reviewer";
  readonly taskCategory = "conversation" as const;

  constructor(registry: LlmRegistry, db?: Db) {
    super("reviewer", registry, db);
  }

  getSystemPrompt(context: SpecialistContext): string {
    return `You are a review specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to critically evaluate the work from previous steps and provide constructive feedback.

Guidelines:
- Check for correctness, completeness, and quality
- Flag any bugs, logic errors, security issues, or missing edge cases
- Assess whether the output actually solves the stated problem
- Be specific — point to exact issues, don't just say "looks good"
- Rate overall quality: excellent / good / needs work / significant issues
- Provide concrete suggestions for improvement
- If reviewing code, check for maintainability and best practices
- If reviewing research, check for accuracy and completeness`;
  }

  getTools(): LlmTool[] {
    return [];
  }
}
