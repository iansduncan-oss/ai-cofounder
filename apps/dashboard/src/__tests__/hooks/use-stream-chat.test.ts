import { renderHook, act } from "@testing-library/react";
import { useStreamChat } from "@/hooks/use-stream-chat";
import type { StreamEvent } from "@ai-cofounder/api-client";

// Mock the api client
const mockStreamChat = vi.fn();
vi.mock("@/api/client", () => ({
  apiClient: {
    streamChat: (...args: unknown[]) => mockStreamChat(...args),
  },
}));

function createAsyncGenerator(events: StreamEvent[]) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  };
}

describe("useStreamChat", () => {
  beforeEach(() => {
    mockStreamChat.mockReset();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useStreamChat());
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.accumulatedText).toBe("");
    expect(result.current.toolCalls).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("accumulates text_delta events", async () => {
    mockStreamChat.mockReturnValue(
      createAsyncGenerator([
        { type: "text_delta", data: { text: "Hello " } },
        { type: "text_delta", data: { text: "world" } },
        { type: "done", data: { conversationId: "conv-1", model: "test-model" } },
      ])(),
    );

    const { result } = renderHook(() => useStreamChat());

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    expect(result.current.accumulatedText).toBe("Hello world");
    expect(result.current.conversationId).toBe("conv-1");
    expect(result.current.model).toBe("test-model");
    expect(result.current.isStreaming).toBe(false);
  });

  it("tracks tool calls", async () => {
    mockStreamChat.mockReturnValue(
      createAsyncGenerator([
        { type: "tool_call", data: { id: "tc-1", name: "search_web", input: { query: "test" } } },
        { type: "tool_result", data: { id: "tc-1", result: "found results" } },
        { type: "text_delta", data: { text: "Here are the results" } },
        { type: "done", data: {} },
      ])(),
    );

    const { result } = renderHook(() => useStreamChat());

    await act(async () => {
      await result.current.sendMessage("search for test");
    });

    expect(result.current.toolCalls).toHaveLength(1);
    expect(result.current.toolCalls[0].name).toBe("search_web");
    expect(result.current.toolCalls[0].result).toBe("found results");
    expect(result.current.toolCalls[0].isExecuting).toBe(false);
  });

  it("handles thinking events", async () => {
    let resolve: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });

    mockStreamChat.mockReturnValue(
      (async function* () {
        yield { type: "thinking" as const, data: { message: "Analyzing..." } };
        await pending;
        yield { type: "done" as const, data: {} };
      })(),
    );

    const { result } = renderHook(() => useStreamChat());

    // Start the stream (don't await it — it's pending)
    act(() => {
      result.current.sendMessage("think about this");
    });

    // Wait for the thinking event to be processed
    await vi.waitFor(() => {
      expect(result.current.thinkingMessage).toBe("Analyzing...");
    });

    // Resolve and complete
    await act(async () => {
      resolve!();
      // Small delay for the generator to finish
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("handles errors", async () => {
    mockStreamChat.mockReturnValue(
      createAsyncGenerator([
        { type: "error", data: { message: "Something went wrong" } },
      ])(),
    );

    const { result } = renderHook(() => useStreamChat());

    await act(async () => {
      await result.current.sendMessage("fail");
    });

    expect(result.current.error).toBe("Something went wrong");
    expect(result.current.isStreaming).toBe(false);
  });

  it("handles stream exceptions", async () => {
    mockStreamChat.mockReturnValue(
      (async function* () {
        yield { type: "text_delta" as const, data: { text: "partial" } };
        throw new Error("Connection lost");
      })(),
    );

    const { result } = renderHook(() => useStreamChat());

    await act(async () => {
      await result.current.sendMessage("break");
    });

    expect(result.current.error).toBe("Connection lost");
    expect(result.current.isStreaming).toBe(false);
  });

  it("resets state", async () => {
    mockStreamChat.mockReturnValue(
      createAsyncGenerator([
        { type: "text_delta", data: { text: "hello" } },
        { type: "done", data: { conversationId: "c-1" } },
      ])(),
    );

    const { result } = renderHook(() => useStreamChat());

    await act(async () => {
      await result.current.sendMessage("hi");
    });

    expect(result.current.accumulatedText).toBe("hello");

    act(() => result.current.reset());

    expect(result.current.accumulatedText).toBe("");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
