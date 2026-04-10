import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Db } from "@ai-cofounder/db";
import {
  upsertCodebaseInsight,
  listCodebaseInsights,
  listFailurePatterns,
  pruneStaleCodebaseInsights,
  type InsightCategory,
  type InsightSeverity,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { MonitoringService } from "./monitoring.js";

const execFile = promisify(execFileCb);
const logger = createLogger("codebase-scanner");

/** Files considered "recent" for TODO scanning. */
const RECENT_WINDOW_HOURS = 72;
const MAX_FILES_TO_SCAN = 30;
const MAX_TODO_MATCHES = 20;

const TODO_REGEX = /(?:\/\/|#|\/\*|<!--)\s*(TODO|FIXME|HACK|XXX)[:\s]+(.+?)(?:\*\/|-->|$)/i;

interface RawSignal {
  source: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description?: string;
  suggestedAction?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

function fingerprintOf(signal: Pick<RawSignal, "source" | "title" | "reference">): string {
  return createHash("sha1")
    .update(`${signal.source}|${signal.title}|${signal.reference ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export interface ScanOptions {
  /** If false, do not dispatch the LLM synthesis pass (faster, cruder). */
  synthesize?: boolean;
  /** Override the repo directory to scan. Defaults to process.cwd(). */
  repoDir?: string;
}

export interface ScanResult {
  insightsCreated: number;
  insightsRefreshed: number;
  signalsGathered: number;
  prunedCount: number;
  durationMs: number;
}

export class CodebaseScannerService {
  constructor(
    private readonly db: Db,
    private readonly llmRegistry: LlmRegistry,
    private readonly monitoringService?: MonitoringService,
  ) {}

  /** Run a full scan: gather signals → upsert insights → optionally LLM-synthesize extra insights. */
  async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const start = Date.now();
    const repoDir = options.repoDir ?? process.cwd();
    const synthesize = options.synthesize ?? true;

    const signals: RawSignal[] = [];

    // 1. Recent git commits (context for LLM, not a direct insight)
    const recentCommits = await this.gatherRecentCommits(repoDir, 20);

    // 2. Recently modified files → scan for TODO/FIXME
    const todoSignals = await this.gatherTodoSignals(repoDir);
    signals.push(...todoSignals);

    // 3. GitHub: open PRs needing review (age-based severity)
    signals.push(...(await this.gatherGithubPrSignals()));

    // 4. GitHub: failing CI
    signals.push(...(await this.gatherGithubCiSignals()));

    // 5. Recurring failure patterns from DB
    signals.push(...(await this.gatherFailurePatternSignals()));

    const before = await listCodebaseInsights(this.db, { status: "open", limit: 1000 });
    const existingFingerprints = new Set(before.data.map((i) => i.fingerprint));

    let refreshedCount = 0;
    for (const sig of signals) {
      const fingerprint = fingerprintOf(sig);
      if (existingFingerprints.has(fingerprint)) refreshedCount += 1;
      await upsertCodebaseInsight(this.db, { fingerprint, ...sig });
    }
    const createdCount = signals.length - refreshedCount;

    // 6. Optional: LLM synthesis — let the model look at recent commits + existing signals
    //    and suggest higher-level improvements (refactor opportunities, architectural issues)
    let synthCreated = 0;
    if (synthesize && (recentCommits.length > 0 || signals.length > 0)) {
      try {
        synthCreated = await this.synthesizeWithLlm(recentCommits, signals);
      } catch (err) {
        logger.warn({ err }, "LLM synthesis failed, continuing with raw signals only");
      }
    }

    // 7. Prune stale open insights (haven't been re-seen in 14 days → gone)
    const prunedCount = await pruneStaleCodebaseInsights(this.db, 14);

    const durationMs = Date.now() - start;
    logger.info(
      { signals: signals.length, created: createdCount + synthCreated, refreshed: refreshedCount, pruned: prunedCount, durationMs },
      "codebase scan complete",
    );

    return {
      insightsCreated: createdCount + synthCreated,
      insightsRefreshed: refreshedCount,
      signalsGathered: signals.length,
      prunedCount,
      durationMs,
    };
  }

  /* ─────────── Signal gatherers ─────────── */

  private async gatherRecentCommits(repoDir: string, maxCount: number): Promise<string[]> {
    try {
      const { stdout } = await execFile("git", ["log", "--oneline", `-${maxCount}`, `--since=${RECENT_WINDOW_HOURS}.hours.ago`], {
        cwd: repoDir,
        maxBuffer: 1_000_000,
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch (err) {
      logger.debug({ err, repoDir }, "git log failed (not a git repo or no recent commits)");
      return [];
    }
  }

  /**
   * Find recently modified files and scan them for TODO/FIXME/HACK comments.
   * Uses `git log --name-only --since=...` to find recent files without walking the filesystem.
   */
  private async gatherTodoSignals(repoDir: string): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];
    let files: string[] = [];
    try {
      const { stdout } = await execFile(
        "git",
        ["log", "--pretty=format:", "--name-only", `--since=${RECENT_WINDOW_HOURS}.hours.ago`],
        { cwd: repoDir, maxBuffer: 2_000_000 },
      );
      files = [...new Set(stdout.trim().split("\n").filter(Boolean))]
        .filter((f) => /\.(ts|tsx|js|jsx|py|go|rs|java|rb|md)$/.test(f))
        .filter((f) => !f.includes("node_modules") && !f.includes("dist/") && !f.includes(".turbo/"))
        .slice(0, MAX_FILES_TO_SCAN);
    } catch (err) {
      logger.debug({ err }, "git recent files query failed");
      return signals;
    }

    let matchCount = 0;
    for (const relPath of files) {
      if (matchCount >= MAX_TODO_MATCHES) break;
      try {
        const content = await readFile(path.join(repoDir, relPath), "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(TODO_REGEX);
          if (!m) continue;
          const kind = m[1].toUpperCase();
          const text = m[2].trim().slice(0, 200);
          if (!text) continue;
          signals.push({
            source: "todo",
            category: kind === "FIXME" ? "fix" : "followup",
            severity: kind === "FIXME" || kind === "HACK" ? "medium" : "low",
            title: `${kind} in ${path.basename(relPath)}: ${text.slice(0, 80)}`,
            description: text,
            suggestedAction: `Resolve the ${kind} comment at ${relPath}:${i + 1}`,
            reference: `${relPath}:${i + 1}`,
          });
          matchCount += 1;
          if (matchCount >= MAX_TODO_MATCHES) break;
        }
      } catch {
        // File may have been deleted after commit — skip
      }
    }
    return signals;
  }

  private async gatherGithubPrSignals(): Promise<RawSignal[]> {
    if (!this.monitoringService) return [];
    try {
      const prs = await this.monitoringService.checkGitHubPRs();
      const now = Date.now();
      return prs.map((pr) => {
        const ageHours = Math.round((now - new Date(pr.createdAt).getTime()) / (60 * 60 * 1000));
        const severity: InsightSeverity =
          ageHours >= 168 ? "high" : ageHours >= 72 ? "medium" : "low";
        return {
          source: "github_pr",
          category: "review" as const,
          severity,
          title: `Review PR: ${pr.title}`,
          description: `Open ${ageHours}h in ${pr.repo} by @${pr.author}`,
          suggestedAction: `Review ${pr.url}`,
          reference: pr.url,
          metadata: { repo: pr.repo, number: pr.number, ageHours },
        };
      });
    } catch (err) {
      logger.debug({ err }, "github PR scan failed");
      return [];
    }
  }

  private async gatherGithubCiSignals(): Promise<RawSignal[]> {
    if (!this.monitoringService) return [];
    try {
      const statuses = await this.monitoringService.checkGitHubCI();
      return statuses
        .filter((s) => s.status === "failure" || s.conclusion === "failure")
        .map((s) => ({
          source: "github_ci" as const,
          category: "fix" as const,
          severity: "high" as const,
          title: `CI failing on ${s.repo} (${s.branch})`,
          description: `Workflow conclusion: ${s.conclusion ?? s.status}`,
          suggestedAction: `Investigate ${s.url}`,
          reference: s.url,
          metadata: { repo: s.repo, branch: s.branch },
        }));
    } catch (err) {
      logger.debug({ err }, "github CI scan failed");
      return [];
    }
  }

  private async gatherFailurePatternSignals(): Promise<RawSignal[]> {
    try {
      const patterns = await listFailurePatterns(this.db, 10);
      return patterns
        .filter((p) => p.frequency >= 3)
        .map((p) => ({
          source: "failure_pattern" as const,
          category: "fix" as const,
          severity: (p.frequency >= 10 ? "high" : "medium") as InsightSeverity,
          title: `Recurring failure: ${p.toolName} (${p.errorCategory})`,
          description: `${p.errorMessage.slice(0, 200)} — seen ${p.frequency}x`,
          suggestedAction: p.resolution ?? `Investigate root cause of ${p.toolName} ${p.errorCategory} errors`,
          reference: p.toolName,
          metadata: { frequency: p.frequency, errorCategory: p.errorCategory },
        }));
    } catch (err) {
      logger.debug({ err }, "failure pattern scan failed");
      return [];
    }
  }

  /**
   * LLM-level synthesis: show the model recent commits and raw signals,
   * let it propose higher-level improvements (refactor, test coverage, docs).
   */
  private async synthesizeWithLlm(
    recentCommits: string[],
    rawSignals: RawSignal[],
  ): Promise<number> {
    const prompt = [
      "You are a senior engineer reviewing this project's recent activity.",
      "Based on the recent commits and raw signals below, suggest 0-5 NEW higher-level improvement opportunities.",
      "Focus on: missing tests for new code, refactor opportunities, docs gaps, architectural concerns.",
      "Do NOT duplicate the raw signals already listed.",
      "",
      "Output JSON only, exactly like this:",
      '{"insights": [{"category": "add|improve|fix|other", "severity": "low|medium|high", "title": "...", "description": "...", "suggestedAction": "..."}]}',
      "",
      "If nothing worth suggesting, return {\"insights\": []}.",
      "",
      "--- RECENT COMMITS ---",
      recentCommits.slice(0, 15).join("\n") || "(none)",
      "",
      "--- RAW SIGNALS ALREADY CAPTURED ---",
      rawSignals.slice(0, 20).map((s) => `[${s.category}] ${s.title}`).join("\n") || "(none)",
    ].join("\n");

    const response = await this.llmRegistry.complete("simple", {
      system: "You are a senior engineer. You output only valid JSON.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return 0;

    let parsed: { insights?: Array<{ category: string; severity: string; title: string; description?: string; suggestedAction?: string }> };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return 0;
    }
    if (!Array.isArray(parsed.insights)) return 0;

    let created = 0;
    const validCats: InsightCategory[] = ["fix", "improve", "add", "other"];
    const validSevs: InsightSeverity[] = ["low", "medium", "high", "critical"];
    for (const item of parsed.insights.slice(0, 5)) {
      const category = validCats.includes(item.category as InsightCategory) ? (item.category as InsightCategory) : "other";
      const severity = validSevs.includes(item.severity as InsightSeverity) ? (item.severity as InsightSeverity) : "medium";
      if (!item.title || typeof item.title !== "string") continue;
      const fingerprint = fingerprintOf({ source: "llm_synthesis", title: item.title, reference: undefined });
      await upsertCodebaseInsight(this.db, {
        fingerprint,
        source: "llm_synthesis",
        category,
        severity,
        title: item.title.slice(0, 200),
        description: item.description?.slice(0, 500),
        suggestedAction: item.suggestedAction?.slice(0, 500),
      });
      created += 1;
    }
    return created;
  }
}
