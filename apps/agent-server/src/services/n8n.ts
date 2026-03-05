import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("n8n-service");

export interface N8nTriggerResult {
  success: boolean;
  workflowName: string;
  statusCode?: number;
  data?: unknown;
  error?: string;
}

export interface N8nService {
  trigger(webhookUrl: string, workflowName: string, payload: Record<string, unknown>): Promise<N8nTriggerResult>;
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
  };
}
