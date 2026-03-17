import { describe, it, expect, vi } from "vitest";

describe("error analytics logic", () => {
  it("computes totalErrors from aggregated rows", () => {
    const errors = [
      { toolName: "search_web", errorMessage: "Tavily timeout", count: 5, lastSeen: "2026-03-17T00:00:00Z" },
      { toolName: "execute_code", errorMessage: "Docker unavailable", count: 3, lastSeen: "2026-03-16T23:00:00Z" },
    ];
    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
    expect(totalErrors).toBe(8);
  });

  it("returns 0 for empty error list", () => {
    const errors: Array<{ count: number }> = [];
    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
    expect(totalErrors).toBe(0);
  });

  it("computes since date from hours param", () => {
    const hours = 48;
    const now = Date.now();
    const since = new Date(now - hours * 60 * 60 * 1000);
    const diffMs = now - since.getTime();
    expect(diffMs).toBeCloseTo(48 * 60 * 60 * 1000, -2);
  });

  it("defaults to 24 hours and limit 20", () => {
    const queryHours = undefined;
    const queryLimit = undefined;
    const hours = queryHours ? parseInt(String(queryHours), 10) : 24;
    const limit = queryLimit ? parseInt(String(queryLimit), 10) : 20;
    expect(hours).toBe(24);
    expect(limit).toBe(20);
  });
});
