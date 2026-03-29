import type { WebSocket } from "ws";
import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import { createLogger } from "@ai-cofounder/shared";
import type { WsChannel, WsClientMessage, WsServerMessage } from "@ai-cofounder/shared";
import { goalChannel } from "@ai-cofounder/queue";

const logger = createLogger("websocket-plugin");

/** Valid channel names — kept inline to avoid vitest mock issues with imported constants */
const VALID_CHANNELS = new Set<string>([
  "tasks", "approvals", "monitoring", "queue", "health",
  "tools", "pipelines", "briefing", "goals", "deploys",
  "patterns", "context", "journal", "usage",
  "follow-ups", "conversations", "work-sessions",
]);

/** Per-connection state */
interface WsClient {
  socket: WebSocket;
  channels: Set<WsChannel>;
  goalIds: Set<string>;
  alive: boolean;
  lastActivityAt: number;
}

/** All connected clients */
const clients = new Set<WsClient>();

/**
 * Reference-counted goal listeners. One shared listener per goalId instead of
 * one per client — broadcastGoalEvent already fans out to all subscribed clients.
 */
const goalListeners = new Map<string, { listener: (raw: string) => void; refCount: number }>();

/**
 * Broadcast an invalidation event to all clients subscribed to the given channel.
 */
function broadcastInvalidation(channel: WsChannel): void {
  const msg: WsServerMessage = { type: "invalidate", channel };
  const raw = JSON.stringify(msg);

  for (const client of clients) {
    if (client.channels.has(channel) && client.socket.readyState === 1) {
      client.socket.send(raw);
    }
  }
}

/**
 * Forward a goal event to all clients subscribed to that goalId.
 */
function broadcastGoalEvent(goalId: string, data: Record<string, unknown>): void {
  const msg: WsServerMessage = { type: "goal_event", goalId, data };
  const raw = JSON.stringify(msg);

  for (const client of clients) {
    if (client.goalIds.has(goalId) && client.socket.readyState === 1) {
      client.socket.send(raw);
    }
  }
}

