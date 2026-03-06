import type { LlmTool } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("github-tools");

export const CREATE_PR_TOOL: LlmTool = {
  name: "create_pr",
  description:
    "Create a pull request on GitHub for a repository. " +
    "Requires GITHUB_TOKEN env var. The repo must be pushed to GitHub first (use git_push). " +
    "Specify the owner/repo, head branch, base branch, title, and optional body.",
  input_schema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "GitHub repository owner (user or org)",
      },
      repo: {
        type: "string",
        description: "GitHub repository name",
      },
      title: {
        type: "string",
        description: "Pull request title",
      },
      head: {
        type: "string",
        description: "Branch containing the changes",
      },
      base: {
        type: "string",
        description: "Branch to merge into (default: main)",
      },
      body: {
        type: "string",
        description: "Pull request description (optional)",
      },
    },
    required: ["owner", "repo", "title", "head"],
  },
};

export interface CreatePrInput {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base?: string;
  body?: string;
}

export async function executeCreatePr(input: CreatePrInput): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { error: "GITHUB_TOKEN environment variable is not set" };
  }

  const { owner, repo, title, head, base = "main", body } = input;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, head, base, body: body ?? "" }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.warn({ status: response.status, errorBody, owner, repo }, "GitHub PR creation failed");
      return { error: `GitHub API error ${response.status}: ${errorBody}` };
    }

    const pr = await response.json() as { number: number; html_url: string; title: string; state: string };
    logger.info({ prNumber: pr.number, owner, repo }, "pull request created");
    return {
      number: pr.number,
      html_url: pr.html_url,
      title: pr.title,
      state: pr.state,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner, repo }, "failed to create pull request");
    return { error: msg };
  }
}
