import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTestEnv } from "@ai-cofounder/test-utils";
import { mockDbModule } from "@ai-cofounder/test-utils";

setupTestEnv();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_n: string, d: string) => d,
}));

const mockDb = mockDbModule();
vi.mock("@ai-cofounder/db", () => mockDb);

vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class { complete = vi.fn(); },
}));

const { EpisodicMemoryService } = await import("../services/episodic-memory.js");

describe("EpisodicMemoryService", () => {
  let service: InstanceType<typeof EpisodicMemoryService>;
  const mockComplete = vi.fn();
  const mockEmbed = vi.fn().mockResolvedValue(new Array(768).fill(0));

  beforeEach(() => {
    vi.clearAllMocks();
    const registry = { complete: mockComplete } as never;
    service = new EpisodicMemoryService({} as never, registry, mockEmbed);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        summary: "Discussed auth implementation",
        keyDecisions: ["Use JWT"],
        toolsUsed: ["create_plan"],
        goalsWorkedOn: ["auth-feature"],
        emotionalContext: "productive",
        importance: 0.8,
      }) }],
    });
  });

  it("creates episode from conversation messages", async () => {
    mockDb.getConversationMessages.mockResolvedValueOnce([
      { role: "user", content: "Let's add auth" },
      { role: "assistant", content: "I'll create a plan" },
      { role: "user", content: "Looks good" },
    ]);
    mockDb.createEpisodicMemory.mockResolvedValueOnce({ id: "ep-1", summary: "test" });

    const result = await service.createEpisode("conv-1");
    expect(result).toBeTruthy();
    expect(mockDb.createEpisodicMemory).toHaveBeenCalledTimes(1);
    expect(mockDb.createEpisodicMemory.mock.calls[0][1].importance).toBe(0.8);
  });

  it("skips conversations with too few messages", async () => {
    mockDb.getConversationMessages.mockResolvedValueOnce([{ role: "user", content: "hi" }]);
    const result = await service.createEpisode("conv-1");
    expect(result).toBeNull();
  });

  it("handles LLM failure gracefully", async () => {
    mockDb.getConversationMessages.mockResolvedValueOnce([
      { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" },
    ]);
    mockComplete.mockRejectedValueOnce(new Error("LLM down"));
    const result = await service.createEpisode("conv-1");
    expect(result).toBeNull();
  });

  it("recalls episodes by semantic similarity", async () => {
    mockDb.searchEpisodicMemoriesByVector.mockResolvedValueOnce([
      { id: "ep-1", summary: "Auth discussion", importance: 0.8, created_at: new Date(), distance: 0.2, conversation_id: "c1", key_decisions: [], tools_used: [], goals_worked_on: [], emotional_context: null, accessed_at: new Date(), access_count: 0 },
    ]);

    const results = await service.recallEpisodes("authentication");
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("Auth discussion");
    expect(mockDb.touchEpisodicMemory).toHaveBeenCalledWith(expect.anything(), "ep-1");
  });

  it("returns empty on embed failure", async () => {
    mockEmbed.mockRejectedValueOnce(new Error("embed failed"));
    const results = await service.recallEpisodes("test");
    expect(results).toEqual([]);
  });
});
