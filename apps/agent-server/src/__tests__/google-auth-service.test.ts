import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockGetGoogleToken = vi.fn();
const mockUpsertGoogleToken = vi.fn();
const mockDeleteGoogleToken = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  getGoogleToken: (...args: unknown[]) => mockGetGoogleToken(...args),
  upsertGoogleToken: (...args: unknown[]) => mockUpsertGoogleToken(...args),
  deleteGoogleToken: (...args: unknown[]) => mockDeleteGoogleToken(...args),
}));

const mockEncryptToken = vi.fn((v: string) => `encrypted:${v}`);
const mockDecryptToken = vi.fn((v: string) => v.replace("encrypted:", ""));

vi.mock("../services/crypto.js", () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

let envVars: Record<string, string> = {};

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, defaultValue: string) => envVars[name] ?? defaultValue,
}));

const mockFetch = vi.fn();

// --- Import under test ---
const { getValidGoogleToken, isGoogleConnected, getGoogleConnectionStatus, disconnectGoogle } =
  await import("../services/google-auth.js");

const fakeDb = {} as any;
const adminUserId = "admin-1";

function makeTokenRecord(overrides: Record<string, unknown> = {}) {
  return {
    accessTokenEncrypted: "encrypted:valid-access-token",
    refreshTokenEncrypted: "encrypted:valid-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    scopes: "https://www.googleapis.com/auth/gmail.readonly",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  envVars = {
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
  };
});

describe("getValidGoogleToken", () => {
  it("returns null when no token record exists", async () => {
    mockGetGoogleToken.mockResolvedValue(null);
    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBeNull();
  });

  it("returns decrypted access token when not expired", async () => {
    mockGetGoogleToken.mockResolvedValue(makeTokenRecord());
    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBe("valid-access-token");
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:valid-access-token");
  });

  it("refreshes token when < 5 min to expiry", async () => {
    // Token expires in 2 minutes (< 5 min buffer)
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 2 * 60 * 1000) }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        token_type: "Bearer",
      }),
    });

    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBe("new-access-token");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("upserts new encrypted token after refresh", async () => {
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 1000) }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "refreshed-token",
        expires_in: 3600,
        scope: "new-scope",
        token_type: "Bearer",
      }),
    });

    await getValidGoogleToken(fakeDb, adminUserId);
    expect(mockUpsertGoogleToken).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({
        adminUserId,
        accessTokenEncrypted: "encrypted:refreshed-token",
        scopes: "new-scope",
      }),
    );
  });

  it("deletes token on 400 refresh response", async () => {
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 1000) }),
    );
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid_grant",
    });

    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBeNull();
    expect(mockDeleteGoogleToken).toHaveBeenCalledWith(fakeDb, adminUserId);
  });

  it("deletes token on 401 refresh response", async () => {
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 1000) }),
    );
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBeNull();
    expect(mockDeleteGoogleToken).toHaveBeenCalledWith(fakeDb, adminUserId);
  });

  it("returns null when Google OAuth is not configured", async () => {
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 1000) }),
    );
    envVars = {}; // No GOOGLE_CLIENT_ID or SECRET
    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBeNull();
  });

  it("returns null on network error during refresh", async () => {
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() + 1000) }),
    );
    mockFetch.mockRejectedValue(new Error("network failure"));
    const result = await getValidGoogleToken(fakeDb, adminUserId);
    expect(result).toBeNull();
  });
});

describe("isGoogleConnected", () => {
  it("returns true when record exists", async () => {
    mockGetGoogleToken.mockResolvedValue(makeTokenRecord());
    expect(await isGoogleConnected(fakeDb, adminUserId)).toBe(true);
  });

  it("returns false when no record exists", async () => {
    mockGetGoogleToken.mockResolvedValue(null);
    expect(await isGoogleConnected(fakeDb, adminUserId)).toBe(false);
  });
});

describe("getGoogleConnectionStatus", () => {
  it("returns scopes and expiresAt when connected", async () => {
    const expiresAt = new Date("2025-01-01T00:00:00Z");
    mockGetGoogleToken.mockResolvedValue(
      makeTokenRecord({
        expiresAt,
        scopes: "scope1 scope2",
      }),
    );
    const status = await getGoogleConnectionStatus(fakeDb, adminUserId);
    expect(status).toEqual({
      connected: true,
      scopes: ["scope1", "scope2"],
      expiresAt: expiresAt.toISOString(),
    });
  });

  it("returns disconnected status when no record", async () => {
    mockGetGoogleToken.mockResolvedValue(null);
    const status = await getGoogleConnectionStatus(fakeDb, adminUserId);
    expect(status).toEqual({ connected: false, scopes: null, expiresAt: null });
  });
});

describe("disconnectGoogle", () => {
  it("revokes token and deletes from DB", async () => {
    mockGetGoogleToken.mockResolvedValue(makeTokenRecord());
    mockFetch.mockResolvedValue({ ok: true });

    await disconnectGoogle(fakeDb, adminUserId);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://oauth2.googleapis.com/revoke?token="),
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockDeleteGoogleToken).toHaveBeenCalledWith(fakeDb, adminUserId);
  });

  it("is a no-op when no record exists", async () => {
    mockGetGoogleToken.mockResolvedValue(null);
    await disconnectGoogle(fakeDb, adminUserId);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDeleteGoogleToken).not.toHaveBeenCalled();
  });
});
