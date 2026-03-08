import { renderHook, act } from "@testing-library/react";
import { useSSE } from "@/hooks/use-sse";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((err: Event) => void) | null = null;
  readyState = 0;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSSE", () => {
  it("does not connect when url is null", () => {
    renderHook(() => useSSE(null));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("connects when url is provided", () => {
    renderHook(() => useSSE("/api/goals/1/execute/stream"));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain("/api/goals/1/execute/stream");
  });

  it("sets isConnected on open", () => {
    const { result } = renderHook(() => useSSE("/api/test"));
    expect(result.current.isConnected).toBe(false);

    act(() => {
      MockEventSource.instances[0].onopen?.();
    });
    expect(result.current.isConnected).toBe(true);
  });

  it("accumulates events on message", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useSSE("/api/test", { onMessage }),
    );

    act(() => {
      MockEventSource.instances[0].onopen?.();
    });

    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({ status: "running", task: "test" }),
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(onMessage).toHaveBeenCalledWith({ status: "running", task: "test" });
  });

  it("closes on completed status", () => {
    const onComplete = vi.fn();
    renderHook(() => useSSE("/api/test", { onComplete }));
    const source = MockEventSource.instances[0];

    act(() => source.onopen?.());
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ status: "completed" }),
      });
    });

    expect(source.close).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it("disconnects and resets on reset()", () => {
    const { result } = renderHook(() => useSSE("/api/test"));
    const source = MockEventSource.instances[0];

    act(() => source.onopen?.());
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ status: "running" }),
      });
    });

    expect(result.current.events).toHaveLength(1);

    act(() => result.current.reset());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(source.close).toHaveBeenCalled();
  });

  it("handles connection timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useSSE("/api/test", { timeoutMs: 5000 }),
    );

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.error).toBe("Connection timed out");
    vi.useRealTimers();
  });
});
