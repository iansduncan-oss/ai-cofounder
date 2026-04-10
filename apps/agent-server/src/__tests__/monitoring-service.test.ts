import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock node:child_process and node:util so checkVPSHealth / checkBackupHealth
// don't actually SSH anywhere.
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

const { MonitoringService } = await import("../services/monitoring.js");

// ── helpers ──

function makeNotificationService() {
  return {
    sendBriefing: vi.fn(),
    notifyApprovalNeeded: vi.fn(),
    notifyApprovalReminder: vi.fn(),
    notifyGoalComplete: vi.fn(),
    notifyStaleGoals: vi.fn(),
    notifyQuietCheckIn: vi.fn(),
  };
}

function makeService(
  overrides?: Partial<{
    githubToken: string;
    githubRepos: string[];
    vpsHost: string;
    vpsUser: string;
  }>,
) {
  return new MonitoringService({
    githubToken: overrides?.githubToken ?? "test-token",
    githubRepos: overrides?.githubRepos ?? ["owner/repo"],
    vpsHost: overrides?.vpsHost ?? "10.0.0.1",
    vpsUser: overrides?.vpsUser ?? "test-user",
    notificationService: makeNotificationService(),
  });
}

// ── mock fetch helpers ──

function mockFetchSequence(...responses: Array<{ ok: boolean; json?: unknown; status?: number }>) {
  const mockFetch = vi.fn();
  for (const res of responses) {
    mockFetch.mockResolvedValueOnce({
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      json: () => Promise.resolve(res.json ?? {}),
    });
  }
  global.fetch = mockFetch;
  return mockFetch;
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

// ─────────────────────────────────────────────────
// generateReport (runFullCheck) – GitHub integration
// ─────────────────────────────────────────────────

describe("MonitoringService – runFullCheck", () => {
  it("includes GitHub CI status when token is configured", async () => {
    const service = makeService();

    // CI runs endpoint, then PRs endpoint
    mockFetchSequence(
      {
        ok: true,
        json: {
          workflow_runs: [
            {
              head_branch: "main",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/owner/repo/actions/runs/1",
              updated_at: "2026-04-10T10:00:00Z",
            },
          ],
        },
      },
      { ok: true, json: [] }, // PRs
    );

    // stub VPS/backup so they don't SSH
    vi.spyOn(service, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    const report = await service.runFullCheck();

    expect(report.github).toBeDefined();
    expect(report.github!.ciStatus).toHaveLength(1);
    expect(report.github!.ciStatus[0].repo).toBe("owner/repo");
    expect(report.github!.ciStatus[0].status).toBe("completed");
    expect(report.github!.ciStatus[0].conclusion).toBe("success");
  });

  it("includes open PRs in the report", async () => {
    const service = makeService();

    mockFetchSequence(
      { ok: true, json: { workflow_runs: [] } }, // CI
      {
        ok: true,
        json: [
          {
            number: 42,
            title: "Add feature X",
            user: { login: "dev1" },
            html_url: "https://github.com/owner/repo/pull/42",
            created_at: new Date().toISOString(),
            draft: false,
          },
        ],
      },
    );

    vi.spyOn(service, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    const report = await service.runFullCheck();

    expect(report.github).toBeDefined();
    expect(report.github!.openPRs).toHaveLength(1);
    expect(report.github!.openPRs[0].number).toBe(42);
    expect(report.github!.openPRs[0].title).toBe("Add feature X");
    expect(report.github!.openPRs[0].author).toBe("dev1");
  });

  it("handles GitHub API error gracefully", async () => {
    const service = makeService();

    // Both endpoints return errors
    mockFetchSequence(
      { ok: false, status: 403 },
      { ok: false, status: 403 },
    );

    vi.spyOn(service, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    const report = await service.runFullCheck();

    // Should still produce a report without crashing
    expect(report.github).toBeDefined();
    expect(report.github!.ciStatus).toHaveLength(0);
    expect(report.github!.openPRs).toHaveLength(0);
  });

  it("skips GitHub section when token is not set", async () => {
    const service = makeService({ githubToken: "", githubRepos: [] });

    vi.spyOn(service, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    const report = await service.runFullCheck();

    // No GitHub section at all
    expect(report.github).toBeUndefined();
  });

  it("report includes a timestamp", async () => {
    const service = makeService({ githubToken: "", githubRepos: [] });

    vi.spyOn(service, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    const before = new Date().toISOString();
    const report = await service.runFullCheck();
    const after = new Date().toISOString();

    expect(report.timestamp).toBeDefined();
    expect(report.timestamp >= before).toBe(true);
    expect(report.timestamp <= after).toBe(true);
  });
});

// ─────────────────────────────────────────
// VPS health alert thresholds
// ─────────────────────────────────────────

describe("MonitoringService – VPS alerts", () => {
  function runWithVPSHealth(vps: {
    diskUsagePercent: number;
    memoryUsagePercent: number;
    cpuLoadAvg: number[];
    uptime?: string;
    containers?: Array<{ name: string; status: string; health: string; uptime: string }>;
  }) {
    const service = makeService({ githubToken: "", githubRepos: [] });

    vi.spyOn(service, "checkVPSHealth").mockResolvedValue({
      diskUsagePercent: vps.diskUsagePercent,
      memoryUsagePercent: vps.memoryUsagePercent,
      cpuLoadAvg: vps.cpuLoadAvg,
      uptime: vps.uptime ?? "up 10 days",
      containers: vps.containers ?? [],
    });
    vi.spyOn(service, "checkBackupHealth").mockResolvedValue(null);

    return service.runFullCheck();
  }

  it("generates CPU alert when load average > 4", async () => {
    const report = await runWithVPSHealth({
      diskUsagePercent: 40,
      memoryUsagePercent: 50,
      cpuLoadAvg: [5.2, 4.1, 3.5],
    });

    const cpuAlerts = report.alerts.filter(
      (a: { source: string }) => a.source === "vps" && a.message.includes("CPU"),
    );
    expect(cpuAlerts).toHaveLength(1);
    expect(cpuAlerts[0].severity).toBe("warning");
    expect(cpuAlerts[0].message).toContain("5.2");
  });

  it("generates memory alert when usage > 90%", async () => {
    const report = await runWithVPSHealth({
      diskUsagePercent: 40,
      memoryUsagePercent: 93,
      cpuLoadAvg: [1, 1, 1],
    });

    const memAlerts = report.alerts.filter(
      (a: { source: string }) => a.source === "vps" && a.message.includes("Memory"),
    );
    expect(memAlerts).toHaveLength(1);
    expect(memAlerts[0].severity).toBe("critical");
    expect(memAlerts[0].message).toContain("93");
  });

  it("generates disk alert when usage > 90% (critical)", async () => {
    const report = await runWithVPSHealth({
      diskUsagePercent: 92,
      memoryUsagePercent: 50,
      cpuLoadAvg: [1, 1, 1],
    });

    const diskAlerts = report.alerts.filter(
      (a: { source: string }) => a.source === "vps" && a.message.includes("Disk"),
    );
    expect(diskAlerts).toHaveLength(1);
    expect(diskAlerts[0].severity).toBe("critical");
    expect(diskAlerts[0].message).toContain("92");
  });

  it("generates disk warning when usage > 75% but <= 90%", async () => {
    const report = await runWithVPSHealth({
      diskUsagePercent: 86,
      memoryUsagePercent: 50,
      cpuLoadAvg: [1, 1, 1],
    });

    const diskAlerts = report.alerts.filter(
      (a: { source: string }) => a.source === "vps" && a.message.includes("Disk"),
    );
    expect(diskAlerts).toHaveLength(1);
    expect(diskAlerts[0].severity).toBe("warning");
  });

  it("generates no alerts when all metrics are healthy", async () => {
    const report = await runWithVPSHealth({
      diskUsagePercent: 40,
      memoryUsagePercent: 55,
      cpuLoadAvg: [1.2, 0.8, 0.6],
    });

    const vpsAlerts = report.alerts.filter((a: { source: string }) => a.source === "vps");
    expect(vpsAlerts).toHaveLength(0);
  });
});
