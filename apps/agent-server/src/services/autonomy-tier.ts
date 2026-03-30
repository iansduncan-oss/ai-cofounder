import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { listToolTierConfigs } from "@ai-cofounder/db";

export type AutonomyTier = "green" | "yellow" | "red";

const logger = createLogger("autonomy-tier");

export class AutonomyTierService {
  private static readonly DEFAULT_TIERS: Record<string, AutonomyTier> = {
    // Yellow: destructive or high-impact (auto-approved in autonomous sessions)
    git_push: "yellow",
    delete_file: "yellow",
    delete_directory: "yellow",
    write_file: "yellow",
    create_pr: "yellow",
    git_commit: "yellow",
  };

  private tiers: Map<string, { tier: AutonomyTier; timeoutMs: number }> = new Map();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private db: Db) {}

  async load(): Promise<void> {
    const configs = await listToolTierConfigs(this.db);
    const newTiers = new Map<string, { tier: AutonomyTier; timeoutMs: number }>();
    for (const config of configs) {
      newTiers.set(config.toolName, {
        tier: config.tier as AutonomyTier,
        timeoutMs: config.timeoutMs,
      });
    }
    this.tiers = newTiers;
    this.loaded = true;
    logger.info({ count: configs.length }, "autonomy tier configs loaded");
  }

  getTier(toolName: string): AutonomyTier {
    return this.tiers.get(toolName)?.tier
      ?? AutonomyTierService.DEFAULT_TIERS[toolName]
      ?? "green";
  }

  getTimeoutMs(toolName: string): number {
    return this.tiers.get(toolName)?.timeoutMs ?? 300_000;
  }

  getAllRed(): string[] {
    const dbRed = [...this.tiers.entries()]
      .filter(([, v]) => v.tier === "red")
      .map(([k]) => k);
    const defaultRed = Object.entries(AutonomyTierService.DEFAULT_TIERS)
      .filter(([, tier]) => tier === "red")
      .map(([name]) => name);
    return [...new Set([...dbRed, ...defaultRed])];
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async reload(): Promise<void> {
    // Use loadPromise as mutex to prevent concurrent reloads
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.load();
    await this.loadPromise;
    this.loadPromise = null;
  }
}
