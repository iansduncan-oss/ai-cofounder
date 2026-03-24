import { createLogger } from "@ai-cofounder/shared";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { WorkspaceService } from "./workspace.js";

const logger = createLogger("pr-review");

export interface PrReviewIssue {
  file: string;
  line?: number;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface PrReviewResult {
  summary: string;
  issues: PrReviewIssue[];
  approval: "approve" | "request_changes" | "comment";
  files_changed: number;
  additions: number;
  deletions: number;
}

export class PrReviewService {
  constructor(
    private registry: LlmRegistry,
    private workspaceService?: WorkspaceService,
  ) {}

  async reviewPr(repoDir: string, prIdentifier: string): Promise<PrReviewResult> {
    logger.info({ repoDir, prIdentifier }, "reviewing PR");

    // Get the PR diff
    let diff: string;
    try {
      diff = await this.getPrDiff(repoDir, prIdentifier);
    } catch (err) {
      logger.warn({ err }, "failed to get PR diff via gh, falling back to git diff");
      diff = await this.getLocalDiff(repoDir, prIdentifier);
    }

    if (!diff || diff.trim().length === 0) {
      return {
        summary: "No diff found — PR may not exist or has no changes.",
        issues: [],
        approval: "comment",
        files_changed: 0,
        additions: 0,
        deletions: 0,
      };
    }

    // Count stats from diff
    const lines = diff.split("\n");
    const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const fileHeaders = lines.filter((l) => l.startsWith("diff --git"));
    const filesChanged = fileHeaders.length;

    // Truncate diff for LLM context
    const truncatedDiff = diff.length > 15000 ? diff.slice(0, 15000) + "\n\n[... diff truncated]" : diff;

    const response = await this.registry.complete("conversation", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Review this pull request diff. Identify bugs, logic errors, security issues, and code quality problems.

For each issue, specify the file, line number (if identifiable), severity (info/warning/error), and a concise description.

After listing issues, provide:
1. A 2-3 sentence summary of the PR
2. Your recommendation: "approve" (looks good), "request_changes" (has issues that should be fixed), or "comment" (minor suggestions only)

Return your response as JSON with this shape:
{
  "summary": "...",
  "issues": [{ "file": "...", "line": 42, "severity": "warning", "message": "..." }],
  "approval": "approve" | "request_changes" | "comment"
}

Here is the diff:

${truncatedDiff}`,
            },
          ],
        },
      ],
    });

    const text =
      response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") || "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          summary: string;
          issues: PrReviewIssue[];
          approval: string;
        };
        return {
          summary: parsed.summary || "Review complete.",
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          approval: (["approve", "request_changes", "comment"].includes(parsed.approval)
            ? parsed.approval
            : "comment") as PrReviewResult["approval"],
          files_changed: filesChanged,
          additions,
          deletions,
        };
      }
    } catch (err) {
      logger.warn({ err }, "failed to parse PR review JSON, returning raw text");
    }

    return {
      summary: text.slice(0, 500),
      issues: [],
      approval: "comment",
      files_changed: filesChanged,
      additions,
      deletions,
    };
  }

  private async getPrDiff(repoDir: string, prIdentifier: string): Promise<string> {
    const { execFileSync } = await import("node:child_process");
    const resolvedDir = this.workspaceService
      ? this.workspaceService.resolveSafe(repoDir)
      : repoDir;

    const prNum = prIdentifier.replace(/^#/, "");

    return execFileSync("gh", ["pr", "diff", prNum], {
      cwd: resolvedDir,
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  private async getLocalDiff(repoDir: string, branchOrPr: string): Promise<string> {
    const { execFileSync } = await import("node:child_process");
    const resolvedDir = this.workspaceService
      ? this.workspaceService.resolveSafe(repoDir)
      : repoDir;

    return execFileSync("git", ["diff", `main...${branchOrPr.replace(/^#/, "")}`], {
      cwd: resolvedDir,
      encoding: "utf-8",
      timeout: 30_000,
    });
  }
}
