import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEnv, optionalEnv } from "../config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("requireEnv", () => {
    it("returns the value when set", () => {
      process.env.TEST_VAR = "hello";
      expect(requireEnv("TEST_VAR")).toBe("hello");
    });

    it("throws when not set", () => {
      delete process.env.TEST_VAR;
      expect(() => requireEnv("TEST_VAR")).toThrow(
        "Missing required environment variable: TEST_VAR",
      );
    });
  });

  describe("optionalEnv", () => {
    it("returns the value when set", () => {
      process.env.TEST_VAR = "hello";
      expect(optionalEnv("TEST_VAR", "default")).toBe("hello");
    });

    it("returns the default when not set", () => {
      delete process.env.TEST_VAR;
      expect(optionalEnv("TEST_VAR", "default")).toBe("default");
    });
  });
});
