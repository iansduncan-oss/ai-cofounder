import type { LlmRegistry, LlmTool, LlmToolUseContent } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { saveCodeExecution } from "@ai-cofounder/db";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { hashCode } from "@ai-cofounder/sandbox";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { EXECUTE_CODE_TOOL } from "../tools/sandbox-tools.js";

export class CoderAgent extends SpecialistAgent {
  readonly role: AgentRole = "coder";
  readonly taskCategory = "code" as const;

  private sandboxService?: SandboxService;

  constructor(registry: LlmRegistry, db?: Db, sandboxService?: SandboxService) {
    super("coder", registry, db);
    this.sandboxService = sandboxService;
  }

  getSystemPrompt(context: SpecialistContext): string {
    const hasExecute = this.sandboxService?.available;
    return `You are a coding specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to produce high-quality code, configurations, or technical documentation as specified by the task.

Guidelines:
- Write clean, production-ready code with proper error handling
- Follow the conventions of the target language/framework
- Include brief inline comments only where logic isn't self-evident
- If the task is ambiguous, state your assumptions before coding
- Structure output as code blocks with file paths where applicable
- Consider edge cases and security implications
- If the task involves modifying existing code, clearly indicate what changes to make and where

You have a review_code tool — use it to self-review your code before finalizing your output.${hasExecute ? "\nYou have an execute_code tool — use it to test your code in a sandbox before delivering it." : ""}`;
  }

  getTools(): LlmTool[] {
    const tools: LlmTool[] = [
      {
        name: "review_code",
        description:
          "Self-review code for common issues: syntax errors, missing error handling, security vulnerabilities, and style problems. Submit code and language to get feedback.",
        input_schema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The code to review",
            },
            language: {
              type: "string",
              description: "Programming language (e.g. typescript, python, sql)",
            },
          },
          required: ["code", "language"],
        },
      },
    ];

    if (this.sandboxService?.available) {
      tools.push(EXECUTE_CODE_TOOL);
    }

    return tools;
  }

  protected override async executeTool(
    block: LlmToolUseContent,
    context: SpecialistContext,
  ): Promise<unknown> {
    if (block.name === "review_code") {
      const { code, language } = block.input as { code: string; language: string };

      // Use a fast model to review the code
      const reviewResponse = await this.registry.complete("conversation", {
        system:
          "You are a code reviewer. Identify bugs, security issues, missing error handling, and style problems. Be concise — list only real issues, not style preferences. If the code looks good, say so.",
        messages: [
          {
            role: "user",
            content: `Review this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
          },
        ],
        max_tokens: 1024,
      });

      const text = reviewResponse.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      return { review: text };
    }

    if (block.name === "execute_code") {
      if (!this.sandboxService?.available) return { error: "Sandbox execution not available" };
      const input = block.input as { code: string; language: string; timeout_ms?: number };
      const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 60_000);
      const result = await this.sandboxService.execute({
        code: input.code,
        language: input.language as "typescript" | "javascript" | "python" | "bash",
        timeoutMs,
        taskId: context.taskId,
      });
      // Persist execution result
      if (this.db) {
        try {
          await saveCodeExecution(this.db, {
            taskId: context.taskId,
            language: input.language,
            codeHash: hashCode(input.code),
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
          });
        } catch (err) {
          this.logger.warn({ err }, "failed to persist code execution result");
        }
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        language: result.language,
      };
    }

    return { error: `Unknown tool: ${block.name}` };
  }
}
