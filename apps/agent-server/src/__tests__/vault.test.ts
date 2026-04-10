import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unique tmp vault for this test file; set BEFORE importing the modules under test
const vaultDir = await mkdtemp(join(tmpdir(), "vault-test-"));
process.env.VAULT_DIR = vaultDir;
process.env.BRIEFING_TIMEZONE = "UTC";

// optionalEnv must read from process.env so VAULT_DIR above takes effect
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, def: string) => process.env[name] ?? def,
}));

// Mock the db functions consumed by writeDailyNote — minimal surface
const mockListActiveGoals = vi.fn();
const mockListJournalEntries = vi.fn();
const mockListMemoriesByUser = vi.fn();
const mockGetPrimaryAdminUserId = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listJournalEntries: (...args: unknown[]) => mockListJournalEntries(...args),
  listMemoriesByUser: (...args: unknown[]) => mockListMemoriesByUser(...args),
  getPrimaryAdminUserId: (...args: unknown[]) => mockGetPrimaryAdminUserId(...args),
}));

const {
  ensureVaultStructure,
  writeDailyNote,
  writeProjectNote,
  writeDecisionNote,
} = await import("../services/vault.js");
const { vaultRoutes } = await import("../routes/vault.js");

// Minimal fake Db — vault functions pass it through to the mocked db functions
const fakeDb = {} as never;

function todayUtc(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
}

describe("vault service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrimaryAdminUserId.mockResolvedValue("admin-user-1");
    mockListActiveGoals.mockResolvedValue([]);
    mockListJournalEntries.mockResolvedValue({ data: [] });
    mockListMemoriesByUser.mockResolvedValue([]);
  });

  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  describe("ensureVaultStructure", () => {
    it("creates all expected subdirectories", async () => {
      await ensureVaultStructure();
      for (const sub of ["daily", "projects", "decisions", "people"]) {
        const stat = await import("node:fs/promises").then((m) => m.stat(join(vaultDir, sub)));
        expect(stat.isDirectory()).toBe(true);
      }
    });
  });

  describe("writeDailyNote", () => {
    it("skips and returns empty path when no admin user exists", async () => {
      mockGetPrimaryAdminUserId.mockResolvedValue(null);
      const result = await writeDailyNote(fakeDb);
      expect(result).toBe("");
    });

    it("writes a populated daily note with goals, journal, and memories", async () => {
      mockListActiveGoals.mockResolvedValue([
        { title: "Ship vault tests", status: "in_progress", priority: "high" },
      ]);
      mockListJournalEntries.mockResolvedValue({
        data: [
          { entryType: "decision", title: "Use tmpdir for tests", summary: "Avoid /opt pollution" },
          { entryType: "progress", title: "Got fake db working", summary: null },
        ],
      });
      mockListMemoriesByUser.mockResolvedValue([
        { category: "ops", key: "deploy-time", content: "Typically 3 minutes" },
      ]);

      const filePath = await writeDailyNote(fakeDb);
      expect(filePath).toContain(join(vaultDir, "daily"));
      const content = await readFile(filePath, "utf-8");

      expect(content).toContain(`# ${todayUtc()}`);
      expect(content).toContain("## Active Goals");
      expect(content).toContain("**Ship vault tests** (in_progress, high)");
      expect(content).toContain("## Journal");
      expect(content).toContain("[decision] Use tmpdir for tests: Avoid /opt pollution");
      expect(content).toContain("[progress] Got fake db working");
      expect(content).toContain("## Recent Memories");
      expect(content).toContain("[ops] **deploy-time**: Typically 3 minutes");
    });

    it("renders empty-state placeholders when db returns nothing", async () => {
      const filePath = await writeDailyNote(fakeDb);
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("_No active goals_");
      expect(content).toContain("_No entries today_");
      expect(content).toContain("_No recent memories_");
    });
  });

  describe("writeProjectNote", () => {
    it("creates a new project file with header and entry", async () => {
      const filePath = await writeProjectNote(
        fakeDb,
        "goal-42",
        "Launch Landing Page",
        "Picked Next.js + Tailwind",
      );
      expect(filePath.endsWith("launch-landing-page.md")).toBe(true);
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("# Launch Landing Page");
      expect(content).toContain("Goal ID: goal-42");
      expect(content).toContain("Picked Next.js + Tailwind");
    });

    it("appends to an existing file without duplicating the header", async () => {
      await writeProjectNote(fakeDb, "goal-42", "Launch Landing Page", "First entry");
      const filePath = await writeProjectNote(
        fakeDb,
        "goal-42",
        "Launch Landing Page",
        "Second entry",
      );
      const content = await readFile(filePath, "utf-8");
      // Header only once
      expect(content.match(/# Launch Landing Page/g)?.length).toBe(1);
      expect(content).toContain("First entry");
      expect(content).toContain("Second entry");
    });
  });

  describe("writeDecisionNote", () => {
    it("writes a dated decision file with a slugged filename", async () => {
      const filePath = await writeDecisionNote(
        "Adopt pnpm workspaces",
        "Turborepo + pnpm gives us the best DX",
      );
      expect(filePath).toContain("adopt-pnpm-workspaces.md");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("# Decision: Adopt pnpm workspaces");
      expect(content).toContain(`**Date:** ${todayUtc()}`);
      expect(content).toContain("Turborepo + pnpm gives us the best DX");
    });
  });
});

