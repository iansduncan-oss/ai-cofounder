import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { MonitoringService } = await import("../services/monitoring.js");

describe("MonitoringService", () => {
  const mockNotificationService = {
    sendBriefing: vi.fn().mockResolvedValue(undefined),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  };

  let service: InstanceType<typeof MonitoringService>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MonitoringService({
      githubToken: "test-token",
      githubRepos: ["owner/repo"],
      vpsHost: "test-host",
      vpsUser: "test-user",
      notificationService: mockNotificationService as never,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("checkGitHubCI", () => {
    it("returns workflow runs", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            workflow_runs: [
              {
                head_branch: "main",
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/owner/repo/actions/runs/1",
                updated_at: "2026-03-30T12:00:00Z",
              },
              {
                head_branch: "main",
                status: "completed",
                conclusion: "failure",
                html_url: "https://github.com/owner/repo/actions/runs/2",
                updated_at: "2026-03-30T11:00:00Z",
              },
            ],
          }),
      });
      globalThis.fetch = mockFetch;

      const results = await service.checkGitHubCI();

      expect(results).toHaveLength(2);
      expect(results[0].repo).toBe("owner/repo");
      expect(results[0].branch).toBe("main");
      expect(results[0].conclusion).toBe("success");
      expect(results[1].conclusion).toBe("failure");

      // Verify correct API URL
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("owner/repo/actions/runs"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("returns empty array when GitHub not configured", async () => {
      const unconfiguredService = new MonitoringService({
        notificationService: mockNotificationService as never,
      });

      const results = await unconfiguredService.checkGitHubCI();
      expect(results).toEqual([]);
    });

    it("continues on API error for a repo", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
      });
      globalThis.fetch = mockFetch;

      const results = await service.checkGitHubCI();
      expect(results).toEqual([]);
    });
  });

  describe("checkVPSHealth", () => {
    it("returns null when VPS not configured", async () => {
      const unconfiguredService = new MonitoringService({
        notificationService: mockNotificationService as never,
      });

      const result = await unconfiguredService.checkVPSHealth();
      expect(result).toBeNull();
    });
  });

  describe("runFullCheck", () => {
    it("orchestrates all checks and returns report", async () => {
      // Mock GitHub CI
      const mockFetch = vi.fn()
        // checkGitHubCI
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow_runs: [
                {
                  head_branch: "main",
                  status: "completed",
                  conclusion: "success",
                  html_url: "https://github.com/owner/repo/actions/runs/1",
                  updated_at: "2026-03-30T12:00:00Z",
                },
              ],
            }),
        })
        // checkGitHubPRs
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      globalThis.fetch = mockFetch;

      // Mock SSH calls to fail so VPS/backup returns null
      vi.mock("node:child_process", () => ({
        execFile: vi.fn(),
      }));
      vi.mock("node:util", () => ({
        promisify: () => vi.fn().mockRejectedValue(new Error("SSH not available")),
      }));

      const report = await service.runFullCheck();

      expect(report.timestamp).toBeDefined();
      expect(report.github).toBeDefined();
      expect(report.github?.ciStatus).toHaveLength(1);
      expect(report.alerts).toBeDefined();
      expect(Array.isArray(report.alerts)).toBe(true);
    });

    it("generates alerts on CI failure", async () => {
      const mockFetch = vi.fn()
        // checkGitHubCI
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow_runs: [
                {
                  head_branch: "main",
                  status: "completed",
                  conclusion: "failure",
                  html_url: "https://github.com/owner/repo/actions/runs/1",
                  updated_at: "2026-03-30T12:00:00Z",
                },
              ],
            }),
        })
        // checkGitHubPRs
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      globalThis.fetch = mockFetch;

      const report = await service.runFullCheck();

      const ciAlerts = report.alerts.filter((a) => a.source === "github-ci");
      expect(ciAlerts).toHaveLength(1);
      expect(ciAlerts[0].severity).toBe("critical");
      expect(ciAlerts[0].message).toContain("CI failed");

      // Should send critical notification
      expect(mockNotificationService.sendBriefing).toHaveBeenCalledWith(
        expect.stringContaining("CRITICAL ALERTS"),
      );
    });

    it("avoids duplicate alerts via state tracking", async () => {
      const makeCIResponse = () => ({
        ok: true,
        json: () =>
          Promise.resolve({
            workflow_runs: [
              {
                head_branch: "main",
                status: "completed",
                conclusion: "failure",
                html_url: "https://github.com/owner/repo/actions/runs/1",
                updated_at: "2026-03-30T12:00:00Z",
              },
            ],
          }),
      });
      const makePRResponse = () => ({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // First check
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(makeCIResponse())
        .mockResolvedValueOnce(makePRResponse());

      const report1 = await service.runFullCheck();
      const ciAlerts1 = report1.alerts.filter((a) => a.source === "github-ci");
      expect(ciAlerts1).toHaveLength(1);

      // Second check with same failure — should NOT generate duplicate alert
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(makeCIResponse())
        .mockResolvedValueOnce(makePRResponse());

      const report2 = await service.runFullCheck();
      const ciAlerts2 = report2.alerts.filter((a) => a.source === "github-ci");
      expect(ciAlerts2).toHaveLength(0);
    });

    it("generates recovery info alert when CI succeeds after failure", async () => {
      // First: failure
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow_runs: [
                {
                  head_branch: "main",
                  status: "completed",
                  conclusion: "failure",
                  html_url: "https://github.com/owner/repo/actions/runs/1",
                  updated_at: "2026-03-30T12:00:00Z",
                },
              ],
            }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

      await service.runFullCheck();

      // Second: success (recovery)
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow_runs: [
                {
                  head_branch: "main",
                  status: "completed",
                  conclusion: "success",
                  html_url: "https://github.com/owner/repo/actions/runs/2",
                  updated_at: "2026-03-30T13:00:00Z",
                },
              ],
            }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

      const report2 = await service.runFullCheck();

      const recoveryAlerts = report2.alerts.filter(
        (a) => a.source === "github-ci" && a.severity === "info",
      );
      expect(recoveryAlerts).toHaveLength(1);
      expect(recoveryAlerts[0].message).toContain("recovered");
    });

    it("generates warning for stale PRs older than 48h", async () => {
      const staleDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72h ago

      globalThis.fetch = vi.fn()
        // CI
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ workflow_runs: [] }),
        })
        // PRs
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                number: 42,
                title: "Old PR",
                user: { login: "dev" },
                html_url: "https://github.com/owner/repo/pull/42",
                created_at: staleDate,
                draft: false,
              },
            ]),
        });

      const report = await service.runFullCheck();

      const prAlerts = report.alerts.filter((a) => a.source === "github-prs");
      expect(prAlerts).toHaveLength(1);
      expect(prAlerts[0].severity).toBe("warning");
      expect(prAlerts[0].message).toContain("Old PR");
    });

    it("does not generate warning for draft PRs", async () => {
      const staleDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ workflow_runs: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                number: 43,
                title: "Draft PR",
                user: { login: "dev" },
                html_url: "https://github.com/owner/repo/pull/43",
                created_at: staleDate,
                draft: true,
              },
            ]),
        });

      const report = await service.runFullCheck();
      const prAlerts = report.alerts.filter((a) => a.source === "github-prs");
      expect(prAlerts).toHaveLength(0);
    });
  });
});
