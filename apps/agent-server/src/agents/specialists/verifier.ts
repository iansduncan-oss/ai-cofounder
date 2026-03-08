import type { LlmRegistry, LlmTool, LlmToolUseContent } from "@ai-cofounder/llm";
import type { AgentRole } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { SpecialistAgent, type SpecialistContext } from "./base.js";
import { VERIFY_RESULT_TOOL } from "../tools/verification-tools.js";
import { READ_FILE_TOOL, LIST_DIRECTORY_TOOL } from "../tools/filesystem-tools.js";
import { GIT_STATUS_TOOL, GIT_LOG_TOOL, GIT_DIFF_TOOL } from "../tools/git-tools.js";
import { RUN_TESTS_TOOL } from "../tools/workspace-tools.js";
import type { WorkspaceService } from "../../services/workspace.js";
import type { SandboxService } from "@ai-cofounder/sandbox";

export interface VerificationVerdict {
  verdict: "pass" | "fail";
  confidence: number;
  summary: string;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  suggestions?: string[];
}

const MAX_OUTPUT_BYTES = 10_000;

function truncate(text: string, max: number = MAX_OUTPUT_BYTES): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... (truncated, ${text.length - max} chars omitted)`;
}

export class VerifierAgent extends SpecialistAgent {
  readonly role: AgentRole = "verifier";
  readonly taskCategory = "code" as const;

  private workspaceService?: WorkspaceService;
  private sandboxService?: SandboxService;

  /** Populated after executeTool handles submit_verification */
  lastVerification: VerificationVerdict | null = null;

  constructor(
    registry: LlmRegistry,
    db?: Db,
    workspaceService?: WorkspaceService,
    sandboxService?: SandboxService,
  ) {
    super("verifier", registry, db);
    this.workspaceService = workspaceService;
    this.sandboxService = sandboxService;
  }

  getSystemPrompt(context: SpecialistContext): string {
    const hasWorkspace = !!this.workspaceService;
    return `You are a verification agent. Your job is to determine whether a goal's deliverables are correct and complete.

Goal: "${context.goalTitle}"

You have read-only access to the workspace. Analyze the task outputs provided, then:
1. ${hasWorkspace ? "Run the test suite if a test command is available (run_tests)" : "Review the task outputs carefully"}
2. ${hasWorkspace ? "Check git status and diff to see what changed" : "Look for signs of incomplete or broken work"}
3. ${hasWorkspace ? "Read key files to verify correctness" : "Assess whether outputs match the goal description"}
4. Call submit_verification with your structured verdict

Criteria for PASS:
- Code compiles / has no obvious syntax errors
- Tests pass (if applicable)
- The deliverables match what the goal asked for
- No obvious regressions introduced

Criteria for FAIL:
- Tests fail
- Code has syntax errors or won't compile
- Deliverables don't match the goal requirements
- Critical functionality is missing

You MUST call submit_verification exactly once with your verdict. Do NOT write or modify any files.`;
  }

  getTools(): LlmTool[] {
    const tools: LlmTool[] = [VERIFY_RESULT_TOOL];

    if (this.workspaceService) {
      tools.push(READ_FILE_TOOL, LIST_DIRECTORY_TOOL, GIT_STATUS_TOOL, GIT_LOG_TOOL, GIT_DIFF_TOOL, RUN_TESTS_TOOL);
    }

    return tools;
  }

  protected override async executeTool(
    block: LlmToolUseContent,
    _context: SpecialistContext,
  ): Promise<unknown> {
    switch (block.name) {
      case "submit_verification": {
        const input = block.input as unknown as VerificationVerdict;
        this.lastVerification = input;
        return { status: "recorded", verdict: input.verdict };
      }

      case "read_file": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { path } = block.input as { path: string };
        try {
          const content = await this.workspaceService.readFile(path);
          return { path, content: truncate(content) };
        } catch (err) {
          return { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "list_directory": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { path } = block.input as { path?: string };
        try {
          const entries = await this.workspaceService.listDirectory(path ?? ".");
          return { entries };
        } catch (err) {
          return { error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "git_status": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { repo_dir } = block.input as { repo_dir: string };
        try {
          const result = await this.workspaceService.gitStatus(repo_dir);
          return { stdout: truncate(result.stdout), stderr: result.stderr, exitCode: result.exitCode };
        } catch (err) {
          return { error: `Failed to get git status: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "git_log": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { repo_dir, max_count } = block.input as { repo_dir: string; max_count?: number };
        try {
          const result = await this.workspaceService.gitLog(repo_dir, max_count ?? 10);
          return { stdout: truncate(result.stdout), stderr: result.stderr, exitCode: result.exitCode };
        } catch (err) {
          return { error: `Failed to get git log: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "git_diff": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { repo_dir, staged } = block.input as { repo_dir: string; staged?: boolean };
        try {
          const result = await this.workspaceService.gitDiff(repo_dir, staged);
          return { stdout: truncate(result.stdout), stderr: result.stderr, exitCode: result.exitCode };
        } catch (err) {
          return { error: `Failed to get git diff: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "run_tests": {
        if (!this.workspaceService) return { error: "Workspace not available" };
        const { repo_dir, command, timeout_ms } = block.input as {
          repo_dir: string;
          command?: string;
          timeout_ms?: number;
        };
        try {
          const result = await this.workspaceService.runTests(
            repo_dir,
            command ?? "npm test",
            Math.min(timeout_ms ?? 300_000, 300_000),
          );
          return {
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr),
            exitCode: result.exitCode,
          };
        } catch (err) {
          return { error: `Failed to run tests: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      default:
        return { error: `Unknown tool: ${block.name}` };
    }
  }
}
