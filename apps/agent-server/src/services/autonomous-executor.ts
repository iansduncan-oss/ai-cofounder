import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { getGoal, getCostByGoal } from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import type { TaskDispatcher, DispatcherProgress, TaskProgressCallback } from "../agents/dispatcher.js";
import type { WorkspaceService } from "./workspace.js";
import { executeCreatePr } from "../agents/tools/github-tools.js";

const logger = createLogger("autonomous-executor");

/** Structured entry in the work log actionsTaken array */
export interface WorkLogAction {
  type: "task_progress" | "git_branch" | "git_add" | "git_commit" | "git_push" | "create_pr" | "error";
  timestamp: number;
  taskId?: string;
  taskTitle?: string;
  agent?: string;
  status?: "started" | "completed" | "failed";
  message?: string;
  result?: Record<string, unknown>;
  output?: string;
}

/**
 * Builds a conventional commit message with goal/task ID linkage.
 * Enforces a 72-character maximum subject line by truncating the description.
 */
export function buildConventionalCommit(opts: {
  type: "feat" | "fix" | "chore" | "refactor" | "test" | "docs";
  scope?: string;
  description: string;
  goalId: string;
  taskId?: string;
}): string {
  const ref = opts.taskId
    ? `[goal:${opts.goalId.slice(0, 8)} task:${opts.taskId.slice(0, 8)}]`
    : `[goal:${opts.goalId.slice(0, 8)}]`;
  const prefix = opts.scope ? `${opts.type}(${opts.scope}): ` : `${opts.type}: `;
  // 1 for the space between description and ref
  const maxDescLen = 72 - prefix.length - ref.length - 1;
  const desc =
    opts.description.length > maxDescLen
      ? `${opts.description.slice(0, maxDescLen - 3)}...`
      : opts.description;
  return `${prefix}${desc} ${ref}`;
}

/**
 * AutonomousExecutorService orchestrates the full autonomous execution pipeline:
 *   1. (optionally) create a git feature branch
 *   2. run goal tasks via TaskDispatcher
 *   3. (optionally) commit changes and open a GitHub PR
 *
 * This is a deterministic wrapper around TaskDispatcher.runGoal() — it never relies
 * on the LLM to decide when or how to commit; that logic lives here.
 */
export class AutonomousExecutorService {
  private readonly logger = logger;

  constructor(
    private readonly dispatcher: TaskDispatcher,
    private readonly workspaceService: WorkspaceService | undefined,
    private readonly db: Db,
    private readonly registry: LlmRegistry,
  ) {}

