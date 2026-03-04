import { describe, it, expect } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  it("creates a pino logger with the given name", () => {
    const logger = createLogger("test-service");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
