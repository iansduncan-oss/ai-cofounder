import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "./use-auth";
import {
  WS_CHANNEL_QUERY_KEYS,
  WS_CHANNELS,
  type WsChannel,
  type WsClientMessage,
  type WsServerMessage,
} from "@ai-cofounder/shared";

export type WsConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseRealtimeSyncOptions {
  /** Channels to auto-subscribe on connect. Defaults to all. */
  channels?: WsChannel[];
  /** Enable/disable the connection. Defaults to true. */
  enabled?: boolean;
}

/**
 * useRealtimeSync — manages a single WebSocket connection to the agent-server.
 * On receiving `invalidate` messages, invalidates the matching TanStack Query keys
 * so queries refetch fresh data from the API.
 */
export function useRealtimeSync(options: UseRealtimeSyncOptions = {}) {
  const { channels = WS_CHANNELS, enabled = true } = options;
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const [status, setStatus] = useState<WsConnectionStatus>("disconnected");

  const getWsUrl = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const url = new URL(apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    const token = getAccessToken();
    if (token) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus("connecting");
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttemptsRef.current = 0;

      // Subscribe to configured channels
      const msg: WsClientMessage = { type: "subscribe", channels: channelsRef.current };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data as string) as WsServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "invalidate": {
          const keys = WS_CHANNEL_QUERY_KEYS[msg.channel];
          if (keys) {
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: key });
            }
          }
          break;
        }
        case "goal_event":
          // Goal events are handled by consumers who subscribe via subscribeGoal()
          // Emit a custom event so components can listen
          window.dispatchEvent(
            new CustomEvent("ws:goal_event", { detail: msg }),
          );
          break;
        case "pong":
          // Keepalive response — no action needed
          break;
        case "error":
          console.warn("[WS] Server error:", msg.message);
          break;
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;

      // Exponential backoff reconnect: 1s, 2s, 4s, 8s, 16s, max 30s
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (enabled) connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };
  }, [enabled, getWsUrl, queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const subscribeGoal = useCallback(
    (goalId: string) => {
      send({ type: "subscribe_goal", goalId });
    },
    [send],
  );

  const unsubscribeGoal = useCallback(
    (goalId: string) => {
      send({ type: "unsubscribe_goal", goalId });
    },
    [send],
  );

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    connect();
    return () => disconnect();
  }, [enabled, connect, disconnect]);

  // Respond to server pings with client pong
  useEffect(() => {
    const interval = setInterval(() => {
      send({ type: "ping" });
    }, 25_000);
    return () => clearInterval(interval);
  }, [send]);

  return {
    status,
    subscribeGoal,
    unsubscribeGoal,
    send,
    disconnect,
  };
}
