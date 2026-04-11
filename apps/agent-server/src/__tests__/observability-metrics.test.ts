import { describe, it, expect, beforeAll, vi } from "vitest";
import client from "prom-client";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, def: string) => def,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

// Import the module under test so its metric definitions are registered on the
// default prom-client register.
const {
  recordGithubCiFailure,
  setGithubOpenPrs,
  recordDiscordTriageResult,
  setGoalThroughputMetrics,
} = await import("../plugins/observability.js");

describe("observability metrics — memory bridge v2 + dashboard signals", () => {
  it("registers all expected new metric names on the default register", () => {
    const expected = [
      "goals_active",
      "goals_completed_24h",
      "goals_failed_24h",
      "github_ci_failures_total",
      "github_open_prs",
      "discord_triage_results_total",
    ];
    for (const name of expected) {
      expect(
        client.register.getSingleMetric(name),
        `metric "${name}" should be registered`,
      ).toBeDefined();
    }
  });

  it("setGoalThroughputMetrics publishes the three goal gauges", async () => {
    setGoalThroughputMetrics({ active: 7, completed24h: 3, failed24h: 1 });

    const active = await client.register.getSingleMetric("goals_active")!.get();
    const completed = await client.register.getSingleMetric("goals_completed_24h")!.get();
    const failed = await client.register.getSingleMetric("goals_failed_24h")!.get();

    expect(active.values[0]?.value).toBe(7);
    expect(completed.values[0]?.value).toBe(3);
    expect(failed.values[0]?.value).toBe(1);
  });

  it("setGithubOpenPrs updates the gauge", async () => {
    setGithubOpenPrs(12);
    const openPrs = await client.register.getSingleMetric("github_open_prs")!.get();
    expect(openPrs.values[0]?.value).toBe(12);
  });

  it("recordGithubCiFailure emits a label per repo+branch", async () => {
    recordGithubCiFailure("owner/alpha", "main");
    recordGithubCiFailure("owner/alpha", "main");
    recordGithubCiFailure("owner/beta", "dev");

    const metric = await client.register.getSingleMetric("github_ci_failures_total")!.get();
    const alphaMain = metric.values.find(
      (v) => v.labels.repo === "owner/alpha" && v.labels.branch === "main",
    );
    const betaDev = metric.values.find(
      (v) => v.labels.repo === "owner/beta" && v.labels.branch === "dev",
    );
    expect(alphaMain?.value).toBeGreaterThanOrEqual(2);
    expect(betaDev?.value).toBeGreaterThanOrEqual(1);
  });

  it("recordDiscordTriageResult emits a label per {category, urgency, actionable}", async () => {
    recordDiscordTriageResult({ category: "bug_report", urgency: "high", actionable: true });
    recordDiscordTriageResult({ category: "bug_report", urgency: "high", actionable: true });
    recordDiscordTriageResult({ category: "chatter", urgency: "low", actionable: false });

    const metric = await client.register.getSingleMetric("discord_triage_results_total")!.get();
    const bug = metric.values.find(
      (v) =>
        v.labels.category === "bug_report" &&
        v.labels.urgency === "high" &&
        v.labels.actionable === "true",
    );
    const chatter = metric.values.find(
      (v) =>
        v.labels.category === "chatter" &&
        v.labels.urgency === "low" &&
        v.labels.actionable === "false",
    );
    expect(bug?.value).toBeGreaterThanOrEqual(2);
    expect(chatter?.value).toBeGreaterThanOrEqual(1);
  });
});
