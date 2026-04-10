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

/**
 * Allowlist approach: only permit statements that start with SELECT, WITH, or EXPLAIN.
 * Strip leading comments and whitespace first to prevent bypass via `/* ... *​/ DELETE`.
 */
function stripLeadingComments(s: string): string {
  let result = s;
   
  while (true) {
    result = result.trimStart();
    if (result.startsWith("--")) {
      const nl = result.indexOf("\n");
      result = nl === -1 ? "" : result.slice(nl + 1);
    } else if (result.startsWith("/*")) {
      const end = result.indexOf("*/");
      result = end === -1 ? "" : result.slice(end + 2);
    } else {
      break;
    }
  }
  return result;
}

const READ_ONLY_PREFIX = /^(SELECT|WITH|EXPLAIN)\b/i;

/** Reject multiple statements (semicolons outside of string literals) */
function hasMultipleStatements(s: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ";" && !inSingle && !inDouble) {
      // Allow trailing semicolons followed only by whitespace
      if (s.slice(i + 1).trim().length > 0) return true;
    }
  }
  return false;
}

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
  // Strip comments and check that the statement starts with a read-only keyword
  const stripped = stripLeadingComments(userSql);
  if (!READ_ONLY_PREFIX.test(stripped)) {
    return { error: "Only read-only queries (SELECT, WITH, EXPLAIN) are allowed." };
  }

  // Reject multiple statements to prevent piggy-backed writes
  if (hasMultipleStatements(stripped)) {
    return { error: "Multiple SQL statements are not allowed." };
  }

  // Cap limit to MAX_ROWS
  const effectiveLimit = Math.min(Math.max(limit ?? MAX_ROWS, 1), MAX_ROWS);

  // Append LIMIT if user query doesn't already contain one
  let queryText = stripped.trim().replace(/;+$/, "");
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
