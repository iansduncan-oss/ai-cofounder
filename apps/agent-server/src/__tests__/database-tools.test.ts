import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { QUERY_DATABASE_TOOL, executeQueryDatabase } = await import(
  "../agents/tools/database-tools.js"
);

describe("QUERY_DATABASE_TOOL definition", () => {
  it("has correct name", () => {
    expect(QUERY_DATABASE_TOOL.name).toBe("query_database");
  });

  it("requires sql field", () => {
    expect(QUERY_DATABASE_TOOL.input_schema.required).toContain("sql");
  });

  it("has description", () => {
    expect(QUERY_DATABASE_TOOL.description).toBeTruthy();
  });
});

describe("executeQueryDatabase", () => {
  const mockExecute = vi.fn();
  const mockDb = { execute: mockExecute } as any;

  it("rejects DROP statements", async () => {
    const result = await executeQueryDatabase(mockDb, "DROP TABLE goals");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects DELETE statements", async () => {
    const result = await executeQueryDatabase(mockDb, "DELETE FROM goals WHERE id = '1'");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects INSERT statements", async () => {
    const result = await executeQueryDatabase(mockDb, "INSERT INTO goals (title) VALUES ('x')");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects UPDATE statements", async () => {
    const result = await executeQueryDatabase(mockDb, "UPDATE goals SET title = 'x'");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects ALTER statements", async () => {
    const result = await executeQueryDatabase(mockDb, "ALTER TABLE goals ADD COLUMN foo text");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects TRUNCATE statements", async () => {
    const result = await executeQueryDatabase(mockDb, "TRUNCATE goals");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects CREATE statements", async () => {
    const result = await executeQueryDatabase(mockDb, "CREATE TABLE foo (id int)");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("rejects case-insensitive write keywords", async () => {
    const result = await executeQueryDatabase(mockDb, "drop TABLE goals");
    expect(result).toEqual({ error: expect.stringContaining("read-only") });
  });

  it("allows SELECT queries", async () => {
    mockExecute.mockResolvedValueOnce([{ count: 5 }]);
    const result = await executeQueryDatabase(mockDb, "SELECT count(*) FROM goals");
    expect(result).toEqual({ rows: [{ count: 5 }], rowCount: 1, truncated: false });
  });

  it("allows WITH (CTE) queries", async () => {
    mockExecute.mockResolvedValueOnce([{ id: "1" }]);
    const result = await executeQueryDatabase(
      mockDb,
      "WITH recent AS (SELECT * FROM goals) SELECT * FROM recent",
    );
    expect(result).toEqual({ rows: [{ id: "1" }], rowCount: 1, truncated: false });
  });

  it("allows EXPLAIN queries", async () => {
    mockExecute.mockResolvedValueOnce([{ "QUERY PLAN": "Seq Scan" }]);
    const result = await executeQueryDatabase(mockDb, "EXPLAIN SELECT * FROM goals");
    expect(result).toEqual({
      rows: [{ "QUERY PLAN": "Seq Scan" }],
      rowCount: 1,
      truncated: false,
    });
  });

  it("appends LIMIT when not present", async () => {
    mockExecute.mockResolvedValueOnce([]);
    await executeQueryDatabase(mockDb, "SELECT * FROM goals");
    const calledSql = mockExecute.mock.calls[0][0];
    expect(calledSql.queryChunks?.[0]?.value?.[0] ?? String(calledSql)).toContain("LIMIT");
  });

  it("does not double-append LIMIT when already present", async () => {
    mockExecute.mockResolvedValueOnce([]);
    await executeQueryDatabase(mockDb, "SELECT * FROM goals LIMIT 10");
    const calledSql = mockExecute.mock.calls[0][0];
    const sqlStr = calledSql.queryChunks?.[0]?.value?.[0] ?? String(calledSql);
    const limitCount = (sqlStr.match(/LIMIT/gi) || []).length;
    expect(limitCount).toBe(1);
  });

  it("caps rows at 100", async () => {
    const largeResult = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    mockExecute.mockResolvedValueOnce(largeResult);
    const result = await executeQueryDatabase(mockDb, "SELECT * FROM goals LIMIT 200");
    expect("rows" in result && result.rows.length).toBe(100);
    expect("truncated" in result && result.truncated).toBe(true);
  });

  it("returns error on query failure", async () => {
    mockExecute.mockRejectedValueOnce(new Error("relation does not exist"));
    const result = await executeQueryDatabase(mockDb, "SELECT * FROM nonexistent");
    expect(result).toEqual({ error: expect.stringContaining("relation does not exist") });
  });

  it("strips trailing semicolons", async () => {
    mockExecute.mockResolvedValueOnce([]);
    await executeQueryDatabase(mockDb, "SELECT 1;;");
    const calledSql = mockExecute.mock.calls[0][0];
    const sqlStr = calledSql.queryChunks?.[0]?.value?.[0] ?? String(calledSql);
    expect(sqlStr).not.toMatch(/;;/);
  });
});
