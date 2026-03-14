import { createContext, useContext, type ReactNode } from "react";
import {
  useRealtimeSync,
  type WsConnectionStatus,
} from "@/hooks/use-realtime-sync";

interface RealtimeContextValue {
  /** Current WebSocket connection status */
  status: WsConnectionStatus;
  /** Subscribe to goal execution events via WS */
  subscribeGoal: (goalId: string) => void;
  /** Unsubscribe from goal execution events */
  unsubscribeGoal: (goalId: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, subscribeGoal, unsubscribeGoal } = useRealtimeSync();

  return (
    <RealtimeContext.Provider value={{ status, subscribeGoal, unsubscribeGoal }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * useRealtime — access WS connection status and goal subscription helpers.
 * Must be used within a <RealtimeProvider>.
 */
export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error("useRealtime must be used within <RealtimeProvider>");
  }
  return ctx;
}
