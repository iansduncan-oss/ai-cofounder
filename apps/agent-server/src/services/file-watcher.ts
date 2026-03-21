/**
 * Document file watcher: monitors project paths for changes and enqueues
 * RAG ingestion when file content changes (MD5 hash deduplication).
 * Enabled via ENABLE_FILE_WATCHER=true (default off).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
// chokidar is ESM — type inlined to avoid import issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FSWatcher = { close(): Promise<void>; on(event: string, cb: (...args: any[]) => void): void };
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { shouldSkipFile } from "@ai-cofounder/rag";

const logger = createLogger("file-watcher");

export interface FileWatcherDeps {
  enqueueIngestion: (sourceType: string, sourceId: string, filePath: string, action: "upsert" | "delete") => Promise<void>;
}

const DEBOUNCE_MS = 500;

const IGNORE_DIRS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/coverage/**",
];

export class DocumentWatcher {
  private watchers: FSWatcher[] = [];
  private fileHashes = new Map<string, string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private deps: FileWatcherDeps;

  constructor(deps: FileWatcherDeps) {
    this.deps = deps;
  }

  static isEnabled(): boolean {
    return optionalEnv("ENABLE_FILE_WATCHER", "false") === "true";
  }

  /**
   * Start watching a directory for file changes.
   */
  async watchPath(dirPath: string, sourceId?: string): Promise<void> {
    const sid = sourceId ?? dirPath;
    logger.info({ dirPath, sourceId: sid }, "Starting file watcher");

    const { watch } = await import("chokidar");
    const watcher = watch(dirPath, {
      ignored: IGNORE_DIRS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    watcher.on("add", (filePath) => this.handleChange(filePath, sid));
    watcher.on("change", (filePath) => this.handleChange(filePath, sid));
    watcher.on("unlink", (filePath) => this.handleDelete(filePath, sid));

    watcher.on("error", (err) => {
      logger.error({ err, dirPath }, "File watcher error");
    });

    this.watchers.push(watcher);
  }

  private handleChange(filePath: string, sourceId: string): void {
    if (shouldSkipFile(filePath)) return;

    // Debounce rapid changes
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filePath,
      setTimeout(async () => {
        this.debounceTimers.delete(filePath);
        try {
          const content = await readFile(filePath, "utf-8");
          const hash = createHash("md5").update(content).digest("hex");
          const prevHash = this.fileHashes.get(filePath);

          if (prevHash === hash) {
            logger.debug({ filePath }, "File unchanged (hash match), skipping");
            return;
          }

          this.fileHashes.set(filePath, hash);
          await this.deps.enqueueIngestion("markdown", sourceId, filePath, "upsert");
          logger.debug({ filePath, sourceId }, "Enqueued ingestion for changed file");
        } catch (err) {
          logger.warn({ err, filePath }, "Failed to process file change");
        }
      }, DEBOUNCE_MS),
    );
  }

  private handleDelete(filePath: string, sourceId: string): void {
    if (shouldSkipFile(filePath)) return;

    this.fileHashes.delete(filePath);
    this.deps.enqueueIngestion("markdown", sourceId, filePath, "delete").catch((err) => {
      logger.warn({ err, filePath }, "Failed to enqueue deletion");
    });
    logger.debug({ filePath, sourceId }, "Enqueued chunk deletion for removed file");
  }

  /**
   * Stop all watchers and clean up.
   */
  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
    this.fileHashes.clear();
    logger.info("All file watchers stopped");
  }
}
