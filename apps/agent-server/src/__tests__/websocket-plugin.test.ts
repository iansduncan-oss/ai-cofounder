import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";
import type { WsClientMessage, WsServerMessage } from "@ai-cofounder/shared";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
}));

vi.mock("@ai-cofounder/shared", async (importOriginal) => {
  const actual = ((await importOriginal()) as Record<string, unknown>);
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    }),
    optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  };
});

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue("mock");
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    seedStats = vi.fn();
    onCompletion: unknown = undefined;
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: vi.fn(),
    GroqProvider: vi.fn(),
    OpenRouterProvider: vi.fn(),
    GeminiProvider: vi.fn(),
    OllamaProvider: vi.fn(),
    TogetherProvider: vi.fn(),
    CerebrasProvider: vi.fn(),
    HuggingFaceProvider: vi.fn(),
    createEmbeddingService: vi.fn(),
  };
});

// Mock queue to avoid Redis dependency
vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn(),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn(),
  goalChannel: (id: string) => `goal:${id}:events`,
  subagentChannel: (id: string) => `subagent:${id}:events`,
  RedisPubSub: vi.fn(),
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  createSandboxService: vi.fn().mockReturnValue({}),
}));

import WebSocket from "ws";
import { _wsClients, _goalListeners } from "../plugins/websocket.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

/** Track all connections opened during a test for guaranteed cleanup */
const openConnections: WebSocket[] = [];

beforeAll(async () => {
  const { buildServer } = await import("../server.js");
  const server = buildServer();
  app = server.app;
  await app.ready();
  await app.listen({ port: 0 });
});

afterAll(async () => {
  _wsClients.clear();
  await app?.close();
});

afterEach(() => {
  for (const ws of openConnections) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openConnections.length = 0;
  _wsClients.clear();
  _goalListeners.clear();
});

function getWsUrl(): string {
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  return `ws://localhost:${addr.port}/ws`;
}

function connectWs(timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(getWsUrl());
    openConnections.push(ws);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connect timeout"));
    }, timeoutMs);
    ws.on("open", () => { clearTimeout(timer); resolve(ws); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<WsServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("waitForMessage timeout"));
    }, timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as WsServerMessage);
    });
  });
}

/** Send a ping and wait for pong — confirms all prior messages were processed */
async function flushMessages(ws: WebSocket): Promise<void> {
  ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
  await waitForMessage(ws); // pong
}

