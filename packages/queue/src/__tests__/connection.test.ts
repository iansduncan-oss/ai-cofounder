import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

import { getRedisConnection, resetRedisConnection } from "../connection.js";

beforeEach(() => {
  resetRedisConnection();
});

describe("getRedisConnection", () => {
  it("parses REDIS_URL with host, port, and password", () => {
    const conn = getRedisConnection("redis://:mysecretpass@redis.example.com:6380");

    expect(conn.host).toBe("redis.example.com");
    expect(conn.port).toBe(6380);
    expect(conn.password).toBe("mysecretpass");
  });

  it("uses default localhost:6379 when no URL provided", () => {
    delete process.env.REDIS_URL;
    const conn = getRedisConnection();

    expect(conn.host).toBe("localhost");
    expect(conn.port).toBe(6379);
    expect(conn.password).toBeUndefined();
  });

  it("parses REDIS_URL from environment when no argument given", () => {
    process.env.REDIS_URL = "redis://redis-host:6381";
    resetRedisConnection();
    const conn = getRedisConnection();

    expect(conn.host).toBe("redis-host");
    expect(conn.port).toBe(6381);

    delete process.env.REDIS_URL;
  });

  it("sets maxRetriesPerRequest to null (required by BullMQ)", () => {
    const conn = getRedisConnection("redis://localhost:6379");
    expect(conn.maxRetriesPerRequest).toBeNull();
  });

  it("sets enableReadyCheck to false", () => {
    const conn = getRedisConnection("redis://localhost:6379");
    expect(conn.enableReadyCheck).toBe(false);
  });

  it("returns cached connection on subsequent calls", () => {
    const conn1 = getRedisConnection("redis://localhost:6379");
    const conn2 = getRedisConnection("redis://different-host:6380");

    // Second call should return same object (singleton)
    expect(conn1).toBe(conn2);
  });

  it("provides a retryStrategy that increases delay up to 5000ms", () => {
    const conn = getRedisConnection("redis://localhost:6379");
    const strategy = conn.retryStrategy as (times: number) => number;

    expect(strategy(1)).toBe(500);
    expect(strategy(2)).toBe(1000);
    expect(strategy(5)).toBe(2500);
    expect(strategy(10)).toBe(5000);
    expect(strategy(100)).toBe(5000); // capped at 5000
  });

  it("handles URL with no port (defaults to 6379)", () => {
    const conn = getRedisConnection("redis://redis-host");

    expect(conn.host).toBe("redis-host");
    expect(conn.port).toBe(6379);
  });

  it("handles URL with no password", () => {
    const conn = getRedisConnection("redis://redis-host:6379");
    expect(conn.password).toBeUndefined();
  });
});

describe("resetRedisConnection", () => {
  it("clears the cached connection so next call creates a new one", () => {
    const conn1 = getRedisConnection("redis://host1:6379");
    resetRedisConnection();
    const conn2 = getRedisConnection("redis://host2:6380");

    expect(conn1).not.toBe(conn2);
    expect(conn1.host).toBe("host1");
    expect(conn2.host).toBe("host2");
  });
});
