import { describe, it, expect, vi, beforeEach } from "vitest";

// Use a valid 64-char hex key for testing (32 bytes)
const TEST_KEY = "a".repeat(64);
const ALT_KEY = "b".repeat(64);

let currentKey = TEST_KEY;

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => {
    if (_name === "TOKEN_ENCRYPTION_KEY") return currentKey;
    return defaultValue;
  },
}));

let encryptToken: typeof import("../services/crypto.js").encryptToken;
let decryptToken: typeof import("../services/crypto.js").decryptToken;
let isEncryptionConfigured: typeof import("../services/crypto.js").isEncryptionConfigured;

beforeEach(async () => {
  currentKey = TEST_KEY;
  vi.resetModules();
  const mod = await import("../services/crypto.js");
  encryptToken = mod.encryptToken;
  decryptToken = mod.decryptToken;
  isEncryptionConfigured = mod.isEncryptionConfigured;
});

describe("crypto service", () => {
  it("encrypts and decrypts a string round-trip", () => {
    const plaintext = "my-secret-token-12345";
    const encrypted = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same input (unique IVs)", () => {
    const plaintext = "same-value";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    // Both should still decrypt correctly
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptToken("secret");
    const parts = encrypted.split(":");
    // Flip a character in the ciphertext portion
    const tampered = parts[2][0] === "a" ? "b" + parts[2].slice(1) : "a" + parts[2].slice(1);
    const bad = `${parts[0]}:${parts[1]}:${tampered}`;
    expect(() => decryptToken(bad)).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const encrypted = encryptToken("secret");
    const parts = encrypted.split(":");
    // Flip a character in the auth tag
    const tampered = parts[1][0] === "a" ? "b" + parts[1].slice(1) : "a" + parts[1].slice(1);
    const bad = `${parts[0]}:${tampered}:${parts[2]}`;
    expect(() => decryptToken(bad)).toThrow();
  });

  it("rejects decryption with a different key", async () => {
    const encrypted = encryptToken("secret");
    // Switch to a different key and re-import
    currentKey = ALT_KEY;
    vi.resetModules();
    const mod2 = await import("../services/crypto.js");
    expect(() => mod2.decryptToken(encrypted)).toThrow();
  });

  it("throws on malformed format (missing delimiter)", () => {
    expect(() => decryptToken("no-colons-here")).toThrow("Invalid encrypted token format");
  });

  it("throws on invalid IV length", () => {
    // IV should be 24 hex chars (12 bytes). Use a short one.
    const shortIv = "aabb";
    const validTag = "a".repeat(32); // 16 bytes
    const ciphertext = "deadbeef";
    expect(() => decryptToken(`${shortIv}:${validTag}:${ciphertext}`)).toThrow(
      "Invalid IV or auth tag length",
    );
  });

  it("throws when encryption key is missing", async () => {
    currentKey = "";
    vi.resetModules();
    const mod2 = await import("../services/crypto.js");
    expect(() => mod2.encryptToken("test")).toThrow("TOKEN_ENCRYPTION_KEY must be a 64-character hex string");
  });

  it("throws when encryption key is too short", async () => {
    currentKey = "abcd1234"; // Only 8 chars, need 64
    vi.resetModules();
    const mod2 = await import("../services/crypto.js");
    expect(() => mod2.encryptToken("test")).toThrow("TOKEN_ENCRYPTION_KEY must be a 64-character hex string");
  });

  it("isEncryptionConfigured returns true when valid key is set", () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it("isEncryptionConfigured returns false when no key", async () => {
    currentKey = "";
    vi.resetModules();
    const mod2 = await import("../services/crypto.js");
    expect(mod2.isEncryptionConfigured()).toBe(false);
  });
});
