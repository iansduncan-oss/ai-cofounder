import { describe, it, expect, vi } from "vitest";
import {
  mockSharedModule,
  mockDbModule,
  mockLlmModule,
  mockQueueModule,
  mockSandboxModule,
  createMockComplete,
  createTestApp,
} from "@ai-cofounder/test-utils";

const mockComplete = createMockComplete();

vi.mock("@ai-cofounder/shared", () => mockSharedModule());

const mockGlobalSearch = vi.fn().mockResolvedValue({
  goals: [],
  tasks: [],
  conversations: [],
  memories: [],
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  globalSearch: (...args: unknown[]) => mockGlobalSearch(...args),
}));

vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));

const { queueModule } = mockQueueModule();
vi.mock("@ai-cofounder/queue", () => queueModule);

vi.mock("@ai-cofounder/sandbox", () => mockSandboxModule());

const { buildServer } = await import("../server.js");
const { app } = await createTestApp(buildServer);

describe("Search Routes", () => {
  it("GET /api/search?q=test returns categorized results", async () => {
    mockGlobalSearch.mockResolvedValueOnce({
      goals: [
        { id: "g-1", title: "Test Goal", status: "active", createdAt: new Date().toISOString() },
      ],
      tasks: [
        {
          id: "t-1",
          title: "Test Task",
          status: "pending",
          goalId: "g-1",
          createdAt: new Date().toISOString(),
        },
      ],
      conversations: [],
      memories: [],
    });

    const res = await app.inject({ method: "GET", url: "/api/search?q=test" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.goals).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.conversations).toEqual([]);
    expect(body.memories).toEqual([]);
    expect(mockGlobalSearch).toHaveBeenCalledWith(expect.anything(), "test");
  });

  it("rejects query shorter than 2 characters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=a" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing query parameter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search" });
    expect(res.statusCode).toBe(400);
  });
});
