import { useReducer, useRef, useCallback, useEffect } from "react";
import { apiClient } from "@/api/client";
import type { ChatWebSocket } from "@ai-cofounder/api-client";
import type { ToolCallInfo, PlanInfo, RichCardInfo } from "./use-stream-chat";

interface WsChatState {
  isStreaming: boolean;
  isConnected: boolean;
  accumulatedText: string;
  toolCalls: ToolCallInfo[];
  richCards: RichCardInfo[];
  thinkingMessage: string | null;
  error: string | null;
  conversationId?: string;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
  suggestions?: string[];
  transport: "websocket" | "sse" | "none";
}

type WsChatAction =
  | { type: "ws_connected" }
  | { type: "ws_disconnected" }
  | { type: "start" }
  | { type: "thinking"; message: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string }
  | { type: "agent_chunk"; text: string }
  | {
      type: "agent_complete";
      conversationId?: string;
      model?: string;
      provider?: string;
      plan?: PlanInfo;
    }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "rich_card"; cardType: string; data: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "reset" }
  | { type: "set_transport"; transport: "websocket" | "sse" | "none" };

const initialState: WsChatState = {
  isStreaming: false,
  isConnected: false,
  accumulatedText: "",
  toolCalls: [],
  richCards: [],
  thinkingMessage: null,
  error: null,
  transport: "none",
};

function reducer(state: WsChatState, action: WsChatAction): WsChatState {
  switch (action.type) {
    case "ws_connected":
      return { ...state, isConnected: true, transport: "websocket" };
    case "ws_disconnected":
      return { ...state, isConnected: false };
    case "start":
      return {
        ...initialState,
        isStreaming: true,
        isConnected: state.isConnected,
        transport: state.transport,
      };
    case "thinking":
      return { ...state, thinkingMessage: action.message };
    case "tool_start":
      return {
        ...state,
        thinkingMessage: null,
        toolCalls: [
          ...state.toolCalls,
          { id: action.id, name: action.name, input: action.input, isExecuting: true },
        ],
      };
    case "tool_result":
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === action.id ? { ...tc, result: action.result, isExecuting: false } : tc,
        ),
      };
    case "agent_chunk":
      return {
        ...state,
        thinkingMessage: null,
        accumulatedText: state.accumulatedText + action.text,
      };
    case "agent_complete":
      return {
        ...state,
        isStreaming: false,
        thinkingMessage: null,
        conversationId: action.conversationId,
        model: action.model,
        provider: action.provider,
        plan: action.plan,
      };
    case "suggestions":
      return { ...state, suggestions: action.suggestions };
    case "rich_card":
      return { ...state, richCards: [...state.richCards, { type: action.cardType, data: action.data }] };
    case "error":
      return { ...state, isStreaming: false, error: action.message };
    case "reset":
      return { ...initialState, isConnected: state.isConnected, transport: state.transport };
    case "set_transport":
      return { ...state, transport: action.transport };
  }
}

/**
 * useWsChat — WebSocket-first chat hook with automatic SSE fallback.
 *
 * Attempts WebSocket connection for bidirectional streaming.
 * If WebSocket fails to connect, falls back to SSE streaming.
 */
export function useWsChat(conversationId?: string) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<ChatWebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentConvIdRef = useRef(conversationId);
  currentConvIdRef.current = conversationId;
  // Track isStreaming via ref so sendMessage callback stays stable
  const isStreamingRef = useRef(state.isStreaming);
  isStreamingRef.current = state.isStreaming;

  // Connect WebSocket when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      dispatch({ type: "set_transport", transport: "none" });
      return;
    }

    // Close previous connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = apiClient.connectChatWebSocket(conversationId);
    wsRef.current = ws;

    ws.on("open", () => {
      dispatch({ type: "ws_connected" });
    });

    ws.on("close", () => {
      dispatch({ type: "ws_disconnected" });
    });

    ws.on("thinking", (message) => {
      dispatch({ type: "thinking", message });
    });

    ws.on("tool_start", (data) => {
      dispatch({ type: "tool_start", id: data.id, name: data.toolName, input: data.input ?? {} });
    });

    ws.on("tool_result", (data) => {
      dispatch({ type: "tool_result", id: data.id, result: data.result });
    });

    ws.on("agent_chunk", (content) => {
      dispatch({ type: "agent_chunk", text: content });
    });

    ws.on("agent_complete", (data) => {
      dispatch({
        type: "agent_complete",
        conversationId: data.conversationId,
        model: data.model,
        provider: data.provider,
        plan: data.plan as PlanInfo | undefined,
      });
    });

    ws.on("suggestions", (suggestions) => {
      dispatch({ type: "suggestions", suggestions });
    });

    ws.on("rich_card", (cardType, data) => {
      dispatch({ type: "rich_card", cardType, data });
    });

    ws.on("error", (message) => {
      dispatch({ type: "error", message });
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [conversationId]);

  /** Send a message via WebSocket, falling back to SSE if WS is not connected */
  const sendMessage = useCallback(
    async (message: string, convId?: string, userId?: string) => {
      dispatch({ type: "start" });

      const effectiveConvId = convId ?? currentConvIdRef.current;
      const ws = wsRef.current;

      // Try WebSocket first
      if (ws?.isConnected) {
        ws.sendMessage(message, userId, "dashboard");
        return;
      }

      // Fallback to SSE
      dispatch({ type: "set_transport", transport: "sse" });
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = apiClient.streamChat({
          message,
          conversationId: effectiveConvId,
          userId,
          platform: "dashboard",
        });

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case "thinking":
              dispatch({
                type: "thinking",
                message: (event.data.message as string) ?? "Thinking...",
              });
              break;
            case "tool_call":
              dispatch({
                type: "tool_start",
                id: (event.data.id as string) ?? crypto.randomUUID(),
                name: (event.data.name as string) ?? "unknown",
                input: (event.data.input as Record<string, unknown>) ?? {},
              });
              break;
            case "tool_result":
              dispatch({
                type: "tool_result",
                id: (event.data.id as string) ?? "",
                result: (event.data.result as string) ?? "",
              });
              break;
            case "text_delta":
              dispatch({ type: "agent_chunk", text: (event.data.text as string) ?? "" });
              break;
            case "rich_card":
              dispatch({
                type: "rich_card",
                cardType: (event.data.type as string) ?? "goal_progress",
                data: (event.data.data as Record<string, unknown>) ?? {},
              });
              break;
            case "suggestions":
              dispatch({
                type: "suggestions",
                suggestions: (event.data.suggestions as string[]) ?? [],
              });
              break;
            case "done":
              dispatch({
                type: "agent_complete",
                conversationId: event.data.conversationId as string | undefined,
                model: event.data.model as string | undefined,
                provider: event.data.provider as string | undefined,
                plan: event.data.plan as PlanInfo | undefined,
              });
              break;
            case "error":
              dispatch({ type: "error", message: (event.data.message as string) ?? "Unknown error" });
              break;
          }
        }

        // If stream ended without a done event
        if (!controller.signal.aborted && isStreamingRef.current) {
          dispatch({ type: "agent_complete" });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          dispatch({
            type: "error",
            message: err instanceof Error ? err.message : "Stream failed",
          });
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "error", message: "Cancelled" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  return { ...state, sendMessage, cancel, reset };
}
