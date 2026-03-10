import type { LlmRegistry, LlmTool, LlmToolUseContent } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { saveCodeExecution } from "@ai-cofounder/db";
import type { SandboxService } from "@ai-cofounder/sandbox";
import { hashCode } from "@ai-cofounder/sandbox";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { EXECUTE_CODE_TOOL } from "../tools/sandbox-tools.js";
import { READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL } from "../tools/filesystem-tools.js";
import type { WorkspaceService } from "../../services/workspace.js";

export class CoderAgent extends SpecialistAgent {
  readonly role: AgentRole = "coder";
  readonly taskCategory = "code" as const;

  private sandboxService?: SandboxService;
  private workspaceService?: WorkspaceService;

  constructor(registry: LlmRegistry, db?: Db, sandboxService?: SandboxService, workspaceService?: WorkspaceService) {
    super("coder", registry, db);
    this.sandboxService = sandboxService;
    this.workspaceService = workspaceService;
  }

  getSystemPrompt(context: SpecialistContext): string {
    const hasExecute = this.sandboxService?.available;
    const hasWorkspace = !!this.workspaceService;
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

You have a review_code tool — use it to self-review your code before finalizing your output.${hasExecute ? "\nYou have an execute_code tool — use it to test your code in a sandbox before delivering it." : ""}${hasWorkspace ? "\nYou have file system tools (read_file, write_file, list_directory) — use them to read existing code, write your changes to disk, and verify the file structure." : ""}`;
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

    if (this.workspaceService) {
      tools.push(READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL);
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
      const response: Record<string, unknown> = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        language: result.language,
      };

      if (result.exitCode !== 0 || result.timedOut) {
        response.action_required =
          "The code execution failed. Analyze the error output, identify the issue, and produce a corrected version.";
      }

      return response;
    }

    if (block.name === "read_file") {
      if (!this.workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string };
      try {
        const content = await this.workspaceService.readFile(input.path);
        return { path: input.path, content };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (block.name === "write_file") {
      if (!this.workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string; content: string };
      try {
        await this.workspaceService.writeFile(input.path, input.content);
        return { written: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (block.name === "list_directory") {
      if (!this.workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path?: string };
      try {
        const entries = await this.workspaceService.listDirectory(input.path);
        return { path: input.path ?? ".", entries };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { error: `Unknown tool: ${block.name}` };
  }
}
