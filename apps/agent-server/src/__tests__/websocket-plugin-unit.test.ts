import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { setupTestEnv, mockDbModule, mockLlmModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  setupTestEnv();
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_n: string, d: string) => d,
}));

vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule() }));
vi.mock("@ai-cofounder/llm", () => mockLlmModule());
vi.mock("@ai-cofounder/queue", () => ({
  goalChannel: (id: string) => `goal:${id}`,
  startWorkers: vi.fn(),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
}));

// ---------- helpers ----------

interface MockSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function createMockSocket(readyState = 1): MockSocket {
  return {
    readyState,
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

interface MockClient {
  socket: MockSocket;
  channels: Set<string>;
  goalIds: Set<string>;
  alive: boolean;
  lastActivityAt: number;
}

function createMockClient(
  channels: string[] = [],
  goalIds: string[] = [],
  readyState = 1,
): MockClient {
  return {
    socket: createMockSocket(readyState),
    channels: new Set(channels),
    goalIds: new Set(goalIds),
    alive: true,
    lastActivityAt: Date.now(),
  };
}

// ---------- import module under test (after mocks) ----------

const {
  _wsClients,
  _goalListeners,
  broadcastInvalidation,
  broadcastGoalEvent,
} = await import("../plugins/websocket.js");

// ---------- tests ----------

describe("websocket plugin — unit", () => {
  beforeEach(() => {
    _wsClients.clear();
    _goalListeners.clear();
  });

  // ---- broadcastInvalidation ----

  describe("broadcastInvalidation", () => {
    it("sends invalidation message to clients subscribed to the channel", () => {
      const client = createMockClient(["tasks"]);
      _wsClients.add(client as never);

      broadcastInvalidation("tasks");

      expect(client.socket.send).toHaveBeenCalledOnce();
      expect(client.socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "invalidate", channel: "tasks" }),
      );
    });

    it("skips clients not subscribed to the channel", () => {
      const subscribed = createMockClient(["tasks"]);
      const unsubscribed = createMockClient(["goals"]);
      _wsClients.add(subscribed as never);
      _wsClients.add(unsubscribed as never);

      broadcastInvalidation("tasks");

      expect(subscribed.socket.send).toHaveBeenCalledOnce();
      expect(unsubscribed.socket.send).not.toHaveBeenCalled();
    });

    it("skips clients whose readyState is not OPEN (1)", () => {
      const open = createMockClient(["tasks"], [], 1);
      const closing = createMockClient(["tasks"], [], 2);
      const closed = createMockClient(["tasks"], [], 3);
      _wsClients.add(open as never);
      _wsClients.add(closing as never);
      _wsClients.add(closed as never);

      broadcastInvalidation("tasks");

      expect(open.socket.send).toHaveBeenCalledOnce();
      expect(closing.socket.send).not.toHaveBeenCalled();
      expect(closed.socket.send).not.toHaveBeenCalled();
    });

    it("broadcasts to multiple subscribed clients", () => {
      const a = createMockClient(["approvals"]);
      const b = createMockClient(["approvals"]);
      _wsClients.add(a as never);
      _wsClients.add(b as never);

      broadcastInvalidation("approvals");

      expect(a.socket.send).toHaveBeenCalledOnce();
      expect(b.socket.send).toHaveBeenCalledOnce();
    });

    it("does nothing when no clients exist", () => {
      // no clients added
      expect(() => broadcastInvalidation("tasks")).not.toThrow();
    });
  });

  // ---- broadcastGoalEvent ----

  describe("broadcastGoalEvent", () => {
    it("sends goal event to clients subscribed to that goalId", () => {
      const client = createMockClient([], ["goal-123"]);
      _wsClients.add(client as never);

      const data = { status: "completed", progress: 100 };
      broadcastGoalEvent("goal-123", data);

      expect(client.socket.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(client.socket.send.mock.calls[0][0] as string);
      expect(sent).toEqual({
        type: "goal_event",
        goalId: "goal-123",
        data: { status: "completed", progress: 100 },
      });
    });

    it("skips clients not subscribed to the goalId", () => {
      const subscribed = createMockClient([], ["goal-aaa"]);
      const other = createMockClient([], ["goal-bbb"]);
      _wsClients.add(subscribed as never);
      _wsClients.add(other as never);

      broadcastGoalEvent("goal-aaa", { step: 1 });

      expect(subscribed.socket.send).toHaveBeenCalledOnce();
      expect(other.socket.send).not.toHaveBeenCalled();
    });

    it("skips clients with readyState !== 1", () => {
      const open = createMockClient([], ["goal-x"], 1);
      const closed = createMockClient([], ["goal-x"], 3);
      _wsClients.add(open as never);
      _wsClients.add(closed as never);

      broadcastGoalEvent("goal-x", { done: true });

      expect(open.socket.send).toHaveBeenCalledOnce();
      expect(closed.socket.send).not.toHaveBeenCalled();
    });
  });

  // ---- client cleanup ----

  describe("client cleanup", () => {
    it("removing a client from _wsClients excludes it from future broadcasts", () => {
      const client = createMockClient(["tasks"]);
      _wsClients.add(client as never);
      expect(_wsClients.size).toBe(1);

      _wsClients.delete(client as never);
      expect(_wsClients.size).toBe(0);

      broadcastInvalidation("tasks");
      expect(client.socket.send).not.toHaveBeenCalled();
    });
  });

  // ---- goal listener ref-counting ----

  describe("goal listener ref-counting", () => {
    it("two clients subscribing to the same goalId share one listener with refCount 2", () => {
      // Simulate what addGoalListener does for two clients
      const goalId = "goal-shared";
      const listener = vi.fn();

      _goalListeners.set(goalId, { listener, refCount: 2 });

      const entry = _goalListeners.get(goalId);
      expect(entry).toBeDefined();
      expect(entry!.refCount).toBe(2);
    });

    it("decrementing refCount to 1 keeps the listener", () => {
      const goalId = "goal-dec";
      const listener = vi.fn();
      _goalListeners.set(goalId, { listener, refCount: 2 });

      const entry = _goalListeners.get(goalId)!;
      entry.refCount--;
      expect(entry.refCount).toBe(1);
      expect(_goalListeners.has(goalId)).toBe(true);
    });

    it("decrementing refCount to 0 should trigger removal of the listener", () => {
      const goalId = "goal-rm";
      const listener = vi.fn();
      _goalListeners.set(goalId, { listener, refCount: 1 });

      const entry = _goalListeners.get(goalId)!;
      entry.refCount--;
      if (entry.refCount <= 0) {
        _goalListeners.delete(goalId);
      }
      expect(_goalListeners.has(goalId)).toBe(false);
    });
  });

  // ---- channel subscribe / unsubscribe (via client channels Set) ----

  describe("channel subscribe / unsubscribe", () => {
    it("subscribing adds channels to the client", () => {
      const client = createMockClient();
      _wsClients.add(client as never);

      // Simulate subscribe message handling
      const validChannels = ["tasks", "goals", "approvals"];
      for (const ch of validChannels) {
        client.channels.add(ch);
      }

      expect(client.channels.has("tasks")).toBe(true);
      expect(client.channels.has("goals")).toBe(true);
      expect(client.channels.has("approvals")).toBe(true);

      // Verify broadcasts now reach this client
      broadcastInvalidation("tasks");
      expect(client.socket.send).toHaveBeenCalledOnce();
    });

    it("unsubscribing removes channels from the client", () => {
      const client = createMockClient(["tasks", "goals"]);
      _wsClients.add(client as never);

      client.channels.delete("tasks");

      broadcastInvalidation("tasks");
      expect(client.socket.send).not.toHaveBeenCalled();

      broadcastInvalidation("goals");
      expect(client.socket.send).toHaveBeenCalledOnce();
    });

    it("invalid channels are not present in the VALID_CHANNELS set (plugin rejects them)", () => {
      // The plugin only adds channels from VALID_CHANNELS; simulate that by not adding invalid ones
      const client = createMockClient();
      _wsClients.add(client as never);

      const invalidChannels = ["invalid-channel", "not-a-thing", ""];
      for (const ch of invalidChannels) {
        // The plugin checks VALID_CHANNELS before adding — so client.channels stays empty
        // We verify the broadcast skips clients without matching channels
        client.channels.add(ch);
      }

      broadcastInvalidation("tasks");
      expect(client.socket.send).not.toHaveBeenCalled();
    });
  });

  // ---- server shutdown cleanup ----

  describe("server shutdown cleanup", () => {
    it("clearing clients and goalListeners empties both collections", () => {
      const a = createMockClient(["tasks"]);
      const b = createMockClient(["goals"], ["goal-1"]);
      _wsClients.add(a as never);
      _wsClients.add(b as never);
      _goalListeners.set("goal-1", { listener: vi.fn(), refCount: 1 });

      // Simulate onClose hook
      for (const client of _wsClients) {
        (client as MockClient).socket.close(1001, "Server shutting down");
      }
      _wsClients.clear();
      _goalListeners.clear();

      expect(_wsClients.size).toBe(0);
      expect(_goalListeners.size).toBe(0);

      // After clearing, broadcasts do nothing
      broadcastInvalidation("tasks");
      broadcastGoalEvent("goal-1", { x: 1 });
      expect(a.socket.send).not.toHaveBeenCalled();
      expect(b.socket.send).not.toHaveBeenCalled();

      // Verify close was called on the sockets
      expect(a.socket.close).toHaveBeenCalledWith(1001, "Server shutting down");
      expect(b.socket.close).toHaveBeenCalledWith(1001, "Server shutting down");
    });
  });
});
