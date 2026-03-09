import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { apiClient } from "@/api/client";

interface SSEOptions {
  onMessage?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  maxRetries?: number;
  timeoutMs?: number;
  userId?: string;
}

export function useSSE(goalId: string | null, options: SSEOptions = {}) {
  const { maxRetries = 3, timeoutMs = 120_000 } = options;
  const [events, setEvents] = useState<unknown[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const goalIdRef = useRef(goalId);

  goalIdRef.current = goalId;

  const disconnect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsConnected(true);
      setError(null);

      const timeout = setTimeout(() => {
        if (abortRef.current === controller) {
          controller.abort();
          setIsConnected(false);
          setError("Connection timed out");
          toast.error("SSE connection timed out");
        }
      }, timeoutMs);

      try {
        const stream = apiClient.streamExecute(id, {
          userId: options.userId,
          signal: controller.signal,
        });

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          // Reset timeout on each event
          clearTimeout(timeout);

          const data = event.data;
          setEvents((prev) => [...prev, data]);
          options.onMessage?.(data);

          const status = (data as Record<string, unknown>).status;
          if (status === "completed" || status === "failed") {
            clearTimeout(timeout);
            setIsConnected(false);
            options.onComplete?.();
            if (status === "completed") {
              toast.success("Execution completed");
            } else {
              toast.error(
                ((data as Record<string, unknown>).error as string) ||
                  "Execution failed",
              );
            }
            return;
          }
        }

        // Stream ended naturally
        clearTimeout(timeout);
        setIsConnected(false);
      } catch (err) {
        clearTimeout(timeout);
        if (controller.signal.aborted) return;

        setIsConnected(false);

        if (retryCountRef.current < maxRetries && goalIdRef.current) {
          retryCountRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, retryCountRef.current - 1),
            8000,
          );
          toast.error(`Connection lost, retrying in ${delay / 1000}s...`);
          setTimeout(() => {
            if (goalIdRef.current) connect(goalIdRef.current);
          }, delay);
        } else {
          const message =
            err instanceof Error ? err.message : "Connection lost";
          setError(message);
          toast.error("SSE connection failed after retries");
          options.onError?.(
            err instanceof Error ? err : new Error(message),
          );
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxRetries, timeoutMs],
  );

  useEffect(() => {
    if (!goalId) return;
    retryCountRef.current = 0;
    connect(goalId);

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const reset = useCallback(() => {
    disconnect();
    setEvents([]);
    setError(null);
  }, [disconnect]);

  return { events, isConnected, error, disconnect, reset };
}
