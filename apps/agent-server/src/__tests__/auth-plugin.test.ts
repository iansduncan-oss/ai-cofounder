import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

/* ─── Controllable mocks ─────────────────────────────────── */

const mockOptionalEnv = vi.fn((_name: string, defaultValue: string) => defaultValue);
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => mockLogger,
  optionalEnv: (...args: unknown[]) => mockOptionalEnv(...(args as [string, string])),
  requireEnv: (_name: string) => "mock-value",
}));

const mockCountAdminUsers = vi.fn().mockResolvedValue(0);
const mockCreateAdminUser = vi.fn().mockResolvedValue({ id: "admin-1" });

vi.mock("@ai-cofounder/db", () => ({
  countAdminUsers: (...args: unknown[]) => mockCountAdminUsers(...args),
  createAdminUser: (...args: unknown[]) => mockCreateAdminUser(...args),
}));

const mockBcryptHash = vi.fn().mockResolvedValue("$2a$12$hashedpassword");

vi.mock("bcryptjs", () => ({
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
  hash: (...args: unknown[]) => mockBcryptHash(...args),
}));

/* ─── Import plugin after mocks ──────────────────────────── */

const { authPlugin } = await import("../plugins/auth.js");

/* ─── Helpers ────────────────────────────────────────────── */

const mockDb = {} as unknown;

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  // The auth plugin accesses app.db in the onReady hook
  app.decorate("db", mockDb);
  return app;
}

/** Configure mockOptionalEnv to return specific values by env var name */
function setEnvMock(overrides: Record<string, string>) {
  mockOptionalEnv.mockImplementation((name: string, defaultValue: string) => {
    return name in overrides ? overrides[name] : defaultValue;
  });
}

/* ─── Tests ──────────────────────────────────────────────── */

let app: FastifyInstance;

beforeEach(() => {
  vi.clearAllMocks();
  mockBcryptHash.mockResolvedValue("$2a$12$hashedpassword");
  mockCountAdminUsers.mockResolvedValue(0);
  mockCreateAdminUser.mockResolvedValue({ id: "admin-1" });
});

afterEach(async () => {
  if (app) {
    await app.close();
  }
});

describe("Auth plugin — disabled when secrets missing", () => {
  it("returns early when JWT_SECRET is missing", async () => {
    setEnvMock({ COOKIE_SECRET: "some-cookie-secret" });
    // JWT_SECRET falls through to default "" → falsy

    app = createApp();
    await app.register(authPlugin);
    await app.ready();

    // Plugin should have returned early without registering cookie/jwt
    expect(app.hasDecorator("jwt")).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("returns early when COOKIE_SECRET is missing", async () => {
    setEnvMock({ JWT_SECRET: "some-jwt-secret" });
    // COOKIE_SECRET falls through to default "" → falsy

    app = createApp();
    await app.register(authPlugin);
    await app.ready();

    expect(app.hasDecorator("jwt")).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("Auth plugin — production mode", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("throws in production when secrets are not set", async () => {
    process.env.NODE_ENV = "production";
    // Both secrets empty (defaults)
    setEnvMock({});

    app = createApp();

    // Fastify plugin errors surface during ready()
    // Suppress Fastify's internal error event to avoid unhandled errors
    app.register(authPlugin);

    let thrownError: Error | undefined;
    try {
      await app.ready();
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toBe("JWT_SECRET and COOKIE_SECRET must be set in production");
  });
});

describe("Auth plugin — admin seed on ready", () => {
  it("creates admin when count is 0", async () => {
    setEnvMock({
      JWT_SECRET: "test-jwt-secret-32-chars-minimum!!",
      COOKIE_SECRET: "test-cookie-secret-32-chars-min!!",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "supersecret",
    });
    mockCountAdminUsers.mockResolvedValueOnce(0);
    mockCreateAdminUser.mockResolvedValueOnce({ id: "admin-1" });
    mockBcryptHash.mockResolvedValueOnce("$2a$12$hashedpassword");

    app = createApp();
    await app.register(authPlugin);
    await app.ready();

    expect(mockCountAdminUsers).toHaveBeenCalledWith(mockDb);
    expect(mockBcryptHash).toHaveBeenCalledWith("supersecret", 12);
    expect(mockCreateAdminUser).toHaveBeenCalledWith(mockDb, {
      email: "admin@example.com",
      passwordHash: "$2a$12$hashedpassword",
    });
  });

  it("skips creation when admins already exist", async () => {
    setEnvMock({
      JWT_SECRET: "test-jwt-secret-32-chars-minimum!!",
      COOKIE_SECRET: "test-cookie-secret-32-chars-min!!",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "supersecret",
    });
    mockCountAdminUsers.mockResolvedValueOnce(1);

    app = createApp();
    await app.register(authPlugin);
    await app.ready();

    expect(mockCountAdminUsers).toHaveBeenCalledWith(mockDb);
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });

  it("skips seed when ADMIN_EMAIL is not set", async () => {
    setEnvMock({
      JWT_SECRET: "test-jwt-secret-32-chars-minimum!!",
      COOKIE_SECRET: "test-cookie-secret-32-chars-min!!",
      // ADMIN_EMAIL and ADMIN_PASSWORD not set → default ""
    });

    app = createApp();
    await app.register(authPlugin);
    await app.ready();

    expect(mockCountAdminUsers).not.toHaveBeenCalled();
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });

  it("handles countAdminUsers error gracefully", async () => {
    setEnvMock({
      JWT_SECRET: "test-jwt-secret-32-chars-minimum!!",
      COOKIE_SECRET: "test-cookie-secret-32-chars-min!!",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "supersecret",
    });
    mockCountAdminUsers.mockRejectedValueOnce(new Error("DB connection failed"));

    app = createApp();
    await app.register(authPlugin);

    // Should not throw — error is caught and logged
    await expect(app.ready()).resolves.not.toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });
});
