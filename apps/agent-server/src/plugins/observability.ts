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

const processMemoryRssBytes = new client.Gauge({
  name: "process_memory_rss_bytes",
  help: "Process RSS memory in bytes",
});

const processUptimeSeconds = new client.Gauge({
  name: "process_uptime_seconds",
  help: "Process uptime in seconds",
});

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

export const observabilityPlugin = fp(async (app: FastifyInstance) => {
  // Collect registered route patterns after server is ready
  const registeredRoutes = new Set<string>();

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
    startProcessMetrics();
  });

  // Track request start time and record metrics on response
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).__startTime =
      process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    // Use Fastify's routeOptions.url which gives the registered pattern
    // e.g. "/api/goals/:id" instead of "/api/goals/abc-123"
    const routePattern = request.routeOptions?.url ?? request.url;

    // Normalize: if it's not a registered route pattern, label as "unmatched"
    // routeOptions.url is set for registered routes; for 404s it's undefined
    const isRegistered =
      request.routeOptions?.url !== undefined &&
      request.routeOptions?.url !== null;
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

    // Duration
    const startTime = (request as unknown as Record<string, unknown>)
      .__startTime as bigint | undefined;
    if (startTime) {
      const durationMs =
        Number(process.hrtime.bigint() - startTime) / 1_000_000;
      recordDuration(normalizedRoute, durationMs);
    }
  });

  // /metrics endpoint — restricted in the security plugin
  app.get("/metrics", async (_request, reply) => {
    const metrics = await client.register.metrics();
    reply.type(client.register.contentType).send(metrics);
  });
});
