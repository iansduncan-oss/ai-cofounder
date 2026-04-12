import type { LlmToolUseContent } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";
import { executeCreatePr, type CreatePrInput } from "../../tools/github-tools.js";
import type { BrowserActionInput } from "../../../services/browser.js";
import type { ToolExecutorServices, ToolExecutorContext } from "../types.js";

const logger = createLogger("tool-executor:workspace");

const HANDLED = new Set([
  "read_file",
  "write_file",
  "list_directory",
  "delete_file",
  "delete_directory",
  "git_clone",
  "git_status",
  "git_diff",
  "git_add",
  "git_commit",
  "git_pull",
  "git_log",
  "git_branch",
  "git_checkout",
  "git_push",
  "run_tests",
  "create_pr",
  "review_pr",
  "browser_action",
  "execute_vps_command",
  "docker_service_logs",
  "docker_restart_service",
]);

export function handlesWorkspaceTool(name: string): boolean {
  return HANDLED.has(name);
}

export async function executeWorkspaceTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  _context: ToolExecutorContext,
): Promise<unknown> {
  const { workspaceService, browserService } = services;

  switch (block.name) {
    case "read_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string };
      try {
        const content = await workspaceService.readFile(input.path);
        return { path: input.path, content };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "write_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string; content: string };
      try {
        await workspaceService.writeFile(input.path, input.content);
        return { written: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "list_directory": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path?: string };
      try {
        const entries = await workspaceService.listDirectory(input.path);
        return { path: input.path ?? ".", entries };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "delete_file": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string };
      try {
        await workspaceService.deleteFile(input.path);
        return { deleted: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "delete_directory": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { path: string; force?: boolean };
      try {
        await workspaceService.deleteDirectory(input.path, input.force);
        return { deleted: true, path: input.path };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "git_clone": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as {
        repo_url: string;
        directory_name?: string;
        depth?: number;
      };
      const result = await workspaceService.gitClone(
        input.repo_url,
        input.directory_name,
        input.depth,
      );

      // Auto-ingest project documentation on workspace registration (MEM-03)
      try {
        const { enqueueRagIngestion } = await import("@ai-cofounder/queue");
        const dirName =
          input.directory_name ?? input.repo_url.split("/").pop()?.replace(".git", "") ?? "repo";
        enqueueRagIngestion({
          action: "ingest_repo",
          sourceId: dirName,
        }).catch((err) => logger.warn({ err }, "RAG ingestion enqueue failed")); // fire-and-forget
      } catch {
        /* non-fatal */
      }

      return { ...result, repoUrl: input.repo_url };
    }

    case "git_status": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string };
      return workspaceService.gitStatus(input.repo_dir);
    }

    case "git_diff": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; staged?: boolean };
      return workspaceService.gitDiff(input.repo_dir, input.staged);
    }

    case "git_add": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; paths: string[] };
      return workspaceService.gitAdd(input.repo_dir, input.paths);
    }

    case "git_commit": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; message: string };
      return workspaceService.gitCommit(input.repo_dir, input.message);
    }

    case "git_pull": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; remote?: string; branch?: string };
      return workspaceService.gitPull(input.repo_dir, input.remote, input.branch);
    }

    case "git_log": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; max_count?: number };
      return workspaceService.gitLog(input.repo_dir, input.max_count);
    }

    case "git_branch": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; name?: string };
      return workspaceService.gitBranch(input.repo_dir, input.name);
    }

    case "git_checkout": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; branch: string; create?: boolean };
      return workspaceService.gitCheckout(input.repo_dir, input.branch, input.create);
    }

    case "git_push": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as { repo_dir: string; remote?: string; branch?: string };
      return workspaceService.gitPush(input.repo_dir, input.remote, input.branch);
    }

    case "run_tests": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as {
        repo_dir: string;
        command?: string;
        timeout_ms?: number;
      };
      return workspaceService.runTests(input.repo_dir, input.command, input.timeout_ms);
    }

    case "create_pr": {
      if (!workspaceService) return { error: "Workspace not available" };
      const input = block.input as unknown as CreatePrInput;
      return executeCreatePr(input);
    }

    case "review_pr": {
      if (!services.prReviewService) return { error: "PR review service not available" };
      const { pr_identifier, repo_dir } = block.input as {
        pr_identifier: string;
        repo_dir?: string;
      };
      const result = await services.prReviewService.reviewPr(repo_dir ?? ".", pr_identifier);
      return result;
    }

    case "browser_action": {
      if (!browserService?.available) return { error: "Browser automation not available" };
      const input = block.input as unknown as BrowserActionInput;
      return browserService.execute(input);
    }

    case "execute_vps_command": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { command, timeout_seconds } = block.input as {
        command: string;
        timeout_seconds?: number;
      };
      return services.vpsCommandService.execute(command, { timeoutSeconds: timeout_seconds });
    }

    case "docker_service_logs": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { service, lines } = block.input as { service: string; lines?: number };
      const logs = await services.vpsCommandService.getServiceLogs(
        service,
        Math.min(lines ?? 50, 200),
      );
      return { service, logs };
    }

    case "docker_restart_service": {
      if (!services.vpsCommandService) return { error: "VPS command service not available" };
      const { service, compose_file } = block.input as {
        service: string;
        compose_file?: string;
      };
      return services.vpsCommandService.restartService(service, compose_file);
    }

    default:
      return { error: `Workspace handler got unexpected tool: ${block.name}` };
  }
}
