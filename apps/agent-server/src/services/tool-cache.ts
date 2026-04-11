/**
 * In-memory TTL cache for tool results within a single conversation/request.
 * Prevents redundant calls to read-only tools (e.g., read_file, git_status).
 */

import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("tool-cache");

const UNCACHEABLE_TOOLS = new Set([
  "create_plan",
  "create_milestone",
  "request_approval",
  "save_memory",
  "write_file",
  "delete_file",
  "delete_directory",
  "git_commit",
  "git_add",
  "git_push",
  "git_pull",
  "git_checkout",
  "git_branch",
  "git_clone",
  "execute_code",
  "run_tests",
  "create_pr",
  "create_schedule",
  "delete_schedule",
  "trigger_workflow",
  "send_message",
  "broadcast_update",
  "register_project",
  "switch_project",
  "delegate_to_subagent",
  "delegate_parallel",
  "create_follow_up",
  "log_productivity",
  "draft_reply",
  "send_email",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "respond_to_calendar_event",
  "browser_action",
  "query_database",
  "query_vps",
]);

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { defaultTtlMs?: number; maxEntries?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000; // 5 min
    this.maxEntries = options?.maxEntries ?? 100;
  }

  private buildKey(toolName: string, args: Record<string, unknown>): string {
    const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
    return `${toolName}:${sortedArgs}`;
  }

  get(toolName: string, args: Record<string, unknown>): unknown | undefined {
    if (UNCACHEABLE_TOOLS.has(toolName)) return undefined;

    const key = this.buildKey(toolName, args);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    logger.debug({ tool: toolName }, "tool cache hit");
    return entry.result;
  }

  set(toolName: string, args: Record<string, unknown>, result: unknown): void {
    if (UNCACHEABLE_TOOLS.has(toolName)) return;

    // Don't cache error results
    if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
      return;
    }

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const key = this.buildKey(toolName, args);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.defaultTtlMs,
    });
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  static isCacheable(toolName: string): boolean {
    return !UNCACHEABLE_TOOLS.has(toolName);
  }
}
