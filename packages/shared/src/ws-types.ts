/** WebSocket channel names — each maps to a TanStack Query key group */
export type WsChannel =
  | "tasks"
  | "approvals"
  | "monitoring"
  | "queue"
  | "health"
  | "tools"
  | "pipelines"
  | "briefing"
  | "goals"
  | "deploys"
  | "patterns"
  | "context";

/** Client → Server messages */
export type WsClientMessage =
  | { type: "subscribe"; channels: WsChannel[] }
  | { type: "unsubscribe"; channels: WsChannel[] }
  | { type: "subscribe_goal"; goalId: string }
  | { type: "unsubscribe_goal"; goalId: string }
  | { type: "ping" };

/** Server → Client messages */
export type WsServerMessage =
  | { type: "invalidate"; channel: WsChannel }
  | { type: "goal_event"; goalId: string; data: Record<string, unknown> }
  | { type: "pong" }
  | { type: "error"; message: string };

/**
 * Maps WS channels to the TanStack Query key prefixes they should invalidate.
 * The dashboard uses these to call `queryClient.invalidateQueries({ queryKey })`.
 */
export const WS_CHANNEL_QUERY_KEYS: Record<WsChannel, readonly string[][]> = {
  tasks: [["tasks", "pending"], ["tasks"]],
  approvals: [["approvals", "pending"], ["approvals"]],
  monitoring: [["monitoring", "status"]],
  queue: [["queue", "status"]],
  health: [["health"], ["health", "providers"]],
  tools: [["tools", "stats"]],
  pipelines: [["pipelines", "list"], ["pipelines"]],
  briefing: [["briefing", "latest"]],
  goals: [["goals"]],
  deploys: [["deploys", "latest"], ["deploys"]],
  patterns: [["patterns"]],
  context: [["context", "current"], ["context", "engagement"]],
};

/** All valid channel names for runtime validation */
export const WS_CHANNELS: WsChannel[] = [
  "tasks", "approvals", "monitoring", "queue",
  "health", "tools", "pipelines", "briefing", "goals", "deploys", "patterns", "context",
];
