import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared (required before import)
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { DistributedLockService, AUTONOMOUS_SESSION_LOCK } = await import(
  "../services/distributed-lock.js"
);

function createMockRedis() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    eval: vi.fn(),
  };
}

describe("DistributedLockService", () => {
  let redis: ReturnType<typeof createMockRedis>;
  let service: InstanceType<typeof DistributedLockService>;

  beforeEach(() => {
    redis = createMockRedis();
    service = new DistributedLockService(redis as any);
  });

  describe("acquire()", () => {
    it("returns a token string when redis.set returns 'OK'", async () => {
      redis.set.mockResolvedValue("OK");
      const token = await service.acquire("my-lock", 5000);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("calls redis.set with NX and PX options", async () => {
      redis.set.mockResolvedValue("OK");
      await service.acquire("my-lock", 30_000);
      expect(redis.set).toHaveBeenCalledWith(
        "my-lock",
        expect.any(String),
        "PX",
        30_000,
        "NX",
      );
    });

    it("returns null when redis.set returns null (lock already held)", async () => {
      redis.set.mockResolvedValue(null);
      const token = await service.acquire("my-lock", 5000);
      expect(token).toBeNull();
    });

    it("generates unique tokens across multiple calls", async () => {
      redis.set.mockResolvedValue("OK");
      const token1 = await service.acquire("lock-a", 5000);
      const token2 = await service.acquire("lock-b", 5000);
      expect(token1).not.toBe(token2);
    });

    it("token is a well-formed UUID", async () => {
      redis.set.mockResolvedValue("OK");
      const token = await service.acquire("my-lock", 5000);
      // Implementation uses crypto.randomUUID() — a v4 UUID (8-4-4-4-12 hex).
      // The prior assertion that the prefix was a timestamp worked by
      // accident: parseInt succeeded only when the first hex segment
      // happened to start with a digit. Replaced with a real format check.
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("release()", () => {
    it("calls redis.eval with Lua script and lock key + token", async () => {
      redis.eval.mockResolvedValue(1);
      const result = await service.release("my-lock", "my-token");
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get"'),
        1,
        "my-lock",
        "my-token",
      );
      expect(result).toBe(true);
    });

    it("returns true when eval returns 1 (lock released)", async () => {
      redis.eval.mockResolvedValue(1);
      const result = await service.release("my-lock", "correct-token");
      expect(result).toBe(true);
    });

    it("returns false when eval returns 0 (token mismatch)", async () => {
      redis.eval.mockResolvedValue(0);
      const result = await service.release("my-lock", "wrong-token");
      expect(result).toBe(false);
    });

    it("Lua script checks get before deleting", async () => {
      redis.eval.mockResolvedValue(1);
      await service.release("my-lock", "my-token");
      const luaScript = redis.eval.mock.calls[0][0] as string;
      expect(luaScript).toContain('redis.call("get", KEYS[1])');
      expect(luaScript).toContain('ARGV[1]');
      expect(luaScript).toContain('redis.call("del", KEYS[1])');
    });
  });

  describe("isLocked()", () => {
    it("returns true when redis.exists returns 1", async () => {
      redis.exists.mockResolvedValue(1);
      const result = await service.isLocked("my-lock");
      expect(result).toBe(true);
    });

    it("returns false when redis.exists returns 0", async () => {
      redis.exists.mockResolvedValue(0);
      const result = await service.isLocked("my-lock");
      expect(result).toBe(false);
    });

    it("calls redis.exists with the lock key", async () => {
      redis.exists.mockResolvedValue(0);
      await service.isLocked("some-key");
      expect(redis.exists).toHaveBeenCalledWith("some-key");
    });
  });

  describe("AUTONOMOUS_SESSION_LOCK constant", () => {
    it("is a non-empty string", () => {
      expect(typeof AUTONOMOUS_SESSION_LOCK).toBe("string");
      expect(AUTONOMOUS_SESSION_LOCK.length).toBeGreaterThan(0);
    });

    it("contains 'autonomous-session'", () => {
      expect(AUTONOMOUS_SESSION_LOCK).toContain("autonomous-session");
    });
  });
});
