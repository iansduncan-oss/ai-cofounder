#!/usr/bin/env tsx
/**
 * Memory Bridge v2 — CLI
 *
 * Fetches the current memory snapshot from the running agent-server and
 * writes it to .claude/agent-memories.md so Claude Code picks it up at
 * session start (see CLAUDE.md session-start checklist).
 *
 * Usage:
 *   npx tsx scripts/sync-memory-bridge.ts
 *   npm run memory-bridge:sync
 *
 * Env:
 *   AGENT_SERVER_URL   default: http://localhost:3100
 *   API_SECRET         optional bearer token (matches agent-server auth)
 *   MEMORY_BRIDGE_OUT  override output path (default .claude/agent-memories.md)
 *   MEMORY_BRIDGE_LIMIT / MEMORY_BRIDGE_PER_CATEGORY_LIMIT
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE = process.env.AGENT_SERVER_URL ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), process.env.MEMORY_BRIDGE_OUT ?? ".claude/agent-memories.md");
const LIMIT = process.env.MEMORY_BRIDGE_LIMIT ?? "40";
const PER_CAT = process.env.MEMORY_BRIDGE_PER_CATEGORY_LIMIT ?? "8";

async function main(): Promise<void> {
  const params = new URLSearchParams({ limit: LIMIT, perCategoryLimit: PER_CAT });
  const url = `${BASE}/api/bridge/snapshot?${params}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.API_SECRET) headers.Authorization = `Bearer ${process.env.API_SECRET}`;

  console.error(`[memory-bridge] GET ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[memory-bridge] HTTP ${res.status} — ${body.slice(0, 200)}`);
    process.exit(1);
  }

  const snapshot = (await res.json()) as {
    markdown: string;
    includedCount: number;
    excludedCount: number;
    generatedAt: string;
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, snapshot.markdown, "utf-8");
  console.error(
    `[memory-bridge] wrote ${OUT} — ${snapshot.includedCount} memories (${snapshot.excludedCount} excluded)`,
  );
}

main().catch((err) => {
  console.error("[memory-bridge] failed:", err);
  process.exit(1);
});
