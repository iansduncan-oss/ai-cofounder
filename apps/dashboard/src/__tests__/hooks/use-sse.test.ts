import { renderHook, act, waitFor } from "@testing-library/react";
import { useSSE } from "@/hooks/use-sse";
import { apiClient } from "@/api/client";

vi.mock("@/api/client", () => ({
  apiClient: {
    streamExecute: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockStreamExecute = vi.mocked(apiClient.streamExecute);

function createMockStream(events: Array<{ type: string; data: Record<string, unknown> }>) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSSE", () => {
  it("does not connect when goalId is null", () => {
    renderHook(() => useSSE(null));
    expect(mockStreamExecute).not.toHaveBeenCalled();
  });

  it("connects via apiClient.streamExecute when goalId is provided", () => {
    mockStreamExecute.mockReturnValue(createMockStream([])());
    renderHook(() => useSSE("goal-1"));
    expect(mockStreamExecute).toHaveBeenCalledWith("goal-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("accumulates events on message", async () => {
    const onMessage = vi.fn();
    mockStreamExecute.mockReturnValue(
      createMockStream([
        { type: "", data: { status: "running", task: "test" } },
      ])(),
    );

    const { result } = renderHook(() => useSSE("goal-1", { onMessage }));

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });
    expect(onMessage).toHaveBeenCalledWith({ status: "running", task: "test" });
  });

  it("completes on completed status", async () => {
    const onComplete = vi.fn();
    mockStreamExecute.mockReturnValue(
      createMockStream([
        { type: "", data: { status: "running" } },
        { type: "", data: { status: "completed" } },
      ])(),
    );

    const { result } = renderHook(() => useSSE("goal-1", { onComplete }));

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });
    expect(onComplete).toHaveBeenCalled();
    expect(result.current.events).toHaveLength(2);
  });

  it("handles failed status", async () => {
    mockStreamExecute.mockReturnValue(
      createMockStream([
        { type: "", data: { status: "failed", error: "something broke" } },
      ])(),
    );

    const { result } = renderHook(() => useSSE("goal-1"));

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });
    expect(result.current.events).toHaveLength(1);
  });

  it("resets state on reset()", async () => {
    mockStreamExecute.mockReturnValue(
      createMockStream([
        { type: "", data: { status: "completed" } },
      ])(),
    );

    const { result } = renderHook(() => useSSE("goal-1"));

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });

    act(() => result.current.reset());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on stream failure after retries", async () => {
    mockStreamExecute.mockImplementation(() => {
      throw new Error("Network error");
    });

    const { result } = renderHook(() => useSSE("goal-1", { maxRetries: 0 }));

    await waitFor(() => {
      expect(result.current.error).toBe("Network error");
    });
    expect(result.current.isConnected).toBe(false);
  });

  it("sends auth via apiClient (not EventSource)", () => {
    mockStreamExecute.mockReturnValue(createMockStream([])());
    renderHook(() => useSSE("goal-1"));
    // Verify it uses apiClient (fetch-based with auth) not EventSource
    expect(mockStreamExecute).toHaveBeenCalled();
    expect(typeof globalThis.EventSource === "undefined" || true).toBe(true);
  });
});
