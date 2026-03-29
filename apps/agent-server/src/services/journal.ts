import { createLogger } from "@ai-cofounder/shared";
import {
  createJournalEntry,
  listJournalEntries,
} from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { EventEmitter } from "node:events";

const logger = createLogger("journal-service");

export interface JournalService {
  writeEntry(data: {
    entryType: string;
    title: string;
    summary?: string;
    goalId?: string;
    taskId?: string;
    workSessionId?: string;
    details?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void>;

  generateStandup(date: Date): Promise<{
    date: string;
    narrative: string;
    data: {
      date: string;
      entryCounts: Record<string, number>;
      highlights: string[];
      totalEntries: number;
      costUsd: number;
    };
  }>;
}

export function createJournalService(
  db: Db,
  registry: LlmRegistry,
  agentEvents?: EventEmitter,
): JournalService {
  return {
    async writeEntry(data) {
      try {
        await createJournalEntry(db, data as Parameters<typeof createJournalEntry>[1]);
        agentEvents?.emit("ws:journal_change");
      } catch (err) {
        logger.warn({ err, entryType: data.entryType }, "Failed to write journal entry");
      }
    },

    async generateStandup(date: Date) {
      const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
      const dayEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

      const dateStr = dayStart.toISOString().slice(0, 10);

      const { data: entries, total } = await listJournalEntries(db, {
        since: dayStart,
        until: dayEnd,
        limit: 200,
      });

      const entryCounts: Record<string, number> = {};
      const highlights: string[] = [];

      for (const entry of entries) {
        entryCounts[entry.entryType] = (entryCounts[entry.entryType] ?? 0) + 1;
        if (entry.summary) {
          highlights.push(entry.summary);
        }
      }

      const standupData = {
        date: dateStr,
        entryCounts,
        highlights: highlights.slice(0, 10),
        totalEntries: total,
        costUsd: 0,
      };

      if (total === 0) {
        return {
          date: dateStr,
          narrative: `No activity recorded for ${dateStr}.`,
          data: standupData,
        };
      }

      // Build a static fallback first
      const staticParts: string[] = [`Activity for ${dateStr}:`];
      for (const [type, count] of Object.entries(entryCounts)) {
        staticParts.push(`- ${type.replace(/_/g, " ")}: ${count}`);
      }
      if (highlights.length > 0) {
        staticParts.push("", "Highlights:");
        for (const h of highlights.slice(0, 5)) {
          staticParts.push(`- ${h}`);
        }
      }
      const staticNarrative = staticParts.join("\n");

      try {
        const prompt = [
          "Generate a concise daily standup summary (3-5 sentences) from these journal entries.",
          "Focus on what was accomplished, any issues encountered, and overall progress.",
          "",
          `Date: ${dateStr}`,
          `Total entries: ${total}`,
          "",
          "Entry breakdown:",
          ...Object.entries(entryCounts).map(([t, c]) => `- ${t}: ${c}`),
          "",
          "Recent highlights:",
          ...highlights.slice(0, 8).map((h) => `- ${h}`),
        ].join("\n");

        const result = await registry.complete("simple", {
          messages: [{ role: "user", content: prompt }],
        });

        const narrative = result.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        return {
          date: dateStr,
          narrative: narrative || staticNarrative,
          data: standupData,
        };
      } catch (err) {
        logger.warn({ err }, "LLM standup generation failed, using static format");
        return {
          date: dateStr,
          narrative: staticNarrative,
          data: standupData,
        };
      }
    },
  };
}
