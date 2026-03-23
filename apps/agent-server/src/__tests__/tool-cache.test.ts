import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

describe("ToolCache", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let ToolCache: typeof import("../services/tool-cache.js").ToolCache;

  beforeEach(async () => {
    const mod = await import("../services/tool-cache.js");
    ToolCache = mod.ToolCache;
  });

  it("should cache and return tool results", () => {
    const cache = new ToolCache();
    cache.set("read_file", { path: "/test.ts" }, { content: "hello" });
    const result = cache.get("read_file", { path: "/test.ts" });
    expect(result).toEqual({ content: "hello" });
  });

  it("should return undefined for cache misses", () => {
    const cache = new ToolCache();
    const result = cache.get("read_file", { path: "/unknown.ts" });
    expect(result).toBeUndefined();
  });

  it("should not cache uncacheable (write) tools", () => {
    const cache = new ToolCache();
    cache.set("write_file", { path: "/test.ts", content: "x" }, { success: true });
    const result = cache.get("write_file", { path: "/test.ts", content: "x" });
    expect(result).toBeUndefined();
  });

  it("should not cache error results", () => {
    const cache = new ToolCache();
    cache.set("read_file", { path: "/fail.ts" }, { error: "Not found" });
    const result = cache.get("read_file", { path: "/fail.ts" });
    expect(result).toBeUndefined();
  });

  it("should expire entries after TTL", () => {
    const cache = new ToolCache({ defaultTtlMs: 50 });
    cache.set("read_file", { path: "/test.ts" }, { content: "hello" });

    // Manually expire by manipulating time
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    const result = cache.get("read_file", { path: "/test.ts" });
    expect(result).toBeUndefined();
    vi.useRealTimers();
  });

  it("should evict oldest entries when at capacity", () => {
    const cache = new ToolCache({ maxEntries: 2 });
    cache.set("read_file", { path: "/a.ts" }, { content: "a" });
    cache.set("read_file", { path: "/b.ts" }, { content: "b" });
    cache.set("read_file", { path: "/c.ts" }, { content: "c" });

    // First entry should have been evicted
    expect(cache.get("read_file", { path: "/a.ts" })).toBeUndefined();
    expect(cache.get("read_file", { path: "/b.ts" })).toEqual({ content: "b" });
    expect(cache.get("read_file", { path: "/c.ts" })).toEqual({ content: "c" });
    expect(cache.size).toBe(2);
  });
});
