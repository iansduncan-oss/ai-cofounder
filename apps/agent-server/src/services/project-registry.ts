import path from "node:path";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { listRegisteredProjects } from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import { WorkspaceService } from "./workspace.js";

const logger = createLogger("project-registry");

export interface RegisteredProject {
  id: string;
  name: string;
  slug: string;
  workspacePath: string;
  repoUrl?: string | null;
  description?: string | null;
  language: string;
  defaultBranch: string;
  testCommand?: string | null;
  config?: Record<string, unknown> | null;
}

export class ProjectRegistryService {
  private workspaces: Map<string, WorkspaceService> = new Map();
  private projects: Map<string, RegisteredProject> = new Map();
  private allowedBaseDirs: string[];

  constructor() {
    const baseDirEnv = optionalEnv(
      "PROJECTS_BASE_DIR",
      optionalEnv("WORKSPACE_DIR", "/tmp/ai-cofounder-workspace"),
    );
    // Support comma-separated list of allowed base directories
    this.allowedBaseDirs = baseDirEnv
      .split(",")
      .map((d) => path.resolve(d.trim()))
      .filter((d) => d.length > 0);
  }

  /**
   * Validates that the given workspace path is under one of the allowed base directories.
   * Uses path.resolve() for normalization to prevent path traversal.
   */
  validateProjectPath(workspacePath: string): boolean {
    const resolved = path.resolve(workspacePath);
    return this.allowedBaseDirs.some(
      (base) =>
        resolved === base ||
        resolved.startsWith(base + path.sep),
    );
  }

  /**
   * Registers a project with its WorkspaceService instance.
   * Throws if the workspace path is outside allowed base directories.
   */
  async registerProject(project: RegisteredProject): Promise<void> {
    if (!this.validateProjectPath(project.workspacePath)) {
      throw new Error(
        `Project path "${project.workspacePath}" is outside allowed base directories: ${this.allowedBaseDirs.join(", ")}`,
      );
    }

    const workspace = new WorkspaceService(project.workspacePath);
    await workspace.init();

    this.workspaces.set(project.id, workspace);
    this.projects.set(project.id, project);

    logger.info({ projectId: project.id, name: project.name, path: project.workspacePath }, "project registered");
  }

  /**
   * Returns the WorkspaceService for a given project ID, or undefined if not registered.
   */
  getWorkspace(projectId: string): WorkspaceService | undefined {
    return this.workspaces.get(projectId);
  }

  /**
   * Returns the project metadata for a given project ID, or undefined if not registered.
   */
  getActiveProject(projectId: string): RegisteredProject | undefined {
    return this.projects.get(projectId);
  }

  /**
   * Returns all registered projects as an array.
   */
  listProjects(): RegisteredProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Loads all active projects from the database and registers their WorkspaceServices.
   * Catches per-project errors so one bad path does not block all projects.
   */
  async loadFromDb(db: Db): Promise<void> {
    let rows: Awaited<ReturnType<typeof listRegisteredProjects>>;
    try {
      rows = await listRegisteredProjects(db);
    } catch (err) {
      logger.error({ err }, "failed to load projects from DB");
      return;
    }

    logger.info({ count: rows.length }, "loading registered projects from DB");

    for (const row of rows) {
      try {
        await this.registerProject({
          id: row.id,
          name: row.name,
          slug: row.slug,
          workspacePath: row.workspacePath,
          repoUrl: row.repoUrl,
          description: row.description,
          language: row.language ?? "typescript",
          defaultBranch: row.defaultBranch ?? "main",
          testCommand: row.testCommand,
          config: row.config as Record<string, unknown> | null,
        });
      } catch (err) {
        logger.warn(
          { projectId: row.id, name: row.name, workspacePath: row.workspacePath, err },
          "skipping project with invalid path",
        );
      }
    }
  }
}
