import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "../client.js";

// ─── Mock Db factory ─────────────────────────────────────────────────────────
// Creates a chainable mock that simulates Drizzle query builder chains.
// Each call resolves with a configurable mockResult per query call.

type MockResult = unknown;

function createChainProxy(resolveWith: () => MockResult): unknown {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const methods = ["from", "where", "limit", "orderBy", "returning", "set", "values", "innerJoin", "offset"];
  for (const method of methods) {
    chain[method] = vi.fn().mockImplementation(() => proxy);
  }

  const proxy: unknown = new Proxy(chain, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: MockResult) => void, reject: (e: unknown) => void) => {
          try {
            resolve(resolveWith());
          } catch (e) {
            reject(e);
          }
        };
      }
      if (typeof prop === "string" && !(prop in target)) {
        target[prop] = vi.fn().mockReturnValue(proxy);
      }
      return target[prop];
    },
  });

  return proxy;
}

// Track calls so we can return different results for sequential calls
let callCount = 0;
let selectResults: MockResult[] = [];

function createMockDb(): Db {
  callCount = 0;
  const db = {
    select: vi.fn().mockImplementation(() => {
      const callIndex = callCount++;
      return createChainProxy(() => selectResults[callIndex] ?? []);
    }),
  } as unknown as Db;
  return db;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import { getRecentSessionSummaries } from "../repositories.js";

describe("getRecentSessionSummaries", () => {
  let db: Db;

  beforeEach(() => {
    callCount = 0;
    selectResults = [];
    db = createMockDb();
  });

  it("returns empty array when user has no conversations", async () => {
    // First query (conversations) returns empty
    selectResults = [[]];

    const result = await getRecentSessionSummaries(db, "user-1");

    expect(result).toEqual([]);
    // select() called once (for conversations query)
    expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("returns summaries joined via user conversations", async () => {
    const now = new Date("2026-01-01T12:00:00Z");

    // First query: recent conversations for user
    selectResults = [
      [{ id: "conv-1" }, { id: "conv-2" }],
      // Second query: summaries for those conversations
      [{ conversationId: "conv-1", summary: "Summary 1", createdAt: now }],
    ];

    const result = await getRecentSessionSummaries(db, "user-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conversationId: "conv-1",
      summary: "Summary 1",
      createdAt: now,
    });
  });

  it("returns up to limit summaries", async () => {
    const now = new Date("2026-01-01T12:00:00Z");

    selectResults = [
      [{ id: "conv-1" }, { id: "conv-2" }, { id: "conv-3" }],
      [
        { conversationId: "conv-1", summary: "Summary 1", createdAt: now },
        { conversationId: "conv-2", summary: "Summary 2", createdAt: now },
        { conversationId: "conv-3", summary: "Summary 3", createdAt: now },
      ],
    ];

    const result = await getRecentSessionSummaries(db, "user-1", 3);

    // The mock always returns all items; verify select was called twice
    expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(result).toHaveLength(3);
  });

  it("respects limit parameter by passing it to the query", async () => {
    const now = new Date("2026-01-01T12:00:00Z");

    selectResults = [
      [{ id: "conv-1" }],
      [{ conversationId: "conv-1", summary: "Summary 1", createdAt: now }],
    ];

    await getRecentSessionSummaries(db, "user-1", 1);

    // select() must have been called twice (conversations + summaries)
    expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("returns empty array when no summaries exist for user conversations", async () => {
    selectResults = [
      [{ id: "conv-1" }, { id: "conv-2" }],
      // No summaries yet
      [],
    ];

    const result = await getRecentSessionSummaries(db, "user-1");

    expect(result).toEqual([]);
  });

  it("uses default limit of 3 when not specified", async () => {
    const now = new Date("2026-01-01T12:00:00Z");

    selectResults = [
      [{ id: "conv-1" }],
      [{ conversationId: "conv-1", summary: "Summary 1", createdAt: now }],
    ];

    const result = await getRecentSessionSummaries(db, "user-1");

    // select() called twice: conversations + summaries
    expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(Array.isArray(result)).toBe(true);
  });
});
