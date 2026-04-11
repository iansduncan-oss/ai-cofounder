import { describe, it, expect } from "vitest";
import { buildMemorySnapshot, type BridgeMemory } from "../services/memory-bridge.js";

function mem(overrides: Partial<BridgeMemory> = {}): BridgeMemory {
  return {
    id: crypto.randomUUID(),
    category: "other",
    key: "key",
    content: "content",
    importance: 50,
    source: null,
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-04-09T12:00:00Z");

describe("buildMemorySnapshot", () => {
  it("returns empty-state markdown when there are no memories", () => {
    const snap = buildMemorySnapshot([], { now: FIXED_NOW });
    expect(snap.includedCount).toBe(0);
    expect(snap.excludedCount).toBe(0);
    expect(snap.markdown).toContain("# Jarvis Memory Snapshot");
    expect(snap.markdown).toContain("No memories have been recorded yet");
    expect(snap.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("filters archived memories and counts them as excluded", () => {
    const memories = [
      mem({ key: "live-1", category: "projects" }),
      mem({
        key: "archived-1",
        category: "projects",
        archivedAt: new Date("2026-03-01T00:00:00Z"),
      }),
      mem({ key: "live-2", category: "decisions" }),
    ];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });
    expect(snap.includedCount).toBe(2);
    expect(snap.excludedCount).toBe(1);
    expect(snap.markdown).toContain("live-1");
    expect(snap.markdown).toContain("live-2");
    expect(snap.markdown).not.toContain("archived-1");
  });

  it("groups memories by category in deterministic order", () => {
    const memories = [
      mem({ key: "goal-1", category: "goals" }),
      mem({ key: "pref-1", category: "preferences" }),
      mem({ key: "user-1", category: "user_info" }),
      mem({ key: "proj-1", category: "projects" }),
    ];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });

    const userIdx = snap.markdown.indexOf("## User Info");
    const prefIdx = snap.markdown.indexOf("## Preferences");
    const projIdx = snap.markdown.indexOf("## Projects");
    const goalIdx = snap.markdown.indexOf("## Goals");

    expect(userIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeGreaterThan(userIdx);
    expect(projIdx).toBeGreaterThan(prefIdx);
    expect(goalIdx).toBeGreaterThan(projIdx);
  });

  it("ranks by importance, then by recency as tiebreaker", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-04-08T00:00:00Z");

    const memories = [
      mem({ key: "low", category: "other", importance: 10, updatedAt: older }),
      mem({ key: "high-old", category: "other", importance: 90, updatedAt: older }),
      mem({ key: "high-new", category: "other", importance: 90, updatedAt: newer }),
      mem({ key: "mid", category: "other", importance: 50, updatedAt: newer }),
    ];

    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });
    const lines = snap.markdown.split("\n").filter((l) => l.startsWith("- "));
    // Expected order: high-new, high-old, mid, low
    expect(lines[0]).toContain("high-new");
    expect(lines[1]).toContain("high-old");
    expect(lines[2]).toContain("mid");
    expect(lines[3]).toContain("low");
  });

  it("enforces perCategoryLimit within a single category", () => {
    const memories = Array.from({ length: 12 }, (_, i) =>
      mem({ key: `p-${i}`, category: "projects", importance: 100 - i }),
    );
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW, perCategoryLimit: 3 });
    expect(snap.includedCount).toBe(3);
    expect(snap.excludedCount).toBe(9);
    // Highest-importance ones kept (p-0, p-1, p-2)
    expect(snap.markdown).toContain("p-0");
    expect(snap.markdown).toContain("p-1");
    expect(snap.markdown).toContain("p-2");
    expect(snap.markdown).not.toContain("p-3");
  });

  it("enforces a global limit across all categories", () => {
    const memories = [
      ...Array.from({ length: 5 }, (_, i) =>
        mem({ key: `proj-${i}`, category: "projects", importance: 100 - i }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        mem({ key: `dec-${i}`, category: "decisions", importance: 80 - i }),
      ),
    ];
    const snap = buildMemorySnapshot(memories, {
      now: FIXED_NOW,
      limit: 4,
      perCategoryLimit: 10,
    });
    expect(snap.includedCount).toBe(4);
    expect(snap.excludedCount).toBe(6);
    // Top 4 globally: proj-0 (100), proj-1 (99), proj-2 (98), proj-3 (97)
    expect(snap.markdown).toContain("proj-0");
    expect(snap.markdown).toContain("proj-3");
    expect(snap.markdown).not.toContain("dec-0");
  });

  it("truncates long memory content with an ellipsis", () => {
    const memories = [mem({ key: "long", content: "x".repeat(2000), category: "technical" })];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW, maxContentChars: 50 });
    expect(snap.markdown).toContain("long");
    expect(snap.markdown).toContain("…");
    // Content line should not exceed the truncation cap by much (plus label)
    const contentLine = snap.markdown.split("\n").find((l) => l.includes("- **long**"))!;
    expect(contentLine.length).toBeLessThan(150);
  });

  it("renders source attribution when present", () => {
    const memories = [mem({ key: "k", content: "c", source: "orchestrator" })];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });
    expect(snap.markdown).toContain("_(orchestrator)_");
  });

  it("handles unknown categories by appending them at the end", () => {
    const memories = [
      mem({ key: "exp-1", category: "experimental" as string }),
      mem({ key: "user-1", category: "user_info" }),
    ];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });
    const userIdx = snap.markdown.indexOf("## User Info");
    const expIdx = snap.markdown.indexOf("## experimental");
    expect(userIdx).toBeGreaterThan(-1);
    expect(expIdx).toBeGreaterThan(userIdx);
  });

  it("normalizes whitespace inside memory content", () => {
    const memories = [mem({ key: "k", content: "line1\n\n   line2\n\tline3" })];
    const snap = buildMemorySnapshot(memories, { now: FIXED_NOW });
    expect(snap.markdown).toContain("line1 line2 line3");
    expect(snap.markdown).not.toContain("line1\n\n");
  });
});
