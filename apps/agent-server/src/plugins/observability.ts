import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import client from "prom-client";

// --- Metrics ---

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
});

const httpErrorsTotal = new client.Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx errors",
  labelNames: ["method", "route"] as const,
});

const httpRequestsByStatus = new client.Counter({
  name: "http_requests_by_status",
  help: "HTTP requests by status code class",
  labelNames: ["status"] as const,
});

const httpRequestDurationAvgMs = new client.Gauge({
  name: "http_request_duration_avg_ms",
  help: "Average request duration in milliseconds (rolling)",
  labelNames: ["route"] as const,
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const processMemoryRssBytes = new client.Gauge({
  name: "process_memory_rss_bytes",
  help: "Process RSS memory in bytes",
});

const processUptimeSeconds = new client.Gauge({
  name: "process_uptime_seconds",
  help: "Process uptime in seconds",
});

// --- LLM Metrics ---

const llmRequestDuration = new client.Histogram({
  name: "llm_request_duration_seconds",
  help: "LLM request duration in seconds",
  labelNames: ["provider", "model", "task_category"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
});

const llmTokensTotal = new client.Counter({
  name: "llm_tokens_total",
  help: "Total LLM tokens used",
  labelNames: ["provider", "model", "direction"] as const,
});

const llmRequestsTotal = new client.Counter({
  name: "llm_requests_total",
  help: "Total LLM requests",
  labelNames: ["provider", "model", "task_category", "status"] as const,
});

const llmCostMicros = new client.Counter({
  name: "llm_cost_microdollars_total",
  help: "Estimated LLM cost in microdollars",
  labelNames: ["provider", "model"] as const,
});

// --- Tool Execution Metrics ---

const toolExecutionDuration = new client.Histogram({
  name: "tool_execution_duration_seconds",
  help: "Tool execution duration in seconds",
  labelNames: ["tool_name", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

// --- Queue Metrics ---

const queueDepth = new client.Gauge({
  name: "queue_depth",
  help: "Number of waiting jobs per queue",
  labelNames: ["queue"] as const,
});

const queueActiveJobs = new client.Gauge({
  name: "queue_active_jobs",
  help: "Number of active jobs per queue",
  labelNames: ["queue"] as const,
});

const dlqSizeTotal = new client.Gauge({
  name: "dlq_size_total",
  help: "Total jobs in dead letter queue",
});

const queueJobsCompletedTotal = new client.Counter({
  name: "queue_jobs_completed_total",
  help: "Total completed jobs per queue",
  labelNames: ["queue"] as const,
});

const queueJobsFailedTotal = new client.Counter({
  name: "queue_jobs_failed_total",
  help: "Total failed jobs per queue",
  labelNames: ["queue"] as const,
});

const queueStaleJobs = new client.Gauge({
  name: "queue_stale_jobs",
  help: "Number of active jobs running longer than 30 minutes per queue",
  labelNames: ["queue"] as const,
});

const redisUp = new client.Gauge({
  name: "redis_up",
  help: "Whether Redis is reachable (1 = up, 0 = down)",
});

const queueOldestWaitingJobAgeSeconds = new client.Gauge({
  name: "queue_oldest_waiting_job_age_seconds",
  help: "Age of the oldest waiting job in seconds per queue",
  labelNames: ["queue"] as const,
});

// --- Subagent Metrics ---

const subagentRunsTotal = new client.Counter({
  name: "subagent_runs_total",
  help: "Total subagent runs",
  labelNames: ["status"] as const,
});

const subagentDurationSeconds = new client.Histogram({
  name: "subagent_duration_seconds",
  help: "Subagent run duration in seconds",
  buckets: [5, 10, 30, 60, 120, 300, 600],
});

const subagentToolRounds = new client.Histogram({
  name: "subagent_tool_rounds",
  help: "Number of tool rounds per subagent run",
  buckets: [1, 3, 5, 10, 15, 20, 25],
});

// --- Sandbox Metrics ---

const sandboxExecutionsTotal = new client.Counter({
  name: "sandbox_executions_total",
  help: "Total sandbox code executions",
  labelNames: ["language", "status"] as const,
});

const sandboxOomKillsTotal = new client.Counter({
  name: "sandbox_oom_kills_total",
  help: "Total sandbox OOM kills",
  labelNames: ["language"] as const,
});

const sandboxOrphanCleanupsTotal = new client.Counter({
  name: "sandbox_orphan_cleanups_total",
  help: "Total orphaned sandbox containers cleaned up",
});

// --- Backup Metrics ---

export const backupLastSuccessTimestamp = new client.Gauge({
  name: "backup_last_success_timestamp",
  help: "Unix timestamp of last successful backup",
});

export function recordBackupSuccess() {
  backupLastSuccessTimestamp.set(Date.now() / 1000);
}

export function recordSandboxMetrics(data: {
  language: string;
  success: boolean;
  oomKilled: boolean;
  timedOut: boolean;
}) {
  const status = data.oomKilled ? "oom" : data.timedOut ? "timeout" : data.success ? "success" : "error";
  sandboxExecutionsTotal.inc({ language: data.language, status });
  if (data.oomKilled) {
    sandboxOomKillsTotal.inc({ language: data.language });
  }
}

export function recordSandboxOrphanCleanup(count: number) {
  if (count > 0) {
    sandboxOrphanCleanupsTotal.inc(count);
  }
}

export function recordSubagentMetrics(data: {
  status: string;
  durationMs: number;
  rounds: number;
}) {
  subagentRunsTotal.inc({ status: data.status });
  subagentDurationSeconds.observe(data.durationMs / 1000);
  subagentToolRounds.observe(data.rounds);
}

export function recordToolMetrics(data: {
  toolName: string;
  durationMs: number;
  success: boolean;
}) {
  toolExecutionDuration.observe(
    { tool_name: data.toolName, status: data.success ? "success" : "error" },
    data.durationMs / 1000,
  );
}

export function recordLlmMetrics(data: {
  provider: string;
  model: string;
  taskCategory: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  estimatedCostMicros?: number;
  success: boolean;
}) {
  const labels = { provider: data.provider, model: data.model, task_category: data.taskCategory };
  llmRequestDuration.observe(labels, data.durationMs / 1000);
  llmRequestsTotal.inc({ ...labels, status: data.success ? "success" : "error" });
  llmTokensTotal.inc({ provider: data.provider, model: data.model, direction: "input" }, data.inputTokens);
  llmTokensTotal.inc({ provider: data.provider, model: data.model, direction: "output" }, data.outputTokens);
  if (data.estimatedCostMicros) {
    llmCostMicros.inc({ provider: data.provider, model: data.model }, data.estimatedCostMicros);
  }
}

// Rolling averages per route: { sum, count }
const durationAccumulators = new Map<string, { sum: number; count: number }>();

function recordDuration(route: string, durationMs: number) {
  let acc = durationAccumulators.get(route);
  if (!acc) {
    acc = { sum: 0, count: 0 };
    durationAccumulators.set(route, acc);
  }
  acc.sum += durationMs;
  acc.count += 1;
  httpRequestDurationAvgMs.set({ route }, acc.sum / acc.count);
}

// Periodically update process gauges
function startProcessMetrics() {
  const update = () => {
    processMemoryRssBytes.set(process.memoryUsage().rss);
    processUptimeSeconds.set(process.uptime());
  };
  update();
  const interval = setInterval(update, 15_000);
  interval.unref();
  return interval;
}

// Track previous completed/failed counts for counter increments
const prevCompleted = new Map<string, number>();
const prevFailed = new Map<string, number>();

async function updateQueueMetrics() {
  try {
    const { getAllQueueStatus, getStaleJobCounts } = await import("@ai-cofounder/queue");

    const statuses = await getAllQueueStatus();
    // If we got here, Redis is reachable (BullMQ uses Redis internally)
    redisUp.set(1);
    let dlqTotal = 0;
    for (const s of statuses) {
      queueDepth.set({ queue: s.name }, s.waiting);
      queueActiveJobs.set({ queue: s.name }, s.active);
      if (s.name === "dead-letter") {
        dlqTotal = s.waiting + s.failed;
      }

      // Increment counters by delta since last collection
      const prevC = prevCompleted.get(s.name) ?? 0;
      if (s.completed > prevC) {
        queueJobsCompletedTotal.inc({ queue: s.name }, s.completed - prevC);
      }
      prevCompleted.set(s.name, s.completed);

      const prevF = prevFailed.get(s.name) ?? 0;
      if (s.failed > prevF) {
        queueJobsFailedTotal.inc({ queue: s.name }, s.failed - prevF);
      }
      prevFailed.set(s.name, s.failed);

      // Track oldest waiting job age per queue
      if (s.oldestWaitingTimestamp) {
        const ageSeconds = (Date.now() - s.oldestWaitingTimestamp) / 1000;
        queueOldestWaitingJobAgeSeconds.set({ queue: s.name }, ageSeconds);
      } else {
        queueOldestWaitingJobAgeSeconds.set({ queue: s.name }, 0);
      }
    }
    dlqSizeTotal.set(dlqTotal);

    // Stale job detection
    const stale = await getStaleJobCounts();
    // Reset all to 0 first, then set stale ones
    for (const s of statuses) {
      if (s.name !== "dead-letter") {
        queueStaleJobs.set({ queue: s.name }, 0);
      }
    }
    for (const s of stale) {
      queueStaleJobs.set({ queue: s.name }, s.staleCount);
    }
  } catch {
    // Redis not available — mark as down
    redisUp.set(0);
  }
}

export const observabilityPlugin = fp(async (app: FastifyInstance) => {
  // Collect registered route patterns after server is ready
  const registeredRoutes = new Set<string>();

  // Track intervals for cleanup on server close
  const intervals: ReturnType<typeof setInterval>[] = [];

  app.addHook("onReady", async () => {
    // Fastify exposes all registered routes via printRoutes or iterating
    // We build the set from the routing tree by printing routes
    const routeLines = app.printRoutes({ commonPrefix: false });
    for (const line of routeLines.split("\n")) {
      // Lines look like: "├── /health (GET)" or "│   └── /run (POST)"
      const match = line.match(
        /(?:─|└|├)\s*([A-Z]+)\s+(\/\S*)|(?:─|└|├)\s*(\/\S+)\s+\(([A-Z,\s]+)\)/,
      );
      if (match) {
        const route = match[2] || match[3];
        if (route) registeredRoutes.add(route);
      }
    }

    // Fallback: also parse via the routerPath on actual requests below
    intervals.push(startProcessMetrics());

    // Start queue metrics collection if Redis is configured
    if (process.env.REDIS_URL) {
      updateQueueMetrics(); // initial collection
      const queueInterval = setInterval(updateQueueMetrics, 30_000);
      queueInterval.unref();
      intervals.push(queueInterval);
    }
  });

  // Track request start time and record metrics on response
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).__startTime = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    // Use Fastify's routeOptions.url which gives the registered pattern
    // e.g. "/api/goals/:id" instead of "/api/goals/abc-123"
    const routePattern = request.routeOptions?.url ?? request.url;

    // Normalize: if it's not a registered route pattern, label as "unmatched"
    // routeOptions.url is set for registered routes; for 404s it's undefined
    const isRegistered =
      request.routeOptions?.url !== undefined && request.routeOptions?.url !== null;
    const normalizedRoute = isRegistered ? routePattern : "unmatched";

    const method = request.method;
    const statusCode = reply.statusCode;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;

    // Counters
    httpRequestsTotal.inc({
      method,
      route: normalizedRoute,
      status: String(statusCode),
    });
    httpRequestsByStatus.inc({ status: statusClass });

    if (statusCode >= 500) {
      httpErrorsTotal.inc({ method, route: normalizedRoute });
    }

    // Duration — skip /metrics and /health to avoid noise
    const skipDuration =
      normalizedRoute === "/metrics" ||
      normalizedRoute === "/health" ||
      normalizedRoute.startsWith("/health/");
    const startTime = (request as unknown as Record<string, unknown>).__startTime as
      | bigint
      | undefined;
    if (startTime && !skipDuration) {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      recordDuration(normalizedRoute, durationMs);
      httpRequestDurationSeconds.observe(
        { method, route: normalizedRoute, status: String(statusCode) },
        durationMs / 1000,
      );
    }
  });

  // /metrics endpoint — restricted in the security plugin
  app.get("/metrics", async (_request, reply) => {
    const metrics = await client.register.metrics();
    reply.type(client.register.contentType).send(metrics);
  });

  // Clean up intervals on server close
  app.addHook("onClose", async () => {
    for (const interval of intervals) {
      clearInterval(interval);
    }
  });
});
