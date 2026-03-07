const EXPENSIVE_COMMANDS = new Set(["ask", "execute"]);
const EXPENSIVE_COOLDOWN_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 3_000;

/** Map of "userId:command" → last usage timestamp */
const cooldowns = new Map<string, number>();

/**
 * Check if a user is on cooldown for a command.
 * Returns remaining seconds if on cooldown, or null if allowed.
 */
export function checkCooldown(userId: string, command: string): number | null {
  const key = `${userId}:${command}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(key);
  const cooldownMs = EXPENSIVE_COMMANDS.has(command) ? EXPENSIVE_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;

  if (lastUsed && now - lastUsed < cooldownMs) {
    return Math.ceil((cooldownMs - (now - lastUsed)) / 1000);
  }

  cooldowns.set(key, now);
  return null;
}

/** Clear all cooldowns (useful for testing) */
export function clearCooldowns(): void {
  cooldowns.clear();
}
