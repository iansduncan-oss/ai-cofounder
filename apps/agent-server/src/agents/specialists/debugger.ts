import type { LlmRegistry, LlmTool, LlmToolUseContent, EmbeddingService } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { recallMemories, searchMemoriesByVector } from "@ai-cofounder/db";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { SEARCH_WEB_TOOL, executeWebSearch } from "../tools/web-search.js";
import { EXECUTE_CODE_TOOL } from "../tools/sandbox-tools.js";
import { RECALL_MEMORIES_TOOL } from "../tools/memory-tools.js";

const ANALYZE_ERROR_TOOL: LlmTool = {
  name: "analyze_error",
  description:
    "Analyze an error message, stack trace, or log output to identify the root cause. " +
    "Provide the raw error text and optional context about what was happening when it occurred.",
  input_schema: {
    type: "object",
    properties: {
      error_text: {
        type: "string",
        description: "The error message, stack trace, or log output to analyze",
      },
      context: {
        type: "string",
        description: "Additional context: what operation was being performed, expected vs actual behavior",
      },
    },
    required: ["error_text"],
  },
};

const TRACE_ISSUE_TOOL: LlmTool = {
  name: "trace_issue",
  description:
    "Trace an issue through code by analyzing the call chain. " +
    "Provide relevant code snippets and the symptom to trace back to the root cause.",
  input_schema: {
    type: "object",
    properties: {
      symptom: {
        type: "string",
        description: "The observed symptom or bug behavior",
      },
      code_snippets: {
        type: "string",
        description: "Relevant code snippets (with file paths) to analyze",
      },
    },
    required: ["symptom", "code_snippets"],
  },
};

export class DebuggerAgent extends SpecialistAgent {
  readonly role: AgentRole = "debugger";
  readonly taskCategory = "code" as const;

  private sandboxService?: SandboxService;

  constructor(registry: LlmRegistry, db?: Db, embeddingService?: EmbeddingService, sandboxService?: SandboxService) {
    super("debugger", registry, db, embeddingService);
    this.sandboxService = sandboxService;
  }

  getSystemPrompt(context: SpecialistContext): string {
    const hasSandbox = this.sandboxService?.available;
    return `You are a debugging specialist agent working on a larger goal: "${context.goalTitle}".

Your job is to investigate bugs, errors, and unexpected behavior — identify root causes and propose targeted fixes.

Approach:
1. Analyze the error/symptoms to form hypotheses
2. Gather evidence — search memories for past issues, search the web for known bugs
3. Trace the issue through the code to pinpoint the root cause
4. If possible, reproduce the issue${hasSandbox ? " using the execute_code sandbox" : ""}
5. Propose a minimal, targeted fix with clear explanation

Guidelines:
- Be systematic — state your hypotheses before investigating
- Look for the simplest explanation first (typos, missing null checks, wrong variable names)
- Check for common patterns: race conditions, off-by-one errors, type mismatches, missing await
- When proposing a fix, explain WHY it works, not just WHAT to change
- If you can't determine the root cause, clearly state what you've ruled out and what remains
- Reference relevant error codes, docs, or past debugging memories when available`;
  }

  getTools(): LlmTool[] {
    const tools: LlmTool[] = [
      ANALYZE_ERROR_TOOL,
      TRACE_ISSUE_TOOL,
      SEARCH_WEB_TOOL,
      RECALL_MEMORIES_TOOL,
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
    switch (block.name) {
      case "analyze_error": {
        const { error_text, context: errorContext } = block.input as {
          error_text: string;
          context?: string;
        };

        const prompt = errorContext
          ? `Analyze this error in the context of: ${errorContext}\n\nError:\n${error_text}`
          : `Analyze this error:\n${error_text}`;

        const response = await this.registry.complete("code", {
          system:
            "You are an expert debugger. Analyze the error and provide:\n" +
            "1. **Error type**: What kind of error this is\n" +
            "2. **Likely cause**: The most probable root cause\n" +
            "3. **Key clues**: Important details from the stack trace or message\n" +
            "4. **Suggested fix**: Concrete steps to resolve\n" +
            "5. **Prevention**: How to prevent this in the future\n" +
            "Be concise and actionable.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
        });

        const text = response.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        return { analysis: text };
      }

      case "trace_issue": {
        const { symptom, code_snippets } = block.input as {
          symptom: string;
          code_snippets: string;
        };

        const response = await this.registry.complete("code", {
          system:
            "You are an expert at tracing bugs through code. Given a symptom and code snippets, " +
            "trace the execution path to identify where the bug originates. " +
            "Point to the specific line/expression that's wrong and explain the fix.",
          messages: [
            {
              role: "user",
              content: `Symptom: ${symptom}\n\nCode:\n${code_snippets}`,
            },
          ],
          max_tokens: 2048,
        });

        const text = response.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        return { trace: text };
      }

      case "search_web": {
        const input = block.input as { query: string; max_results?: number };
        return executeWebSearch(input.query, input.max_results);
      }

      case "recall_memories": {
        if (!context.userId || !this.db) return { error: "No user context available" };
        const input = block.input as { category?: string; query?: string };

        if (input.query && this.embeddingService) {
          try {
            const queryEmbedding = await this.embeddingService.embed(input.query);
            const results = await searchMemoriesByVector(this.db, queryEmbedding, context.userId, 10);
            if (results.length > 0) {
              return results.map((m) => ({
                key: m.key,
                category: m.category,
                content: m.content,
                distance: m.distance,
              }));
            }
          } catch (err) {
            this.logger.warn({ err }, "vector search failed, falling back to text search");
          }
        }

        const memories = await recallMemories(this.db, context.userId, input);
        return memories.map((m) => ({
          key: m.key,
          category: m.category,
          content: m.content,
        }));
      }

      case "execute_code": {
        if (!this.sandboxService?.available) return { error: "Sandbox execution not available" };
        const input = block.input as { code: string; language: string; timeout_ms?: number };
        const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 60_000);
        const result = await this.sandboxService.execute({
          code: input.code,
          language: input.language as "typescript" | "javascript" | "python" | "bash",
          timeoutMs,
          taskId: context.taskId,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          language: result.language,
        };
      }

      default:
        return { error: `Unknown tool: ${block.name}` };
    }
  }
}
