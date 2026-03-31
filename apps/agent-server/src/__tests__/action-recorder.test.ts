import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/db
const mockRecordUserAction = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  recordUserAction: (...args: unknown[]) => mockRecordUserAction(...args),
}));

const { recordActionSafe } = await import("../services/action-recorder.js");

describe("recordActionSafe", () => {
  const mockDb = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records action to database", () => {
    mockRecordUserAction.mockResolvedValueOnce({ id: "action-1" });

    recordActionSafe(mockDb, {
      workspaceId: "ws-1",
      userId: "user-1",
      actionType: "command",
      actionDetail: "ran /ask",
      metadata: { command: "ask" },
    });

    expect(mockRecordUserAction).toHaveBeenCalledWith(mockDb, {
      workspaceId: "ws-1",
      userId: "user-1",
      actionType: "command",
      actionDetail: "ran /ask",
      metadata: { command: "ask" },
    });
  });

  it("never throws on errors (fire-and-forget)", () => {
    mockRecordUserAction.mockRejectedValueOnce(new Error("DB connection lost"));

    // Should not throw
    expect(() =>
      recordActionSafe(mockDb, {
        actionType: "test",
      }),
    ).not.toThrow();
  });

  it("passes correct action shape to DB", () => {
    mockRecordUserAction.mockResolvedValueOnce({ id: "action-2" });

    recordActionSafe(mockDb, {
      actionType: "goal_created",
      userId: "user-2",
    });

    expect(mockRecordUserAction).toHaveBeenCalledTimes(1);
    const calledArgs = mockRecordUserAction.mock.calls[0];
    expect(calledArgs[0]).toBe(mockDb);
    expect(calledArgs[1]).toEqual({
      actionType: "goal_created",
      userId: "user-2",
    });
  });

  it("handles missing optional fields", () => {
    mockRecordUserAction.mockResolvedValueOnce({ id: "action-3" });

    recordActionSafe(mockDb, {
      actionType: "minimal_action",
    });

    expect(mockRecordUserAction).toHaveBeenCalledWith(mockDb, {
      actionType: "minimal_action",
    });
  });
});
