import type { LlmTool } from "@ai-cofounder/llm";
import { sql } from "drizzle-orm";
import type { Db } from "@ai-cofounder/db";

export const QUERY_DATABASE_TOOL: LlmTool = {
  name: "query_database",
  description:
    "Execute a read-only SQL query against the database for debugging and reporting. " +
    "Only SELECT, WITH, and EXPLAIN statements are allowed. " +
    "Results are capped at 100 rows.",
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "The SQL query to execute (SELECT only)",
      },
      limit: {
        type: "number",
        description: "Maximum rows to return (default 100, max 100)",
      },
    },
    required: ["sql"],
  },
};

const WRITE_PATTERN =
  /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|CALL)\b/i;

const MAX_ROWS = 100;

export interface QueryDatabaseResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export async function executeQueryDatabase(
  db: Db,
  userSql: string,
  limit?: number,
): Promise<QueryDatabaseResult | { error: string }> {
  // Sanitize: reject write statements
  if (WRITE_PATTERN.test(userSql)) {
    return { error: "Only read-only queries (SELECT, WITH, EXPLAIN) are allowed." };
  }

  // Cap limit to MAX_ROWS
  const effectiveLimit = Math.min(Math.max(limit ?? MAX_ROWS, 1), MAX_ROWS);

  // Append LIMIT if user query doesn't already contain one
  let queryText = userSql.trim().replace(/;+$/, "");
  if (!/\bLIMIT\b/i.test(queryText)) {
    queryText = `${queryText} LIMIT ${effectiveLimit}`;
  }

  try {
    const rows = await db.execute(sql.raw(queryText));
    const resultArray = Array.isArray(rows) ? rows : (rows as unknown as { rows: unknown[] }).rows ?? [];
    const sliced = resultArray.slice(0, MAX_ROWS) as Record<string, unknown>[];
    return {
      rows: sliced,
      rowCount: sliced.length,
      truncated: resultArray.length > MAX_ROWS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Query failed: ${msg}` };
  }
}
