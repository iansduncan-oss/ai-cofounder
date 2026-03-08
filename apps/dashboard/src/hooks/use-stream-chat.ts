import { useReducer, useRef, useCallback } from "react";
import { apiClient } from "@/api/client";

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isExecuting: boolean;
}

export interface PlanInfo {
  goalId: string;
  goalTitle: string;
  tasks: Array<{
    id: string;
    title: string;
    assignedAgent: string;
    orderIndex: number;
  }>;
}

interface StreamState {
  isStreaming: boolean;
  accumulatedText: string;
  toolCalls: ToolCallInfo[];
  thinkingMessage: string | null;
  error: string | null;
  conversationId?: string;
  model?: string;
  provider?: string;
  plan?: PlanInfo;
}

type StreamAction =
  | { type: "start" }
  | { type: "thinking"; message: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string }
  | { type: "text_delta"; text: string }
  | {
      type: "done";
      conversationId?: string;
      model?: string;
      provider?: string;
      plan?: PlanInfo;
    }
  | { type: "error"; message: string }
  | { type: "reset" };

const initialState: StreamState = {
  isStreaming: false,
  accumulatedText: "",
  toolCalls: [],
  thinkingMessage: null,
  error: null,
};

function reducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "start":
      return { ...initialState, isStreaming: true };
    case "thinking":
      return { ...state, thinkingMessage: action.message };
    case "tool_call":
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
    case "text_delta":
      return {
        ...state,
        thinkingMessage: null,
        accumulatedText: state.accumulatedText + action.text,
      };
    case "done":
      return {
        ...state,
        isStreaming: false,
        thinkingMessage: null,
        conversationId: action.conversationId,
        model: action.model,
        provider: action.provider,
        plan: action.plan,
      };
    case "error":
      return { ...state, isStreaming: false, error: action.message };
    case "reset":
      return initialState;
  }
}

export function useStreamChat() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (message: string, conversationId?: string, userId?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      dispatch({ type: "start" });

      try {
        const stream = apiClient.streamChat({
          message,
          conversationId,
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
                type: "tool_call",
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
              dispatch({ type: "text_delta", text: (event.data.text as string) ?? "" });
              break;
            case "done":
              dispatch({
                type: "done",
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
        if (!controller.signal.aborted && state.isStreaming) {
          dispatch({ type: "done" });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
