/**
 * Document watcher: monitors configured file paths and triggers RAG re-ingestion
 * when files change. Uses chokidar for cross-platform file watching.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLogger } from "@ai-cofounder/shared";
import { enqueueRagIngestion } from "@ai-cofounder/queue";

const logger = createLogger("document-watcher");

const IGNORED_DIRS = ["node_modules", ".git", "dist", "build", ".turbo", ".next"];
const DEBOUNCE_MS = 5000;

export interface WatchConfig {
  path: string;
  sourceId: string;
}

export class DocumentWatcher {
  private watcher: { close(): Promise<void>; on(event: string, cb: (...args: unknown[]) => void): unknown } | null = null;
  private fileHashes = new Map<string, string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private configs: WatchConfig[];

  constructor(configs: WatchConfig[]) {
    this.configs = configs;
  }

  async start(): Promise<void> {
    if (this.configs.length === 0) {
      logger.info("No watch paths configured, skipping document watcher");
      return;
    }

    // Dynamic import — chokidar is optional
    let chokidar: { watch: (...args: unknown[]) => { close(): Promise<void>; on(event: string, cb: (...args: unknown[]) => void): unknown } };
    try {
      chokidar = await import("chokidar") as unknown as typeof chokidar;
    } catch {
      logger.warn("chokidar not available, document watcher disabled");
      return;
    }

    const paths = this.configs.map((c) => c.path);
    const ignored = IGNORED_DIRS.map((d) => `**/${d}/**`);

    this.watcher = chokidar.watch(paths, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    });

    this.watcher.on("add", (...args: unknown[]) => this.handleChange(args[0] as string));
    this.watcher.on("change", (...args: unknown[]) => this.handleChange(args[0] as string));
    this.watcher.on("unlink", (...args: unknown[]) => this.handleDelete(args[0] as string));

    logger.info({ paths }, "Document watcher started");
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    logger.info("Document watcher stopped");
  }

  private async handleChange(filePath: string): Promise<void> {
    const config = this.findConfig(filePath);
    if (!config) return;

    // Hash check — skip if unchanged
    try {
      const content = await readFile(filePath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex");
      if (this.fileHashes.get(filePath) === hash) return;
      this.fileHashes.set(filePath, hash);
    } catch {
      return; // File may have been deleted between event and read
    }

    this.debouncedEnqueue(config.sourceId);
  }

  private handleDelete(filePath: string): void {
    const config = this.findConfig(filePath);
    if (!config) return;

    this.fileHashes.delete(filePath);
    this.debouncedEnqueue(config.sourceId);
  }

  private debouncedEnqueue(sourceId: string): void {
    const existing = this.debounceTimers.get(sourceId);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      sourceId,
      setTimeout(async () => {
        this.debounceTimers.delete(sourceId);
        try {
          await enqueueRagIngestion({ action: "ingest_repo", sourceId });
          logger.info({ sourceId }, "RAG re-ingestion enqueued");
        } catch (err) {
          logger.warn({ err, sourceId }, "Failed to enqueue RAG re-ingestion");
        }
      }, DEBOUNCE_MS),
    );
  }

  private findConfig(filePath: string): WatchConfig | undefined {
    return this.configs.find((c) => filePath.startsWith(c.path));
  }
}

/**
 * Create a DocumentWatcher from the DOC_WATCH_PATHS env var.
 * Format: "path1:sourceId1,path2:sourceId2"
 */
export function createDocumentWatcher(envValue?: string): DocumentWatcher | null {
  if (!envValue) return null;

  const configs: WatchConfig[] = envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [path, sourceId] = entry.split(":");
      if (!path || !sourceId) return null;
      return { path: path.trim(), sourceId: sourceId.trim() };
    })
    .filter((c): c is WatchConfig => c !== null);

  if (configs.length === 0) return null;
  return new DocumentWatcher(configs);
}
