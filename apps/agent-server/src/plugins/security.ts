import crypto from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { createEvent, type Db } from "@ai-cofounder/db";

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
  "python-requests",
  "go-http-client",
  "scrapy",
  "libwww-perl",
];

// Paths that trigger tighter rate limits (expensive LLM calls + admin endpoints)
const EXPENSIVE_PATHS = [
  "/api/agents/run",
  "/api/n8n/webhook",
  "/api/goals/",
  "/api/settings",
  "/api/database/",
  "/api/autonomy/",
];

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
      key: string,
      maxRequests: number,
      windowMs: number,
    ): { limited: boolean; remaining: number; resetMs: number } {
      const now = Date.now();
      let record = map.get(key);

      if (!record || now - record.windowStart > windowMs) {
        record = { count: 0, windowStart: now };
        map.set(key, record);
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
const inFlightRequests = new Map<string, number>();

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

// Set by the plugin so recordHit can log bans to DB
let banEventDb: Db | undefined;

function getClientIp(request: FastifyRequest): string {
  // Use request.ip for rate limiting (respects trustProxy / X-Forwarded-For)
  return request.ip;
}

function getSocketIp(request: FastifyRequest): string {
  // Use socket.remoteAddress for security checks — this is the actual TCP peer,
  // not spoofable via X-Forwarded-For when trustProxy is enabled
  return request.socket.remoteAddress ?? "";
}

export function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  // 172.16.0.0/12 = 172.16.x.x through 172.31.x.x
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function isInternalRequest(request: FastifyRequest): boolean {
  const socketIp = getSocketIp(request);
  if (!isPrivateIp(socketIp)) return false;
  // When trustProxy is on and X-Forwarded-For is present, request.ip differs
  // from socket IP — check the forwarded IP too
  const clientIp = getClientIp(request);
  if (clientIp !== socketIp && !isPrivateIp(clientIp)) return false;
  return true;
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
    // Record ban event in DB if available (fire-and-forget)
    if (banEventDb) {
      createEvent(banEventDb, {
        source: "security",
        type: "ip_banned",
        payload: { ip, hits: record.hits, durationMs: BAN_DURATION_MS },
      }).catch((err) => logger.warn({ err }, "ban event DB write failed"));
    }
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

/** Reset all module-level security state. For testing only. */
export function _resetSecurityState(): void {
  ipHits.clear();
  bannedIps.clear();
  generalBucket.map.clear();
  expensiveBucket.map.clear();
  inFlightRequests.clear();
}

export const securityPlugin = fp(async (app: FastifyInstance) => {
  // Make DB available to recordHit for ban logging once ready
  app.addHook("onReady", async () => {
    banEventDb = app.db;
  });

  const banCleanupInterval = startCleanup();

  const apiSecret = optionalEnv("API_SECRET", "");
  // When JWT_SECRET is set, JWT auth handles protected routes — API_SECRET only applies to bot routes
  const jwtSecret = optionalEnv("JWT_SECRET", "");
  const concurrentRequestLimit = parseInt(optionalEnv("CONCURRENT_REQUEST_LIMIT", "3"), 10);
  const rateLimitMax = parseInt(optionalEnv("RATE_LIMIT_MAX", "120"), 10);
  const rateLimitWindowSec = parseInt(optionalEnv("RATE_LIMIT_WINDOW", "60"), 10);
  const rateLimitWindowMs = rateLimitWindowSec * 1000;
  // Expensive endpoints get a tighter limit (default: 20 per window)
  const expensiveLimitMax = parseInt(optionalEnv("RATE_LIMIT_EXPENSIVE_MAX", "20"), 10);

  if (apiSecret && jwtSecret) {
    logger.info("JWT auth active — API_SECRET limited to bot routes (/api/channels/, /api/webhooks/)");
  } else if (apiSecret) {
    logger.info("API bearer token auth enabled (all /api/* routes)");
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
    //    Uses IP-based bucketing to prevent bypass via forged JWT sub claims.
    if (url.startsWith("/api/") || url === "/voice/chat") {
      const isExpensive = EXPENSIVE_PATHS.some((p) => url.startsWith(p)) || url === "/voice/chat";
      const bucket = isExpensive ? expensiveBucket : generalBucket;
      const limit = isExpensive ? expensiveLimitMax : rateLimitMax;
      const bucketKey = `ip:${ip}`;
      const { limited, remaining, resetMs } = bucket.check(bucketKey, limit, rateLimitWindowMs);
      reply.header("X-RateLimit-Limit", limit);
      reply.header("X-RateLimit-Remaining", remaining);
      reply.header("X-RateLimit-Reset", Math.ceil(resetMs / 1000));
      if (limited) {
        logger.debug({ ip, expensive: isExpensive }, "rate limited");
        reply.code(429).send({ error: "Too many requests", retryAfter: Math.ceil(resetMs / 1000) });
        return;
      }
    }

    // 6. Per-IP concurrent request limit on expensive endpoints
    if (url.startsWith("/api/") || url === "/voice/chat") {
      const concurrentKey = `ip:${ip}`;
      const current = inFlightRequests.get(concurrentKey) ?? 0;
      if (current >= concurrentRequestLimit) {
        logger.debug({ ip, concurrent: current }, "concurrent request limit hit");
        reply.code(429).send({ error: "Too many concurrent requests", retryAfter: 1 });
        return;
      }
      inFlightRequests.set(concurrentKey, current + 1);
      // Stash the key on the request for reliable cleanup in onResponse
      (request as unknown as Record<string, unknown>)._concurrentKey = concurrentKey;
    }

    // 7. Bearer token auth on /api/* routes (skip public paths and internal requests)
    // When JWT is active (jwtSecret set), API_SECRET only enforced on bot routes
    // (channels + webhooks) so Discord/Slack bots continue to work without JWT.
    // Dashboard requests use JWT (handled by jwtGuardPlugin), not API_SECRET.
    if (apiSecret && url.startsWith("/api/") && !isInternalRequest(request)) {
      const isBotRoute =
        url.startsWith("/api/channels/") || url.startsWith("/api/webhooks/");
      const shouldCheck = jwtSecret ? isBotRoute : true;
      if (shouldCheck) {
        const authHeader = request.headers.authorization;
        const expected = `Bearer ${apiSecret}`;
        if (
          !authHeader ||
          authHeader.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
        ) {
          reply.code(401).send({ error: "Unauthorized" });
          return;
        }
      }
    }
  });

  // Track 404s for rate-limiting + decrement in-flight counter
  app.addHook("onResponse", async (request, reply) => {
    // Decrement in-flight request counter
    const concurrentKey = (request as unknown as Record<string, unknown>)._concurrentKey as string | undefined;
    if (concurrentKey) {
      const count = inFlightRequests.get(concurrentKey) ?? 1;
      if (count <= 1) {
        inFlightRequests.delete(concurrentKey);
      } else {
        inFlightRequests.set(concurrentKey, count - 1);
      }
    }

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

  // Clean up intervals and state on server close
  app.addHook("onClose", async () => {
    clearInterval(banCleanupInterval);
    clearInterval(rateLimitCleanupInterval);
    inFlightRequests.clear();
  });
});
