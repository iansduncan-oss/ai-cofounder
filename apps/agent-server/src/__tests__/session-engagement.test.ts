import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const dbMocks = mockDbModule();
vi.mock("@ai-cofounder/db", () => dbMocks);

const { SessionEngagementService } = await import("../services/session-engagement.js");

describe("SessionEngagementService", () => {
  let service: InstanceType<typeof SessionEngagementService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SessionEngagementService({} as any);
  });

  it("creates a new session when no existing session", async () => {
    dbMocks.getLatestSessionEngagement.mockResolvedValueOnce(null);
    await service.recordMessage("user-1", "Hello world", true);
    expect(dbMocks.upsertSessionEngagement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-1", messageCount: 1 }),
    );
  });

  it("creates new session after 30min gap", async () => {
    dbMocks.getLatestSessionEngagement.mockResolvedValueOnce({
      id: "se-1",
      messageCount: 5,
      lastMessageAt: new Date(Date.now() - 31 * 60 * 1000),
      avgMessageLength: 50,
      avgResponseIntervalMs: 10000,
      complexityScore: 40,
    });
    await service.recordMessage("user-1", "Back again", true);
    expect(dbMocks.upsertSessionEngagement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageCount: 1 }),
    );
  });

  it("updates existing session within 30min", async () => {
    dbMocks.getLatestSessionEngagement.mockResolvedValueOnce({
      id: "se-1",
      messageCount: 3,
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000),
      avgMessageLength: 50,
      avgResponseIntervalMs: 10000,
      complexityScore: 40,
    });
    await service.recordMessage("user-1", "Follow up message", true);
    expect(dbMocks.upsertSessionEngagement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "se-1", messageCount: 4 }),
    );
  });

  it("scores complexity higher for code blocks", () => {
    const simple = service.scoreComplexity("hello");
    const complex = service.scoreComplexity("```typescript\nconst x = 1;\n```\nCan you refactor this?");
    expect(complex).toBeGreaterThan(simple);
  });

  it("scores complexity higher for technical terms", () => {
    const simple = service.scoreComplexity("how are you");
    const tech = service.scoreComplexity("please deploy the API and run the database migration");
    expect(tech).toBeGreaterThan(simple);
  });

  it("derives high energy for many messages + high complexity", () => {
    expect(service.deriveEnergyLevel(10, 65, 30000)).toBe("high");
  });

  it("derives low energy for few messages + low complexity", () => {
    expect(service.deriveEnergyLevel(1, 20, 0)).toBe("low");
  });

  it("derives normal energy for moderate engagement", () => {
    expect(service.deriveEnergyLevel(4, 50, 120000)).toBe("normal");
  });

  it("getEngagementContext returns null when no session", async () => {
    dbMocks.getLatestSessionEngagement.mockResolvedValueOnce(null);
    const result = await service.getEngagementContext("user-1");
    expect(result).toBeNull();
  });

  it("getEngagementContext returns guidance for active session", async () => {
    dbMocks.getLatestSessionEngagement.mockResolvedValueOnce({
      id: "se-1",
      energyLevel: "high",
      messageCount: 12,
      complexityScore: 70,
      lastMessageAt: new Date(),
    });
    const result = await service.getEngagementContext("user-1");
    expect(result).toContain("highly engaged");
    expect(result).toContain("12 messages");
  });

  it("handles DB errors gracefully in recordMessage", async () => {
    dbMocks.getLatestSessionEngagement.mockRejectedValueOnce(new Error("DB error"));
    // Should not throw
    await service.recordMessage("user-1", "test", true);
  });
});
