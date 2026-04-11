import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listJournalEntries,
  listMemoriesByUser,
  getPrimaryAdminUserId,
} from "@ai-cofounder/db";

const logger = createLogger("vault");

const VAULT_DIR = optionalEnv("VAULT_DIR", "/opt/jarvis-vault");

const DIRS = ["daily", "projects", "decisions", "people"] as const;

/** Shape of an active goal row as consumed by daily-note rendering. */
interface VaultGoalSummary {
  title: string;
  status: string;
  priority: string;
}

/** Shape of a journal entry row as consumed by daily-note rendering. */
interface VaultJournalEntry {
  entryType: string;
  title: string;
  summary: string | null;
}

/** Shape of a memory row as consumed by daily-note rendering. */
interface VaultMemoryEntry {
  category: string;
  key: string;
  content: string;
}

export async function ensureVaultStructure(): Promise<void> {
  for (const dir of DIRS) {
    await mkdir(join(VAULT_DIR, dir), { recursive: true });
  }
  logger.info({ vaultDir: VAULT_DIR }, "vault directory structure ensured");
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: optionalEnv("BRIEFING_TIMEZONE", "America/Los_Angeles"),
  });
}

export async function writeDailyNote(db: Db): Promise<string> {
  const date = todayStr();
  const adminUserId = await getPrimaryAdminUserId(db);
  if (!adminUserId) {
    logger.warn("no admin user found, skipping daily note");
    return "";
  }

  const [goals, journal, memories] = await Promise.all([
    listActiveGoals(db, adminUserId),
    listJournalEntries(db, { limit: 20 }),
    listMemoriesByUser(db, adminUserId, { limit: 10 }),
  ]);
  const journalEntries = journal.data;

  const lines: string[] = [
    `# ${date}`,
    "",
    "## Active Goals",
    ...(goals.length
      ? (goals as VaultGoalSummary[]).map((g) => `- **${g.title}** (${g.status}, ${g.priority})`)
      : ["_No active goals_"]),
    "",
    "## Journal",
    ...(journalEntries.length
      ? (journalEntries.slice(0, 10) as VaultJournalEntry[]).map(
          (e) => `- [${e.entryType}] ${e.title}${e.summary ? `: ${e.summary}` : ""}`,
        )
      : ["_No entries today_"]),
    "",
    "## Recent Memories",
    ...(memories.length
      ? (memories.slice(0, 5) as VaultMemoryEntry[]).map(
          (m) => `- [${m.category}] **${m.key}**: ${m.content.slice(0, 200)}`,
        )
      : ["_No recent memories_"]),
    "",
  ];

  const content = lines.join("\n");
  const filePath = join(VAULT_DIR, "daily", `${date}.md`);

  await mkdir(join(VAULT_DIR, "daily"), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  logger.info({ filePath }, "daily note written");
  return filePath;
}

export async function writeProjectNote(
  db: Db,
  goalId: string,
  title: string,
  summary: string,
): Promise<string> {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 50);
  const filePath = join(VAULT_DIR, "projects", `${slug}.md`);

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // New file
  }

  const entry = `\n## ${todayStr()}\n\n${summary}\n`;
  const content = existing ? existing + entry : `# ${title}\n\nGoal ID: ${goalId}\n${entry}`;

  await mkdir(join(VAULT_DIR, "projects"), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  logger.info({ filePath, goalId }, "project note updated");
  return filePath;
}

export async function writeDecisionNote(topic: string, content: string): Promise<string> {
  const date = todayStr();
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 50);
  const filePath = join(VAULT_DIR, "decisions", `${date}-${slug}.md`);

  const md = `# Decision: ${topic}\n\n**Date:** ${date}\n\n${content}\n`;

  await mkdir(join(VAULT_DIR, "decisions"), { recursive: true });
  await writeFile(filePath, md, "utf-8");
  logger.info({ filePath, topic }, "decision note written");
  return filePath;
}
