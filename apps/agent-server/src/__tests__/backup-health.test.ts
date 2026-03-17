import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

const { MonitoringService } = await import("../services/monitoring.js");

function makeService(overrides?: Partial<{ vpsHost: string; vpsUser: string }>) {
  return new MonitoringService({
    vpsHost: overrides?.vpsHost ?? "10.0.0.1",
    vpsUser: overrides?.vpsUser ?? "ian",
    notificationService: {
      sendBriefing: vi.fn(),
      notifyApprovalNeeded: vi.fn(),
      notifyApprovalReminder: vi.fn(),
      notifyGoalComplete: vi.fn(),
      notifyStaleGoals: vi.fn(),
      notifyQuietCheckIn: vi.fn(),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkBackupHealth", () => {
  it("returns fresh status when backup is recent", async () => {
    const recentEpoch = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    mockExecFile.mockResolvedValue({ stdout: `${recentEpoch} /backups/ai-cofounder/latest/db.dump\n` });

    const svc = makeService();
    const result = await svc.checkBackupHealth();

    expect(result).not.toBeNull();
    expect(result!.isFresh).toBe(true);
    expect(result!.lastBackupAge).toBeLessThan(2);
  });

  it("returns stale status when backup is old", async () => {
    const oldEpoch = Math.floor(Date.now() / 1000) - 48 * 3600; // 48 hours ago
    mockExecFile.mockResolvedValue({ stdout: `${oldEpoch} /backups/ai-cofounder/latest/db.dump\n` });

    const svc = makeService();
    const result = await svc.checkBackupHealth();

    expect(result).not.toBeNull();
    expect(result!.isFresh).toBe(false);
    expect(result!.lastBackupAge).toBeGreaterThan(36);
  });

  it("returns missing status when no backup found", async () => {
    mockExecFile.mockResolvedValue({ stdout: "no-backup\n" });

    const svc = makeService();
    const result = await svc.checkBackupHealth();

    expect(result).not.toBeNull();
    expect(result!.isFresh).toBe(false);
    expect(result!.lastBackupAge).toBe(Infinity);
    expect(result!.lastBackupFile).toBe("none");
  });

  it("returns null when VPS is not configured", async () => {
    const svc = makeService({ vpsHost: "", vpsUser: "" });
    const result = await svc.checkBackupHealth();
    expect(result).toBeNull();
  });

  it("returns null on SSH failure", async () => {
    mockExecFile.mockRejectedValue(new Error("Connection refused"));

    const svc = makeService();
    const result = await svc.checkBackupHealth();
    expect(result).toBeNull();
  });
});

describe("runFullCheck includes backup", () => {
  it("generates warning alert for stale backup", async () => {
    const svc = makeService();
    vi.spyOn(svc, "checkGitHubCI").mockResolvedValue([]);
    vi.spyOn(svc, "checkGitHubPRs").mockResolvedValue([]);
    vi.spyOn(svc, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(svc, "checkBackupHealth").mockResolvedValue({
      lastBackupAge: 40,
      lastBackupFile: "/backups/ai-cofounder/latest/db.dump",
      isFresh: false,
    });

    const report = await svc.runFullCheck();

    const backupAlerts = report.alerts.filter((a) => a.source === "backup");
    expect(backupAlerts).toHaveLength(1);
    expect(backupAlerts[0].severity).toBe("warning");
    expect(report.backup).toBeDefined();
    expect(report.backup!.isFresh).toBe(false);
  });

  it("generates critical alert when backup is very old", async () => {
    const svc = makeService();
    vi.spyOn(svc, "checkGitHubCI").mockResolvedValue([]);
    vi.spyOn(svc, "checkGitHubPRs").mockResolvedValue([]);
    vi.spyOn(svc, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(svc, "checkBackupHealth").mockResolvedValue({
      lastBackupAge: 72,
      lastBackupFile: "/backups/ai-cofounder/latest/db.dump",
      isFresh: false,
    });

    const report = await svc.runFullCheck();

    const backupAlerts = report.alerts.filter((a) => a.source === "backup");
    expect(backupAlerts).toHaveLength(1);
    expect(backupAlerts[0].severity).toBe("critical");
  });

  it("no backup alert when backup is fresh", async () => {
    const svc = makeService();
    vi.spyOn(svc, "checkGitHubCI").mockResolvedValue([]);
    vi.spyOn(svc, "checkGitHubPRs").mockResolvedValue([]);
    vi.spyOn(svc, "checkVPSHealth").mockResolvedValue(null);
    vi.spyOn(svc, "checkBackupHealth").mockResolvedValue({
      lastBackupAge: 1,
      lastBackupFile: "/backups/ai-cofounder/latest/db.dump",
      isFresh: true,
    });

    const report = await svc.runFullCheck();

    const backupAlerts = report.alerts.filter((a) => a.source === "backup");
    expect(backupAlerts).toHaveLength(0);
    expect(report.backup).toBeDefined();
    expect(report.backup!.isFresh).toBe(true);
  });
});
