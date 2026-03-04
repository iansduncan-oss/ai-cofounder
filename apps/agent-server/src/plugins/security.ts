import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLogger } from "@ai-cofounder/shared";

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

// Paths that are never legitimate — instant 403
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
function startCleanup() {
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
}

export const securityPlugin = fp(async (app: FastifyInstance) => {
  startCleanup();

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
  });

  // Track 404s for rate-limiting
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode === 404) {
      const ip = getClientIp(request);
      recordHit(ip);
    }
  });
});
