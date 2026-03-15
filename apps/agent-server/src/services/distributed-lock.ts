import type Redis from "ioredis";

/**
 * DistributedLockService implements distributed mutual exclusion using Redis SET NX PX.
 *
 * Acquire uses SET NX PX for atomic lock acquisition with a TTL.
 * Release uses a Lua script for atomic compare-and-delete to prevent releasing a lock
 * held by a different token (i.e. prevents a slow process from releasing a newer lock).
 */
export class DistributedLockService {
  constructor(private readonly redis: Redis) {}

  /**
   * Acquire a lock. Returns the lock token (string) if acquired, null if already held.
   * @param lockKey  Redis key to use as the lock
   * @param ttlMs    Lock TTL in milliseconds
   */
  async acquire(lockKey: string, ttlMs: number): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  /**
   * Release a lock held by the given token. Returns true if released, false if token mismatch.
   * Uses an atomic Lua script: only deletes if the stored value matches the token.
   */
  async release(lockKey: string, token: string): Promise<boolean> {
    const luaScript = [
      'if redis.call("get", KEYS[1]) == ARGV[1] then',
      '  return redis.call("del", KEYS[1])',
      "else",
      "  return 0",
      "end",
    ].join("\n");
    const result = await this.redis.eval(luaScript, 1, lockKey, token);
    return (result as number) === 1;
  }

  /**
   * Check if a lock is currently held (key exists).
   */
  async isLocked(lockKey: string): Promise<boolean> {
    return (await this.redis.exists(lockKey)) === 1;
  }
}

/** The Redis key used for the autonomous session distributed lock. */
export const AUTONOMOUS_SESSION_LOCK = "autonomous-session:lock";
