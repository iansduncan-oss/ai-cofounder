import type { WebSocket } from "ws";
import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import { createLogger } from "@ai-cofounder/shared";
import { WS_CHANNELS, type WsChannel, type WsClientMessage, type WsServerMessage } from "@ai-cofounder/shared";
import { goalChannel } from "@ai-cofounder/queue";

const logger = createLogger("websocket-plugin");

/** Per-connection state */
interface WsClient {
  socket: WebSocket;
  channels: Set<WsChannel>;
  goalIds: Set<string>;
  alive: boolean;
}

/** All connected clients */
const clients = new Set<WsClient>();

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

export const websocketPlugin = fp(async (app) => {
  // Register the @fastify/websocket plugin
  await app.register(websocket);

  // Heartbeat: ping every 30s, drop dead connections after 10s grace
  const heartbeatInterval = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        logger.debug("dropping unresponsive WebSocket client");
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      const msg: WsServerMessage = { type: "pong" };
      // We use the ping frame, but also send a JSON pong for protocol-level keepalive
      client.socket.ping();
      if (client.socket.readyState === 1) {
        client.socket.send(JSON.stringify(msg));
      }
    }
  }, 30_000);
  heartbeatInterval.unref();

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
    };
    clients.add(client);

    logger.info({ clientCount: clients.size }, "WebSocket client connected");

    socket.on("pong", () => {
      client.alive = true;
    });

    socket.on("message", (raw) => {
      client.alive = true;

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
            if (WS_CHANNELS.includes(ch)) {
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
          // Also subscribe to Redis pubsub for this goal so events flow through
          const channel = goalChannel(msg.goalId);
          const onGoalMessage = (rawMsg: string): void => {
            try {
              const event = JSON.parse(rawMsg) as Record<string, unknown>;
              broadcastGoalEvent(msg.goalId, event);
            } catch { /* ignore parse errors */ }
          };
          app.agentEvents.on(channel, onGoalMessage);
          app.subscribeGoal(msg.goalId).catch(() => {});

          // Track listener for cleanup
          (client as unknown as Record<string, unknown>)[`_goalListener_${msg.goalId}`] = onGoalMessage;
          break;
        }

        case "unsubscribe_goal": {
          client.goalIds.delete(msg.goalId);
          const ch = goalChannel(msg.goalId);
          const listener = (client as unknown as Record<string, unknown>)[`_goalListener_${msg.goalId}`] as ((...args: unknown[]) => void) | undefined;
          if (listener) {
            app.agentEvents.off(ch, listener);
            delete (client as unknown as Record<string, unknown>)[`_goalListener_${msg.goalId}`];
          }
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
      // Clean up goal subscriptions
      for (const goalId of client.goalIds) {
        const ch = goalChannel(goalId);
        const listener = (client as unknown as Record<string, unknown>)[`_goalListener_${goalId}`] as ((...args: unknown[]) => void) | undefined;
        if (listener) {
          app.agentEvents.off(ch, listener);
        }
        app.unsubscribeGoal(goalId).catch(() => {});
      }
      clients.delete(client);
      logger.info({ clientCount: clients.size }, "WebSocket client disconnected");
    });

    socket.on("error", (err) => {
      logger.warn({ err }, "WebSocket client error");
    });
  });

  // Cleanup on server close
  app.addHook("onClose", async () => {
    clearInterval(heartbeatInterval);
    for (const client of clients) {
      client.socket.close(1001, "Server shutting down");
    }
    clients.clear();
    logger.info("WebSocket plugin shut down");
  });

  logger.info("WebSocket plugin initialized");
});

// Export for testing
export { clients as _wsClients, broadcastInvalidation, broadcastGoalEvent };
