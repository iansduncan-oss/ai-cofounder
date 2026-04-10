import { renderHook, act } from "@testing-library/react";

// Build a controllable mock for ChatWebSocket
type Handler = (...args: unknown[]) => void;
function createMockChatWebSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
    close: vi.fn(),
    sendMessage: vi.fn(),
    isConnected: false,
    handlers,
  };
}

let mockWs: ReturnType<typeof createMockChatWebSocket>;

vi.mock("@/api/client", () => ({
  apiClient: {
    connectChatWebSocket: () => {
      mockWs = createMockChatWebSocket();
      return mockWs;
    },
    streamChat: vi.fn(),
  },
}));

import { useWsChat } from "@/hooks/use-ws-chat";

beforeEach(() => {
  mockWs = createMockChatWebSocket();
});

describe("useWsChat reducer transitions", () => {
  it("starts with initial state", () => {
    const { result } = renderHook(() => useWsChat());

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.accumulatedText).toBe("");
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.richCards).toEqual([]);
    expect(result.current.thinkingMessage).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.transport).toBe("none");
    expect(result.current.suggestions).toBeUndefined();
  });

  it("ws_connected sets isConnected and transport", () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("open");
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.transport).toBe("websocket");
  });

  it("ws_disconnected clears isConnected", () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("open");
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      mockWs.emit("close");
    });
    expect(result.current.isConnected).toBe(false);
  });

  it('"start" resets state but preserves connection status', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Connect first
    act(() => {
      mockWs.emit("open");
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.transport).toBe("websocket");

    // Simulate some accumulated state via events
    act(() => {
      mockWs.emit("agent_chunk", "some text");
    });
    expect(result.current.accumulatedText).toBe("some text");

    // Now sendMessage triggers "start" dispatch
    // We need the WS mock to appear connected
    mockWs.isConnected = true;
    act(() => {
      result.current.sendMessage("hello", "conv-1");
    });

    // After start: streaming is true, text is reset, but isConnected preserved
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.accumulatedText).toBe("");
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.transport).toBe("websocket");
  });

  it('"thinking" sets thinkingMessage', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("thinking", "Processing your request...");
    });

    expect(result.current.thinkingMessage).toBe("Processing your request...");
  });

  it('"tool_start" adds tool call and clears thinking', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Set thinking first
    act(() => {
      mockWs.emit("thinking", "Thinking...");
    });
    expect(result.current.thinkingMessage).toBe("Thinking...");

    act(() => {
      mockWs.emit("tool_start", {
        id: "tool-1",
        toolName: "search_web",
        input: { query: "test" },
      });
    });

    expect(result.current.thinkingMessage).toBeNull();
    expect(result.current.toolCalls).toHaveLength(1);
    expect(result.current.toolCalls[0]).toEqual({
      id: "tool-1",
      name: "search_web",
      input: { query: "test" },
      isExecuting: true,
    });
  });

  it('"tool_result" marks matching tool as complete', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Add a tool call
    act(() => {
      mockWs.emit("tool_start", {
        id: "tool-1",
        toolName: "search_web",
        input: { query: "test" },
      });
    });
    expect(result.current.toolCalls[0].isExecuting).toBe(true);

    act(() => {
      mockWs.emit("tool_result", {
        id: "tool-1",
        result: "Search results here",
      });
    });

    expect(result.current.toolCalls[0].isExecuting).toBe(false);
    expect(result.current.toolCalls[0].result).toBe("Search results here");
  });

  it('"tool_result" does not affect non-matching tool calls', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("tool_start", {
        id: "tool-1",
        toolName: "search_web",
        input: {},
      });
      mockWs.emit("tool_start", {
        id: "tool-2",
        toolName: "browse_web",
        input: {},
      });
    });

    act(() => {
      mockWs.emit("tool_result", { id: "tool-1", result: "done" });
    });

    expect(result.current.toolCalls[0].isExecuting).toBe(false);
    expect(result.current.toolCalls[1].isExecuting).toBe(true);
  });

  it('"agent_chunk" accumulates text and clears thinking', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("thinking", "Working...");
    });
    expect(result.current.thinkingMessage).toBe("Working...");

    act(() => {
      mockWs.emit("agent_chunk", "Hello ");
    });
    expect(result.current.accumulatedText).toBe("Hello ");
    expect(result.current.thinkingMessage).toBeNull();

    act(() => {
      mockWs.emit("agent_chunk", "world!");
    });
    expect(result.current.accumulatedText).toBe("Hello world!");
  });

  it('"agent_complete" sets streaming false and stores metadata', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Start streaming via sendMessage
    mockWs.isConnected = true;
    act(() => {
      mockWs.emit("open");
    });
    act(() => {
      result.current.sendMessage("test");
    });
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      mockWs.emit("agent_complete", {
        conversationId: "conv-42",
        model: "claude-sonnet",
        provider: "anthropic",
        plan: { goalId: "g-1", goalTitle: "Test", tasks: [] },
      });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.thinkingMessage).toBeNull();
    expect(result.current.conversationId).toBe("conv-42");
    expect(result.current.model).toBe("claude-sonnet");
    expect(result.current.provider).toBe("anthropic");
    expect(result.current.plan).toEqual({
      goalId: "g-1",
      goalTitle: "Test",
      tasks: [],
    });
  });

  it('"suggestions" stores suggestions array', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("suggestions", ["Option A", "Option B"]);
    });

    expect(result.current.suggestions).toEqual(["Option A", "Option B"]);
  });

  it('"rich_card" appends to richCards array', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    act(() => {
      mockWs.emit("rich_card", "goal_progress", { goalId: "g-1", progress: 50 });
    });

    expect(result.current.richCards).toHaveLength(1);
    expect(result.current.richCards[0]).toEqual({
      type: "goal_progress",
      data: { goalId: "g-1", progress: 50 },
    });

    act(() => {
      mockWs.emit("rich_card", "alert_detected", { message: "CPU high" });
    });

    expect(result.current.richCards).toHaveLength(2);
    expect(result.current.richCards[1]).toEqual({
      type: "alert_detected",
      data: { message: "CPU high" },
    });
  });

  it('"error" sets streaming false and stores error message', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Start streaming
    mockWs.isConnected = true;
    act(() => {
      mockWs.emit("open");
    });
    act(() => {
      result.current.sendMessage("test");
    });
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      mockWs.emit("error", "Something went wrong");
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("Something went wrong");
  });

  it('"reset" returns to initial state preserving connection', () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    // Build up state
    act(() => {
      mockWs.emit("open");
    });
    act(() => {
      mockWs.emit("agent_chunk", "some text");
      mockWs.emit("suggestions", ["s1"]);
      mockWs.emit("rich_card", "alert_detected", { msg: "alert" });
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.accumulatedText).toBe("some text");

    act(() => {
      result.current.reset();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.accumulatedText).toBe("");
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.richCards).toEqual([]);
    expect(result.current.thinkingMessage).toBeNull();
    expect(result.current.error).toBeNull();
    // Connection preserved
    expect(result.current.isConnected).toBe(true);
    expect(result.current.transport).toBe("websocket");
  });

  it("set_transport updates transport", () => {
    const { result } = renderHook(() => useWsChat());

    expect(result.current.transport).toBe("none");

    // Transport is set internally; we can verify via ws_connected setting it to "websocket"
    const { result: result2 } = renderHook(() => useWsChat("conv-2"));
    act(() => {
      mockWs.emit("open");
    });
    expect(result2.current.transport).toBe("websocket");
  });

  it("cancel sets error to Cancelled", () => {
    const { result } = renderHook(() => useWsChat("conv-1"));

    mockWs.isConnected = true;
    act(() => {
      mockWs.emit("open");
    });
    act(() => {
      result.current.sendMessage("test");
    });

    act(() => {
      result.current.cancel();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("Cancelled");
  });

  it("closes WebSocket when conversationId becomes undefined", () => {
    const { rerender } = renderHook(
      ({ convId }) => useWsChat(convId),
      { initialProps: { convId: "conv-1" as string | undefined } },
    );

    const firstWs = mockWs;

    rerender({ convId: undefined });

    expect(firstWs.close).toHaveBeenCalled();
  });

  it("reconnects when conversationId changes", () => {
    const { rerender } = renderHook(
      ({ convId }) => useWsChat(convId),
      { initialProps: { convId: "conv-1" } },
    );

    const firstWs = mockWs;

    rerender({ convId: "conv-2" });

    expect(firstWs.close).toHaveBeenCalled();
    // A new mockWs should have been created
    expect(mockWs).not.toBe(firstWs);
  });
});