describe("vault routes", () => {
  // Use a minimal Fastify instance — vault routes have no app-decorator deps
  let app: import("fastify").FastifyInstance;

  beforeAll(async () => {
    const fastify = (await import("fastify")).default;
    app = fastify();
    await app.register(vaultRoutes, { prefix: "/api/vault" });
    await app.ready();

    // Seed the vault with a known set of files
    await mkdir(join(vaultDir, "daily"), { recursive: true });
    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await mkdir(join(vaultDir, "decisions"), { recursive: true });
    await writeFile(join(vaultDir, "daily", "2026-04-09.md"), "# 2026-04-09\n", "utf-8");
    await writeFile(join(vaultDir, "daily", "2026-04-08.md"), "# 2026-04-08\n", "utf-8");
    await writeFile(join(vaultDir, "projects", "launch.md"), "# Launch\n", "utf-8");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/vault/daily/:date", () => {
    it("returns the daily note contents", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/daily/2026-04-09" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.date).toBe("2026-04-09");
      expect(body.content).toContain("# 2026-04-09");
    });

    it("rejects malformed dates with 400", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/daily/2026-4-9" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("YYYY-MM-DD");
    });

    it("returns 404 when no note exists for a valid date", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/daily/1999-01-01" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/vault/daily", () => {
    it("lists available daily note dates in descending order", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/daily" });
      expect(res.statusCode).toBe(200);
      const { dates } = res.json() as { dates: string[] };
      expect(dates).toContain("2026-04-09");
      expect(dates).toContain("2026-04-08");
      expect(dates.indexOf("2026-04-09")).toBeLessThan(dates.indexOf("2026-04-08"));
    });
  });

  describe("GET /api/vault/:section", () => {
    it("lists files in a valid section", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/projects" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { section: string; files: string[] };
      expect(body.section).toBe("projects");
      expect(body.files).toContain("launch");
    });

    it("returns 400 for an invalid section", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/secrets" });
      expect(res.statusCode).toBe(400);
    });

    it("returns empty list for a section dir that does not exist", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/people" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ section: "people", files: [] });
    });
  });

  describe("GET /api/vault/:section/:slug", () => {
    it("returns file contents for a valid section+slug", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/projects/launch" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.section).toBe("projects");
      expect(body.slug).toBe("launch");
      expect(body.content).toContain("# Launch");
    });

    it("blocks path traversal via ..", async () => {
      const res = await app.inject({
        method: "GET",
        // Encoded traversal — fastify will decode into params before our check
        url: "/api/vault/projects/%2E%2E%2Fetc%2Fpasswd",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Invalid slug");
    });

    it("returns 400 for an invalid section", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/secrets/something" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for a missing file", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/projects/does-not-exist" });
      expect(res.statusCode).toBe(404);
    });
  });
});
