import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm
const mockExecute = vi.fn();
vi.mock("drizzle-orm", () => ({
  sql: {
    raw: (s: string) => ({ queryChunks: [s] }),
  },
}));

const { executeQueryDatabase } = await import("../agents/tools/database-tools.js");

function createMockDb() {
  return {
    execute: mockExecute,
    transaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = { execute: mockExecute };
      return fn(tx);
    },
  } as any;
}

/** Get the actual query call (skipping the SET TRANSACTION READ ONLY call) */
function getQueryCall() {
  // calls[0] is SET TRANSACTION READ ONLY, calls[1] is the actual query
  return mockExecute.mock.calls[1]?.[0];
}

describe("executeQueryDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([{ id: 1, name: "test" }]);
  });

  // ── Allowlist: valid read-only queries ────────────────────

  describe("allows read-only queries", () => {
    it("allows SELECT", async () => {
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      expect(result).toHaveProperty("rows");
      expect(mockExecute).toHaveBeenCalled();
    });

    it("allows select (lowercase)", async () => {
      const result = await executeQueryDatabase(createMockDb(), "select id from users");
      expect(result).toHaveProperty("rows");
    });

    it("allows WITH (CTE)", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active",
      );
      expect(result).toHaveProperty("rows");
    });

    it("allows EXPLAIN", async () => {
      const result = await executeQueryDatabase(createMockDb(), "EXPLAIN SELECT * FROM users");
      expect(result).toHaveProperty("rows");
    });

    it("allows EXPLAIN ANALYZE", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "EXPLAIN ANALYZE SELECT * FROM users",
      );
      expect(result).toHaveProperty("rows");
    });
  });

  // ── Allowlist: rejects write operations ───────────────────

  describe("rejects write operations", () => {
    it("rejects DELETE", async () => {
      const result = await executeQueryDatabase(createMockDb(), "DELETE FROM users WHERE id = 1");
      expect(result).toEqual({
        error: "Only read-only queries (SELECT, WITH, EXPLAIN) are allowed.",
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects INSERT", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "INSERT INTO users (name) VALUES ('evil')",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects UPDATE", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "UPDATE users SET admin = true WHERE id = 1",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects DROP TABLE", async () => {
      const result = await executeQueryDatabase(createMockDb(), "DROP TABLE users");
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects TRUNCATE", async () => {
      const result = await executeQueryDatabase(createMockDb(), "TRUNCATE users");
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects ALTER TABLE", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "ALTER TABLE users ADD COLUMN evil text",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects CREATE TABLE", async () => {
      const result = await executeQueryDatabase(createMockDb(), "CREATE TABLE evil (id int)");
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── Comment-based bypass attempts ─────────────────────────

  describe("blocks comment-based bypass attempts", () => {
    it("rejects DELETE hidden after -- comment", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "-- innocent looking query\nDELETE FROM users",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects DELETE hidden after /* */ comment", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "/* just a comment */ DELETE FROM users",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects DELETE hidden after nested comments", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "-- first comment\n/* second comment */ DROP TABLE users",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("allows SELECT after stripping comments", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "-- this is a comment\nSELECT * FROM users",
      );
      expect(result).toHaveProperty("rows");
    });

    it("allows SELECT after block comment", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "/* debug query */ SELECT count(*) FROM users",
      );
      expect(result).toHaveProperty("rows");
    });

    it("handles unclosed block comment (becomes empty string)", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "/* this comment never closes DELETE FROM users",
      );
      // Unclosed comment results in empty string → not a valid read-only prefix
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("handles comment-only input", async () => {
      const result = await executeQueryDatabase(createMockDb(), "-- just a comment");
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── Multi-statement injection ─────────────────────────────

  describe("blocks multi-statement injection", () => {
    it("rejects SELECT; DELETE piggyback", async () => {
      const result = await executeQueryDatabase(createMockDb(), "SELECT 1; DELETE FROM users");
      expect(result).toEqual({
        error: "Multiple SQL statements are not allowed.",
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects SELECT; DROP piggyback", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "SELECT * FROM users; DROP TABLE users",
      );
      expect(result).toHaveProperty("error");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("allows trailing semicolons (common in SQL editors)", async () => {
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users;");
      expect(result).toHaveProperty("rows");
    });

    it("allows trailing semicolons with whitespace", async () => {
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users;  \n  ");
      expect(result).toHaveProperty("rows");
    });

    it("allows semicolons inside string literals", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        "SELECT * FROM users WHERE name = 'foo;bar'",
      );
      expect(result).toHaveProperty("rows");
    });

    it("allows semicolons inside double-quoted identifiers", async () => {
      const result = await executeQueryDatabase(
        createMockDb(),
        'SELECT * FROM users WHERE "col;name" = 1',
      );
      expect(result).toHaveProperty("rows");
    });
  });

  // ── LIMIT handling ────────────────────────────────────────

  describe("LIMIT handling", () => {
    it("appends LIMIT when not present", async () => {
      await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      const arg = getQueryCall();
      expect(arg.queryChunks[0]).toContain("LIMIT 100");
    });

    it("respects user-provided limit (capped at 100)", async () => {
      await executeQueryDatabase(createMockDb(), "SELECT * FROM users", 50);
      const arg = getQueryCall();
      expect(arg.queryChunks[0]).toContain("LIMIT 50");
    });

    it("caps limit to 100 when user requests more", async () => {
      await executeQueryDatabase(createMockDb(), "SELECT * FROM users", 500);
      const arg = getQueryCall();
      expect(arg.queryChunks[0]).toContain("LIMIT 100");
    });

    it("enforces minimum limit of 1", async () => {
      await executeQueryDatabase(createMockDb(), "SELECT * FROM users", 0);
      const arg = getQueryCall();
      expect(arg.queryChunks[0]).toContain("LIMIT 1");
    });

    it("does not append LIMIT if already present", async () => {
      await executeQueryDatabase(createMockDb(), "SELECT * FROM users LIMIT 10");
      const arg = getQueryCall();
      // Should not have double LIMIT
      const limitCount = (arg.queryChunks[0].match(/LIMIT/gi) || []).length;
      expect(limitCount).toBe(1);
    });
  });

  // ── Result handling ───────────────────────────────────────

  describe("result handling", () => {
    it("returns rows from array result", async () => {
      mockExecute.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      expect(result).toEqual({
        rows: [{ id: 1 }, { id: 2 }],
        rowCount: 2,
        truncated: false,
      });
    });

    it("returns rows from { rows: [...] } result format", async () => {
      mockExecute.mockResolvedValue({ rows: [{ id: 1 }] });
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      expect(result).toEqual({
        rows: [{ id: 1 }],
        rowCount: 1,
        truncated: false,
      });
    });

    it("truncates results beyond 100 rows", async () => {
      const bigResult = Array.from({ length: 150 }, (_, i) => ({ id: i }));
      mockExecute.mockResolvedValue(bigResult);
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users LIMIT 200");
      expect(result).toHaveProperty("rows");
      if ("rows" in result) {
        expect(result.rows).toHaveLength(100);
        expect(result.truncated).toBe(true);
      }
    });

    it("handles DB errors gracefully", async () => {
      // First call (SET TRANSACTION READ ONLY) succeeds, second (query) fails
      mockExecute
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('relation "users" does not exist'));
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      expect(result).toEqual({
        error: 'Query failed: relation "users" does not exist',
      });
    });

    it("handles non-Error throws", async () => {
      mockExecute
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce("connection timeout");
      const result = await executeQueryDatabase(createMockDb(), "SELECT * FROM users");
      expect(result).toEqual({
        error: "Query failed: connection timeout",
      });
    });
  });

  // ── Edge cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("rejects empty input", async () => {
      const result = await executeQueryDatabase(createMockDb(), "");
      expect(result).toHaveProperty("error");
    });

    it("rejects whitespace-only input", async () => {
      const result = await executeQueryDatabase(createMockDb(), "   \n  ");
      expect(result).toHaveProperty("error");
    });

    it("handles leading whitespace before SELECT", async () => {
      const result = await executeQueryDatabase(createMockDb(), "   \n  SELECT * FROM users");
      expect(result).toHaveProperty("rows");
    });
  });
});
