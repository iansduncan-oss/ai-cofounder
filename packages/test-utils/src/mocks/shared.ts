import { vi } from "vitest";

/**
 * Creates a mock logger with all standard pino methods.
 * Usage: `createLogger: () => createMockLogger()`
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

/**
 * Returns the factory object for vi.mock("@ai-cofounder/shared").
 * Usage: `vi.mock("@ai-cofounder/shared", () => mockSharedModule())`
 */
export function mockSharedModule() {
  return {
    createLogger: () => createMockLogger(),
    requireEnv: (name: string) => `test-${name}`,
    optionalEnv: (_name: string, defaultValue: string) => defaultValue,
    sanitizeToolResult: (text: string) => text,
  };
}
