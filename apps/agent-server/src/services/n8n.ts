import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("n8n-service");

export interface N8nTriggerResult {
  success: boolean;
  workflowName: string;
  statusCode?: number;
  data?: unknown;
  error?: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "waiting" | "canceled";
  finished: boolean;
  mode: "manual" | "trigger" | "webhook" | "retry";
  startedAt: string;
  stoppedAt: string | null;
  retryOf: string | null;
  retrySuccessId: string | null;
}

export interface N8nService {
  trigger(webhookUrl: string, workflowName: string, payload: Record<string, unknown>): Promise<N8nTriggerResult>;
  listExecutions(opts?: { workflowId?: string; status?: string; limit?: number }): Promise<N8nExecution[]>;
}

export function createN8nService(): N8nService {
  const sharedSecret = optionalEnv("N8N_SHARED_SECRET", "");
  const timeoutMs = Number(optionalEnv("N8N_WEBHOOK_TIMEOUT_MS", "30000"));

  return {
    async trigger(webhookUrl, workflowName, payload) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (sharedSecret) {
        headers["x-n8n-secret"] = sharedSecret;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const statusCode = response.status;
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          data = await response.text().catch(() => null);
        }

        if (!response.ok) {
          logger.error({ workflowName, statusCode }, "n8n workflow trigger failed");
          return { success: false, workflowName, statusCode, error: `HTTP ${statusCode}` };
        }

        logger.info({ workflowName, statusCode }, "n8n workflow triggered");
        return { success: true, workflowName, statusCode, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error({ workflowName, err }, "n8n workflow trigger error");
        return { success: false, workflowName, error: message };
      }
    },

    async listExecutions(opts = {}) {
      const baseUrl = optionalEnv("N8N_BASE_URL", "http://localhost:5678");
      const apiKey = optionalEnv("N8N_API_KEY", "");

      if (!apiKey) {
        logger.warn("N8N_API_KEY not configured — skipping listExecutions");
        return [];
      }

      try {
        const params = new URLSearchParams();
        if (opts.workflowId) params.set("workflowId", opts.workflowId);
        if (opts.status) params.set("status", opts.status);
        if (opts.limit != null) params.set("limit", String(opts.limit));

        const url = `${baseUrl}/api/v1/executions${params.toString() ? `?${params.toString()}` : ""}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          headers: { "X-N8N-API-KEY": apiKey },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          logger.error({ status: response.status }, "n8n listExecutions request failed");
          return [];
        }

        const json = (await response.json()) as { data?: N8nExecution[] };
        return json.data ?? [];
      } catch (err) {
        logger.error({ err }, "n8n listExecutions error");
        return [];
      }
    },
  };
}
