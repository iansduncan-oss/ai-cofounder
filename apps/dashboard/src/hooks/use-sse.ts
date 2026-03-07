import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";

interface SSEOptions {
  onMessage?: (data: unknown) => void;
  onError?: (error: Event) => void;
  onComplete?: () => void;
  maxRetries?: number;
  timeoutMs?: number;
}

export function useSSE(url: string | null, options: SSEOptions = {}) {
  const { maxRetries = 3, timeoutMs = 120_000 } = options;
  const [events, setEvents] = useState<unknown[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);

  urlRef.current = url;

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout_();
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
      setIsConnected(false);
    }
  }, [clearTimeout_]);

  const connect = useCallback(
    (targetUrl: string) => {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const fullUrl = targetUrl.startsWith("http")
        ? targetUrl
        : `${baseUrl}${targetUrl}`;

      const source = new EventSource(fullUrl);
      sourceRef.current = source;

      // Connection timeout
      clearTimeout_();
      timeoutRef.current = setTimeout(() => {
        if (sourceRef.current === source) {
          source.close();
          setIsConnected(false);
          setError("Connection timed out");
          toast.error("SSE connection timed out");
        }
      }, timeoutMs);

      source.onopen = () => {
        setIsConnected(true);
        setError(null);
        retryCountRef.current = 0;
      };

      source.onmessage = (event) => {
        // Reset timeout on each message
        clearTimeout_();
        timeoutRef.current = setTimeout(() => {
          if (sourceRef.current === source) {
            source.close();
            setIsConnected(false);
            setError("Connection timed out");
          }
        }, timeoutMs);

        try {
          const data = JSON.parse(event.data);
          setEvents((prev) => [...prev, data]);
          options.onMessage?.(data);

          if (data.status === "completed" || data.status === "failed") {
            clearTimeout_();
            source.close();
            setIsConnected(false);
            options.onComplete?.();
            if (data.status === "completed") {
              toast.success("Execution completed");
            } else if (data.status === "failed") {
              toast.error(data.error || "Execution failed");
            }
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      source.onerror = (err) => {
        source.close();
        setIsConnected(false);
        clearTimeout_();

        if (retryCountRef.current < maxRetries && urlRef.current) {
          retryCountRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, retryCountRef.current - 1),
            8000,
          );
          toast.error(`Connection lost, retrying in ${delay / 1000}s...`);
          setTimeout(() => {
            if (urlRef.current) connect(urlRef.current);
          }, delay);
        } else {
          setError("Connection lost");
          toast.error("SSE connection failed after retries");
          options.onError?.(err);
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxRetries, timeoutMs, clearTimeout_],
  );

  useEffect(() => {
    if (!url) return;
    retryCountRef.current = 0;
    connect(url);

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const reset = useCallback(() => {
    disconnect();
    setEvents([]);
    setError(null);
  }, [disconnect]);

  return { events, isConnected, error, disconnect, reset };
}
