import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sent: string[] = [];

  constructor(public url: string) {
    // Simulate async open
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Track instances
let wsInstances: MockWebSocket[] = [];
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  wsInstances = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.WebSocket = class extends (MockWebSocket as unknown as typeof WebSocket) {
    constructor(url: string) {
      super(url);
      wsInstances.push(this as unknown as MockWebSocket);
    }
  } as unknown as typeof WebSocket;
  // Set WebSocket constants
  (globalThis.WebSocket as unknown as Record<string, number>).OPEN = 1;
  (globalThis.WebSocket as unknown as Record<string, number>).CONNECTING = 0;
  (globalThis.WebSocket as unknown as Record<string, number>).CLOSING = 2;
  (globalThis.WebSocket as unknown as Record<string, number>).CLOSED = 3;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = OriginalWebSocket;
});

// Mock the auth module
vi.mock("@/hooks/use-auth", () => ({
  getAccessToken: vi.fn().mockReturnValue("test-token"),
  setAccessToken: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useRealtimeSync", () => {
  it("connects to WebSocket on mount", async () => {
    // Dynamic import to ensure mocks are set up
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    const { result } = renderHook(() => useRealtimeSync(), {
      wrapper: createWrapper(),
    });

    // Initially connecting
    expect(result.current.status).toBe("connecting");

    // Wait for mock WS to "open"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    expect(wsInstances.length).toBe(1);
    expect(wsInstances[0].url).toContain("/ws");
    expect(wsInstances[0].url).toContain("token=test-token");
  });

  it("sends subscribe message on connect", async () => {
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    renderHook(() => useRealtimeSync({ channels: ["tasks", "goals"] }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const ws = wsInstances[0];
    expect(ws.sent.length).toBeGreaterThan(0);

    const firstMsg = JSON.parse(ws.sent[0]);
    expect(firstMsg.type).toBe("subscribe");
    expect(firstMsg.channels).toEqual(["tasks", "goals"]);
  });

  it("invalidates queries on invalidate message", async () => {
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    renderHook(() => useRealtimeSync(), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    // Simulate receiving an invalidate message
    const ws = wsInstances[0];
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: "invalidate", channel: "tasks" }) });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks", "pending"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  it("does not connect when enabled=false", async () => {
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    const { result } = renderHook(
      () => useRealtimeSync({ enabled: false }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(result.current.status).toBe("disconnected");
    expect(wsInstances.length).toBe(0);
  });

  it("exposes subscribeGoal and unsubscribeGoal", async () => {
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    const { result } = renderHook(() => useRealtimeSync(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    act(() => {
      result.current.subscribeGoal("goal-123");
    });

    const ws = wsInstances[0];
    const goalSub = ws.sent.find((s) => {
      const msg = JSON.parse(s);
      return msg.type === "subscribe_goal";
    });
    expect(goalSub).toBeDefined();
    expect(JSON.parse(goalSub!).goalId).toBe("goal-123");

    act(() => {
      result.current.unsubscribeGoal("goal-123");
    });

    const goalUnsub = ws.sent.find((s) => {
      const msg = JSON.parse(s);
      return msg.type === "unsubscribe_goal";
    });
    expect(goalUnsub).toBeDefined();
  });

  it("dispatches custom event on goal_event message", async () => {
    const { useRealtimeSync } = await import("@/hooks/use-realtime-sync");

    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const eventPromise = new Promise<CustomEvent>((resolve) => {
      window.addEventListener("ws:goal_event", (e) => resolve(e as CustomEvent), { once: true });
    });

    const ws = wsInstances[0];
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "goal_event",
          goalId: "g-1",
          data: { status: "running" },
        }),
      });
    });

    const event = await eventPromise;
    expect(event.detail.goalId).toBe("g-1");
    expect(event.detail.data.status).toBe("running");
  });
});
