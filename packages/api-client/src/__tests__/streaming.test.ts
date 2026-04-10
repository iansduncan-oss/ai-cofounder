import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, ApiError } from "../client.js";

describe("streamChat", () => {
  const originalFetch = globalThis.fetch;
  let client: ApiClient;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    client = new ApiClient({ baseUrl: "http://localhost:3100" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createSSEStream(events: Array<{ event: string; data: Record<string, unknown> }>) {
    const text = events
      .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
      .join("");
    const encoder = new TextEncoder();
    const chunks = [encoder.encode(text)];
    let index = 0;

    return {
      getReader() {
        return {
          read() {
            if (index < chunks.length) {
              return Promise.resolve({ done: false, value: chunks[index++] });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          releaseLock: vi.fn(),
        };
      },
    };
  }

  it("parses SSE events correctly", async () => {
    const sseEvents = [
      { event: "thinking", data: { round: 1, message: "Loading..." } },
      { event: "text_delta", data: { text: "Hello world" } },
      { event: "done", data: { response: "Hello world", model: "claude" } },
    ];

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createSSEStream(sseEvents),
    });

    const events = [];
    for await (const event of client.streamChat({ message: "hi" })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("thinking");
    expect(events[1].type).toBe("text_delta");
    expect(events[1].data.text).toBe("Hello world");
    expect(events[2].type).toBe("done");
  });

  it("throws ApiError on non-200 response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ error: "Server error" }),
    });

    const gen = client.streamChat({ message: "hi" });
    await expect(gen.next()).rejects.toThrow(ApiError);
  });

  it("yields events in order", async () => {
    const sseEvents = [
      { event: "thinking", data: { round: 1 } },
      { event: "tool_call", data: { tool: "search_web" } },
      { event: "tool_result", data: { tool: "search_web", summary: "found" } },
      { event: "text_delta", data: { text: "Result" } },
      { event: "done", data: { response: "Result" } },
    ];

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createSSEStream(sseEvents),
    });

    const types = [];
    for await (const event of client.streamChat({ message: "search" })) {
      types.push(event.type);
    }

    expect(types).toEqual(["thinking", "tool_call", "tool_result", "text_delta", "done"]);
  });

  it("sends correct request to stream endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createSSEStream([{ event: "done", data: { response: "ok" } }]),
    });

    for await (const _ of client.streamChat({ message: "hello", userId: "u1" })) {
      // consume
    }

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("http://localhost:3100/api/agents/run/stream");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(calls[0][1].body)).toEqual({ message: "hello", userId: "u1" });
  });
});