describe("WebSocket plugin", () => {
  it("accepts a WebSocket connection on /ws", async () => {
    const ws = await connectWs();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("responds to ping with pong", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    const ping: WsClientMessage = { type: "ping" };
    ws.send(JSON.stringify(ping));

    const response = await msgPromise;
    expect(response.type).toBe("pong");
  });

  it("returns error for invalid JSON", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    ws.send("not valid json");

    const response = await msgPromise;
    expect(response).toEqual({ type: "error", message: "Invalid JSON" });
  });

  it("returns error for unknown message type", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: "unknown_type" }));

    const response = await msgPromise;
    expect(response).toEqual({ type: "error", message: "Unknown message type" });
  });

  it("subscribes to channels and receives invalidation", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    await flushMessages(ws);

    const msgPromise = waitForMessage(ws);
    app.wsBroadcast("tasks");

    const response = await msgPromise;
    expect(response).toEqual({ type: "invalidate", channel: "tasks" });
  });

  it("subscribes to multiple channels", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks", "goals", "usage"] } satisfies WsClientMessage));
    await flushMessages(ws);

    // Should receive from all three
    for (const channel of ["tasks", "goals", "usage"] as const) {
      const msgPromise = waitForMessage(ws);
      app.wsBroadcast(channel);
      const response = await msgPromise;
      expect(response).toEqual({ type: "invalidate", channel });
    }
  });

  it("ignores invalid channel names", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["not_a_real_channel", "tasks"] }));
    await flushMessages(ws);

    // Should receive tasks but not the invalid channel
    const msgPromise = waitForMessage(ws);
    app.wsBroadcast("tasks");
    const response = await msgPromise;
    expect(response).toEqual({ type: "invalidate", channel: "tasks" });
  });

  it("does not receive events for unsubscribed channels", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    await flushMessages(ws);

    // Broadcast to monitoring (not subscribed) — should be ignored
    app.wsBroadcast("monitoring");

    // Broadcast to tasks (subscribed) — should arrive
    const msgPromise = waitForMessage(ws);
    app.wsBroadcast("tasks");

    const response = await msgPromise;
    expect(response).toEqual({ type: "invalidate", channel: "tasks" });
  });

  it("handles unsubscribe", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    await flushMessages(ws);

    ws.send(JSON.stringify({ type: "unsubscribe", channels: ["tasks"] } satisfies WsClientMessage));
    await flushMessages(ws);

    // Broadcast to tasks — should not arrive since we unsubscribed.
    // Send a ping after broadcast; if we only get pong back, the invalidation was correctly filtered.
    app.wsBroadcast("tasks");
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    const response = await waitForMessage(ws);
    expect(response.type).toBe("pong");
  });

  it("handles subscribe_goal and unsubscribe_goal", async () => {
    const ws = await connectWs();

    const goalId = "test-goal-123";
    ws.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);

    ws.send(JSON.stringify({ type: "unsubscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);
  });

  it("broadcasts to multiple connected clients", async () => {
    const ws1 = await connectWs();
    const ws2 = await connectWs();

    ws1.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    ws2.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    await Promise.all([flushMessages(ws1), flushMessages(ws2)]);

    const [msg1, msg2] = await Promise.all([
      waitForMessage(ws1),
      (() => { app.wsBroadcast("tasks"); return waitForMessage(ws2); })(),
    ]);

    expect(msg1).toEqual({ type: "invalidate", channel: "tasks" });
    expect(msg2).toEqual({ type: "invalidate", channel: "tasks" });
  });

  it("accepts hyphenated channel names (follow-ups, conversations, work-sessions)", async () => {
    const ws = await connectWs();

    ws.send(JSON.stringify({ type: "subscribe", channels: ["follow-ups", "conversations", "work-sessions"] } satisfies WsClientMessage));
    await flushMessages(ws);

    for (const channel of ["follow-ups", "conversations", "work-sessions"] as const) {
      const msgPromise = waitForMessage(ws);
      app.wsBroadcast(channel);
      const response = await msgPromise;
      expect(response).toEqual({ type: "invalidate", channel });
    }
  });

  it("receives goal events after subscribe_goal", async () => {
    const ws = await connectWs();
    const goalId = "goal-evt-test";

    ws.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);

    // Emit a goal event through the agentEvents bridge
    const msgPromise = waitForMessage(ws);
    const payload = JSON.stringify({ goalId, data: { status: "running", step: 2 } });
    app.agentEvents.emit("ws:goal_event", payload);

    const response = await msgPromise;
    expect(response).toEqual({
      type: "goal_event",
      goalId,
      data: { status: "running", step: 2 },
    });
  });

  it("stops receiving goal events after unsubscribe_goal", async () => {
    const ws = await connectWs();
    const goalId = "goal-unsub-test";

    ws.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);

    ws.send(JSON.stringify({ type: "unsubscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);

    // Emit goal event — should not arrive; ping should be next message
    app.agentEvents.emit("ws:goal_event", JSON.stringify({ goalId, data: { x: 1 } }));
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    const response = await waitForMessage(ws);
    expect(response.type).toBe("pong");
  });

  it("removes client from tracking set on disconnect", async () => {
    const ws = await connectWs();
    await flushMessages(ws);

    const sizeBefore = _wsClients.size;
    expect(sizeBefore).toBeGreaterThan(0);

    // Close and wait for server to process the disconnect
    ws.close();
    await new Promise<void>((resolve) => { ws.on("close", () => resolve()); });
    // Give the server-side close handler a tick to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(_wsClients.size).toBe(sizeBefore - 1);
  });

  it("shares a single goal listener across multiple clients (ref-counted)", async () => {
    const ws1 = await connectWs();
    const ws2 = await connectWs();
    const goalId = "shared-goal";

    ws1.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    ws2.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    await Promise.all([flushMessages(ws1), flushMessages(ws2)]);

    // Only one listener should exist despite two subscribers
    expect(_goalListeners.size).toBe(1);
    expect(_goalListeners.get(goalId)?.refCount).toBe(2);

    // Both clients should receive the event
    const payload = JSON.stringify({ goalId, data: { step: 1 } });
    const [msg1, msg2] = await Promise.all([
      waitForMessage(ws1),
      (() => { app.agentEvents.emit("ws:goal_event", payload); return waitForMessage(ws2); })(),
    ]);
    expect(msg1).toEqual({ type: "goal_event", goalId, data: { step: 1 } });
    expect(msg2).toEqual({ type: "goal_event", goalId, data: { step: 1 } });

    // Unsubscribe one — listener should remain with refCount 1
    ws1.send(JSON.stringify({ type: "unsubscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws1);
    expect(_goalListeners.get(goalId)?.refCount).toBe(1);

    // Unsubscribe second — listener should be fully removed
    ws2.send(JSON.stringify({ type: "unsubscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws2);
    expect(_goalListeners.has(goalId)).toBe(false);
  });

  it("cleans up goal listeners when client disconnects", async () => {
    const ws = await connectWs();
    const goalId = "disconnect-goal";

    ws.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    await flushMessages(ws);
    expect(_goalListeners.get(goalId)?.refCount).toBe(1);

    // Disconnect — server-side cleanup should remove the listener
    ws.close();
    await new Promise<void>((resolve) => { ws.on("close", () => resolve()); });
    await new Promise((r) => setTimeout(r, 50));

    expect(_goalListeners.has(goalId)).toBe(false);
  });

  it("wsBroadcast decorator is available on app", () => {
    expect(typeof app.wsBroadcast).toBe("function");
  });
});