/** Staleness threshold — 1 hour without activity */
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export const websocketPlugin = fp(async (app) => {
  // Register the @fastify/websocket plugin
  await app.register(websocket);

  // Each WebSocket connection adds a close listener to the WS server. Under load
  // (or in tests with many connections) this exceeds the default limit of 10.
  if (app.websocketServer) {
    app.websocketServer.setMaxListeners(0);
  }

  // Heartbeat: ping every 30s, drop dead connections after 10s grace
  const heartbeatInterval = setInterval(() => {
    const toDrop: WsClient[] = [];
    for (const client of clients) {
      if (!client.alive) {
        toDrop.push(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
    for (const client of toDrop) {
      logger.debug("dropping unresponsive WebSocket client");
      client.socket.terminate();
      cleanupClient(client);
    }
  }, 30_000);
  heartbeatInterval.unref();

  /** Add a reference-counted goal listener on agentEvents */
  function addGoalListener(goalId: string): void {
    const existing = goalListeners.get(goalId);
    if (existing) {
      existing.refCount++;
      return;
    }
    const listener = (rawMsg: string): void => {
      try {
        const event = JSON.parse(rawMsg) as Record<string, unknown>;
        broadcastGoalEvent(goalId, event);
      } catch { /* ignore parse errors */ }
    };
    app.agentEvents.on(goalChannel(goalId), listener);
    goalListeners.set(goalId, { listener, refCount: 1 });
  }

  /** Remove a reference-counted goal listener; cleans up when refCount hits 0 */
  function removeGoalListener(goalId: string): void {
    const entry = goalListeners.get(goalId);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      app.agentEvents.off(goalChannel(goalId), entry.listener);
      goalListeners.delete(goalId);
    }
  }

  /** Remove all goal listeners for a client and delete it from the set */
  function cleanupClient(client: WsClient): void {
    for (const goalId of client.goalIds) {
      removeGoalListener(goalId);
      app.unsubscribeGoal(goalId).catch(() => {});
    }
    clients.delete(client);
  }

  // Staleness reaper: terminate clients with no activity for 1 hour.
  // Collect first, then clean up — mutating a Set during iteration can skip elements.
  const stalenessInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const stale: WsClient[] = [];
    for (const client of clients) {
      if (client.lastActivityAt < cutoff) {
        stale.push(client);
      }
    }
    for (const client of stale) {
      logger.warn({ goalIds: [...client.goalIds] }, "cleaning up stale WS client");
      client.socket.terminate();
      cleanupClient(client);
    }
  }, STALE_THRESHOLD_MS);
  stalenessInterval.unref();

  // Bridge: listen to app.agentEvents for goal events → forward to WS clients
  app.agentEvents.on("ws:goal_event", (payload: string) => {
    try {
      const { goalId, data } = JSON.parse(payload) as { goalId: string; data: Record<string, unknown> };
      broadcastGoalEvent(goalId, data);
    } catch (err) {
      logger.warn({ err }, "failed to parse ws:goal_event");
    }
  });

  // Decorate app with broadcast helper for routes/services to call
  app.decorate("wsBroadcast", broadcastInvalidation);

  // WebSocket route — public path, JWT auth via query param
  app.get("/ws", { websocket: true }, (socket, request) => {
    // JWT auth via query param: ?token=xxx
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    // Verify JWT if auth is configured
    if (typeof request.server.jwt?.verify === "function" && token) {
      try {
        request.server.jwt.verify(token);
      } catch {
        const errMsg: WsServerMessage = { type: "error", message: "Unauthorized" };
        socket.send(JSON.stringify(errMsg));
        socket.close(4001, "Unauthorized");
        return;
      }
    } else if (process.env.NODE_ENV === "production" && !token) {
      const errMsg: WsServerMessage = { type: "error", message: "Token required" };
      socket.send(JSON.stringify(errMsg));
      socket.close(4001, "Token required");
      return;
    }

    const client: WsClient = {
      socket,
      channels: new Set(),
      goalIds: new Set(),
      alive: true,
      lastActivityAt: Date.now(),
    };
    clients.add(client);

    logger.info({ clientCount: clients.size }, "WebSocket client connected");

    socket.on("pong", () => {
      client.alive = true;
      client.lastActivityAt = Date.now();
    });

    socket.on("message", (raw) => {
      client.alive = true;
      client.lastActivityAt = Date.now();

      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        const errMsg: WsServerMessage = { type: "error", message: "Invalid JSON" };
        socket.send(JSON.stringify(errMsg));
        return;
      }

      switch (msg.type) {
        case "subscribe":
          for (const ch of msg.channels) {
            if (VALID_CHANNELS.has(ch)) {
              client.channels.add(ch);
            }
          }
          break;

        case "unsubscribe":
          for (const ch of msg.channels) {
            client.channels.delete(ch);
          }
          break;

        case "subscribe_goal": {
          client.goalIds.add(msg.goalId);
          addGoalListener(msg.goalId);
          app.subscribeGoal(msg.goalId).catch(() => {});
          break;
        }

        case "unsubscribe_goal": {
          client.goalIds.delete(msg.goalId);
          removeGoalListener(msg.goalId);
          app.unsubscribeGoal(msg.goalId).catch(() => {});
          break;
        }

        case "ping": {
          const pong: WsServerMessage = { type: "pong" };
          socket.send(JSON.stringify(pong));
          break;
        }

        default: {
          const errMsg: WsServerMessage = { type: "error", message: "Unknown message type" };
          socket.send(JSON.stringify(errMsg));
        }
      }
    });

    socket.on("close", () => {
      cleanupClient(client);
      logger.info({ clientCount: clients.size }, "WebSocket client disconnected");
    });

    socket.on("error", (err) => {
      logger.warn({ err }, "WebSocket client error");
    });
  });

  // Cleanup on server close
  app.addHook("onClose", async () => {
    clearInterval(heartbeatInterval);
    clearInterval(stalenessInterval);
    for (const client of clients) {
      client.socket.close(1001, "Server shutting down");
    }
    clients.clear();
    goalListeners.clear();
    logger.info("WebSocket plugin shut down");
  });

  logger.info("WebSocket plugin initialized");
});

// Export for testing
export { clients as _wsClients, goalListeners as _goalListeners, broadcastInvalidation, broadcastGoalEvent };