  /**
   * Execute a goal end-to-end: run tasks, commit, optionally open a PR.
   * Returns the dispatcher progress result and a structured work log.
   */
  async executeGoal(opts: {
    goalId: string;
    userId?: string;
    workSessionId: string;
    repoDir?: string;
    createPr?: boolean;
    onProgress?: TaskProgressCallback;
  }): Promise<{ progress: DispatcherProgress; actions: WorkLogAction[]; costSummary?: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; requestCount: number } }> {
    const actions: WorkLogAction[] = [];

    // 1. Create feature branch if workspace + repo directory provided
    if (this.workspaceService && opts.repoDir) {
      const branchName = `autonomous/${opts.goalId.slice(0, 8)}`;
      try {
        await this.workspaceService.gitCheckout(opts.repoDir, branchName, true);
        actions.push({ type: "git_branch", timestamp: Date.now(), message: `Created branch ${branchName}` });
        this.logger.info({ branchName, goalId: opts.goalId }, "created feature branch");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push({ type: "error", timestamp: Date.now(), message: `Failed to create branch: ${msg}` });
        this.logger.warn({ err, goalId: opts.goalId }, "failed to create feature branch, continuing");
      }
    }

    // 2. Run goal tasks via TaskDispatcher
    const progress = await this.dispatcher.runGoal(opts.goalId, opts.userId, async (event) => {
      actions.push({
        type: "task_progress",
        timestamp: Date.now(),
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        agent: event.agent,
        status: event.status,
        output: event.output?.slice(0, 500),
      });
      await opts.onProgress?.(event);
    });

    this.logger.info({ goalId: opts.goalId, status: progress.status, completedTasks: progress.completedTasks }, "goal execution finished");

    // 3. Commit + optional PR if workspace is available and all tasks completed
    if (this.workspaceService && opts.repoDir && progress.status === "completed") {
      await this.commitAndOptionalPr(opts, progress, actions);
    }

    // 4. Fetch cost summary
    let costSummary: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; requestCount: number } | undefined;
    try {
      costSummary = await getCostByGoal(this.db, opts.goalId);
    } catch (err) {
      this.logger.warn({ err, goalId: opts.goalId }, "failed to fetch cost summary");
    }

    return { progress, actions, costSummary };
  }

  /**
   * Commit workspace changes and optionally push + create a PR.
   */
  private async commitAndOptionalPr(
    opts: { goalId: string; repoDir?: string; createPr?: boolean },
    progress: DispatcherProgress,
    actions: WorkLogAction[],
  ): Promise<void> {
    if (!this.workspaceService || !opts.repoDir) return;

    const goal = await getGoal(this.db, opts.goalId);
    const branchName = `autonomous/${opts.goalId.slice(0, 8)}`;

    // Check if there's anything to commit
    const statusResult = await this.workspaceService.gitStatus(opts.repoDir);
    if (statusResult.stdout.trim() === "") {
      actions.push({ type: "git_commit", timestamp: Date.now(), message: "Nothing to commit — skipped" });
      this.logger.info({ goalId: opts.goalId }, "working tree clean, skipping commit");
      return;
    }

    // Stage all changes
    await this.workspaceService.gitAdd(opts.repoDir, ["."]);
    actions.push({ type: "git_add", timestamp: Date.now() });

    // Build conventional commit message
    const commitMsg = buildConventionalCommit({
      type: "feat",
      description: goal?.title ?? "autonomous task",
      goalId: opts.goalId,
    });

    // Commit
    const commitResult = await this.workspaceService.gitCommit(opts.repoDir, commitMsg);
    actions.push({
      type: "git_commit",
      timestamp: Date.now(),
      message: commitMsg,
      result: { stdout: commitResult.stdout, exitCode: commitResult.exitCode },
    });
    this.logger.info({ goalId: opts.goalId, commitMsg }, "committed changes");

    // Optionally push and create PR
    if (opts.createPr) {
      const owner = optionalEnv("GITHUB_REPO_OWNER", "");
      const repo = optionalEnv("GITHUB_REPO_NAME", "");

      if (!owner || !repo) {
        this.logger.warn({ goalId: opts.goalId }, "GITHUB_REPO_OWNER or GITHUB_REPO_NAME not set, skipping PR creation");
        actions.push({ type: "error", timestamp: Date.now(), message: "PR skipped: GITHUB_REPO_OWNER or GITHUB_REPO_NAME not configured" });
        return;
      }

      const pushResult = await this.workspaceService.gitPush(opts.repoDir, "origin", branchName);
      actions.push({
        type: "git_push",
        timestamp: Date.now(),
        result: { stdout: pushResult.stdout, exitCode: pushResult.exitCode },
      });

      const baseBranch = optionalEnv("GITHUB_DEFAULT_BRANCH", "main");
      const prBody = await this.generatePrDescription(goal?.title ?? "", progress);
      const prResult = await executeCreatePr({
        owner,
        repo,
        title: goal?.title ?? "Autonomous task",
        head: branchName,
        base: baseBranch,
        body: prBody,
      });
      actions.push({
        type: "create_pr",
        timestamp: Date.now(),
        result: prResult as Record<string, unknown>,
      });
      this.logger.info({ goalId: opts.goalId, owner, repo }, "pull request created");
    }
  }

  /**
   * Generate a PR description by asking the LLM to summarize completed tasks.
   */
  async generatePrDescription(goalTitle: string, progress: DispatcherProgress): Promise<string> {
    const taskSummaries = progress.tasks
      .filter((t) => t.status === "completed")
      .map((t) => `- **${t.title}** (${t.agent}): ${(t.output ?? "").slice(0, 300)}`)
      .join("\n");

    const response = await this.registry.complete("conversation", {
      system: "You write concise GitHub PR descriptions. Keep under 300 words.",
      messages: [
        {
          role: "user",
          content: `Write a PR description for: "${goalTitle}"\n\nCompleted tasks:\n${taskSummaries}`,
        },
      ],
      max_tokens: 1024,
    });

    const body = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return `${body}\n\n---\n*Autonomously generated by AI Cofounder*`;
  }
}
