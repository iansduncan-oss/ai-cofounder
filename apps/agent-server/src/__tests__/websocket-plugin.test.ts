import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
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
import { _wsClients } from "../plugins/websocket.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(async () => {
  _wsClients.clear();
  const { buildServer } = await import("../server.js");
  const server = buildServer();
  app = server.app;
  await app.ready();
  await app.listen({ port: 0 });
});

afterEach(async () => {
  _wsClients.clear();
  await app?.close();
});

function getWsUrl(): string {
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  return `ws://localhost:${addr.port}/ws`;
}

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(getWsUrl());
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<WsServerMessage> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()) as WsServerMessage);
    });
  });
}

describe("WebSocket plugin", () => {
  it("accepts a WebSocket connection on /ws", async () => {
    const ws = await connectWs();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("responds to ping with pong", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    const ping: WsClientMessage = { type: "ping" };
    ws.send(JSON.stringify(ping));

    const response = await msgPromise;
    expect(response.type).toBe("pong");
    ws.close();
  });

  it("returns error for invalid JSON", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    ws.send("not valid json");

    const response = await msgPromise;
    expect(response.type).toBe("error");
    if (response.type === "error") {
      expect(response.message).toBe("Invalid JSON");
    }
    ws.close();
  });

  it("subscribes to channels and receives invalidation", async () => {
    const ws = await connectWs();

    // Subscribe to tasks channel
    const sub: WsClientMessage = { type: "subscribe", channels: ["tasks"] };
    ws.send(JSON.stringify(sub));

    // Send a ping and wait for pong — confirms subscribe was processed (same message queue)
    const ping: WsClientMessage = { type: "ping" };
    ws.send(JSON.stringify(ping));
    await waitForMessage(ws); // pong

    // Trigger a broadcast from the server
    const msgPromise = waitForMessage(ws);
    app.wsBroadcast("tasks");

    const response = await msgPromise;
    expect(response.type).toBe("invalidate");
    if (response.type === "invalidate") {
      expect(response.channel).toBe("tasks");
    }
    ws.close();
  });

  it("does not receive events for unsubscribed channels", async () => {
    const ws = await connectWs();

    // Subscribe only to tasks
    const sub: WsClientMessage = { type: "subscribe", channels: ["tasks"] };
    ws.send(JSON.stringify(sub));

    // Confirm subscribe processed
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    await waitForMessage(ws); // pong

    // Broadcast to monitoring (not subscribed)
    app.wsBroadcast("monitoring");

    // Broadcast to tasks (subscribed)
    const msgPromise = waitForMessage(ws);
    app.wsBroadcast("tasks");

    const response = await msgPromise;
    expect(response.type).toBe("invalidate");
    if (response.type === "invalidate") {
      expect(response.channel).toBe("tasks");
    }
    ws.close();
  });

  it("handles unsubscribe", async () => {
    const ws = await connectWs();

    // Subscribe, then confirm via ping/pong
    ws.send(JSON.stringify({ type: "subscribe", channels: ["tasks"] } satisfies WsClientMessage));
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    await waitForMessage(ws); // pong confirms subscribe processed

    // Unsubscribe, then confirm via ping/pong
    ws.send(JSON.stringify({ type: "unsubscribe", channels: ["tasks"] } satisfies WsClientMessage));
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    await waitForMessage(ws); // pong confirms unsubscribe processed

    // Broadcast to tasks — should not receive
    let received = false;
    ws.once("message", () => { received = true; });

    app.wsBroadcast("tasks");
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toBe(false);
    ws.close();
  });

  it("handles subscribe_goal and unsubscribe_goal", async () => {
    const ws = await connectWs();

    const goalId = "test-goal-123";
    ws.send(JSON.stringify({ type: "subscribe_goal", goalId } satisfies WsClientMessage));
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    await waitForMessage(ws); // pong confirms subscribe_goal processed

    ws.send(JSON.stringify({ type: "unsubscribe_goal", goalId } satisfies WsClientMessage));
    ws.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
    await waitForMessage(ws); // pong confirms unsubscribe_goal processed

    // Should not crash
    ws.close();
  });

  it("handles unknown message type gracefully", async () => {
    const ws = await connectWs();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: "unknown_type" }));

    const response = await msgPromise;
    expect(response.type).toBe("error");
    if (response.type === "error") {
      expect(response.message).toBe("Unknown message type");
    }
    ws.close();
  });

  it("wsBroadcast decorator is available on app", () => {
    expect(typeof app.wsBroadcast).toBe("function");
  });
});
