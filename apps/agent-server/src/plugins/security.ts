import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("security");

// --- Configuration ---

const MAX_404_HITS = 10; // ban after this many 404s
const WINDOW_MS = 60_000; // within this time window
const BAN_DURATION_MS = 15 * 60_000; // 15-minute ban

const BLOCKED_USER_AGENTS = [
  "zgrab",
  "masscan",
  "censys",
  "nmap",
  "sqlmap",
  "nikto",
  "dirbuster",
  "gobuster",
  "wfuzz",
  "hydra",
  "nuclei",
  "httpx",
  "curl/",
  "python-requests",
  "go-http-client",
  "wget",
  "scrapy",
  "libwww-perl",
];

// Paths that trigger tighter rate limits (expensive LLM calls)
const EXPENSIVE_PATHS = ["/api/agents/run", "/api/n8n/webhook", "/api/goals/"];

// --- Rate limiter state ---

interface RateLimitRecord {
  count: number;
  windowStart: number;
}

function createRateLimitBucket() {
  const map = new Map<string, RateLimitRecord>();
  return {
    map,
    check(
      ip: string,
      maxRequests: number,
      windowMs: number,
    ): { limited: boolean; remaining: number; resetMs: number } {
      const now = Date.now();
      let record = map.get(ip);

      if (!record || now - record.windowStart > windowMs) {
        record = { count: 0, windowStart: now };
        map.set(ip, record);
      }

      record.count += 1;
      const remaining = Math.max(0, maxRequests - record.count);
      const resetMs = record.windowStart + windowMs - now;

      return { limited: record.count > maxRequests, remaining, resetMs };
    },
  };
}

const generalBucket = createRateLimitBucket();
const expensiveBucket = createRateLimitBucket();

const HONEYPOT_PATHS = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/wp-config",
  "/wp-includes",
  "/xmlrpc.php",
  "/.aws",
  "/.docker",
  "/config.json",
  "/credentials",
  "/phpmyadmin",
  "/pma",
  "/admin.php",
  "/shell",
  "/cgi-bin",
  "/.vscode",
  "/.ssh",
  "/stripe",
];

// --- State ---

interface IpRecord {
  hits: number;
  firstHit: number;
}

const ipHits = new Map<string, IpRecord>();
const bannedIps = new Map<string, number>(); // ip -> ban expiry timestamp

function getClientIp(request: FastifyRequest): string {
  // Behind reverse proxy: use x-forwarded-for or x-real-ip
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp;
  return request.ip;
}

function isInternalRequest(request: FastifyRequest): boolean {
  const ip = getClientIp(request);
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.2") ||
    ip.startsWith("172.3") ||
    ip.startsWith("192.168.") ||
    ip === "::ffff:127.0.0.1"
  );
}

function isBannedIp(ip: string): boolean {
  const expiry = bannedIps.get(ip);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    bannedIps.delete(ip);
    return false;
  }
  return true;
}

function recordHit(ip: string): boolean {
  const now = Date.now();
  let record = ipHits.get(ip);

  if (!record || now - record.firstHit > WINDOW_MS) {
    record = { hits: 0, firstHit: now };
    ipHits.set(ip, record);
  }

  record.hits += 1;

  if (record.hits >= MAX_404_HITS) {
    bannedIps.set(ip, now + BAN_DURATION_MS);
    ipHits.delete(ip);
    logger.warn({ ip, hits: record.hits }, "IP banned for excessive 404s");
    return true; // newly banned
  }

  return false;
}

// Periodic cleanup of stale entries
function startCleanup(): NodeJS.Timeout {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipHits) {
      if (now - record.firstHit > WINDOW_MS) ipHits.delete(ip);
    }
    for (const [ip, expiry] of bannedIps) {
      if (now > expiry) bannedIps.delete(ip);
    }
  }, 60_000);
  interval.unref();
  return interval;
}

export const securityPlugin = fp(async (app: FastifyInstance) => {
  const banCleanupInterval = startCleanup();

  const apiSecret = optionalEnv("API_SECRET", "");
  const rateLimitMax = parseInt(optionalEnv("RATE_LIMIT_MAX", "60"), 10);
  const rateLimitWindowSec = parseInt(optionalEnv("RATE_LIMIT_WINDOW", "60"), 10);
  const rateLimitWindowMs = rateLimitWindowSec * 1000;
  // Expensive endpoints get a tighter limit (default: 10 per window)
  const expensiveLimitMax = parseInt(optionalEnv("RATE_LIMIT_EXPENSIVE_MAX", "10"), 10);

  if (apiSecret) {
    logger.info("API bearer token auth enabled");
  }
  logger.info(
    { maxRequests: rateLimitMax, expensiveMax: expensiveLimitMax, windowSec: rateLimitWindowSec },
    "rate limiting configured",
  );

  app.addHook("onRequest", async (request, reply) => {
    const ip = getClientIp(request);
    const url = request.url.toLowerCase();
    const ua = (request.headers["user-agent"] ?? "").toLowerCase();

    // 0. Allow health checks through (Docker, load balancers, uptime monitors)
    if (url === "/health") return;

    // 1. Check banned IPs
    if (isBannedIp(ip)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    // 2. Block known scanner user agents
    if (BLOCKED_USER_AGENTS.some((bot) => ua.includes(bot))) {
      logger.debug({ ip, ua }, "blocked scanner user agent");
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    // 3. Block honeypot paths immediately
    if (HONEYPOT_PATHS.some((path) => url.startsWith(path))) {
      logger.debug({ ip, url }, "honeypot path hit");
      recordHit(ip); // count toward ban
      recordHit(ip); // double-count honeypots
      recordHit(ip);
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    // 4. Restrict /metrics to internal network only
    if (url === "/metrics" && !isInternalRequest(request)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    // 5. Rate limiting on /api/* and /voice/chat routes (tighter for expensive endpoints)
    if (url.startsWith("/api/") || url === "/voice/chat") {
      const isExpensive = EXPENSIVE_PATHS.some((p) => url.startsWith(p)) || url === "/voice/chat";
      const bucket = isExpensive ? expensiveBucket : generalBucket;
      const limit = isExpensive ? expensiveLimitMax : rateLimitMax;
      const { limited, remaining, resetMs } = bucket.check(ip, limit, rateLimitWindowMs);
      reply.header("X-RateLimit-Limit", limit);
      reply.header("X-RateLimit-Remaining", remaining);
      reply.header("X-RateLimit-Reset", Math.ceil(resetMs / 1000));
      if (limited) {
        logger.debug({ ip, expensive: isExpensive }, "rate limited");
        reply.code(429).send({ error: "Too many requests" });
        return;
      }
    }

    // 6. Bearer token auth on /api/* routes (skip public paths and internal requests)
    if (apiSecret && url.startsWith("/api/") && !isInternalRequest(request)) {
      const authHeader = request.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
    }
  });

  // Track 404s for rate-limiting
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode === 404) {
      const ip = getClientIp(request);
      recordHit(ip);
    }
  });

  // Periodic cleanup of rate limit records
  const rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const bucket of [generalBucket.map, expensiveBucket.map]) {
      for (const [ip, record] of bucket) {
        if (now - record.windowStart > rateLimitWindowMs) bucket.delete(ip);
      }
    }
  }, 60_000);
  rateLimitCleanupInterval.unref();

  // Clean up intervals on server close
  app.addHook("onClose", async () => {
    clearInterval(banCleanupInterval);
    clearInterval(rateLimitCleanupInterval);
  });
});
