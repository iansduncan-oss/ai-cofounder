import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  // Prevent requireEnv from throwing during tests
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";
});

describe("discord-bot", () => {
  it("askCommand has correct name and description", async () => {
    const { askCommand } = await import("../commands/ask.js");
    const json = askCommand.toJSON();
    expect(json.name).toBe("ask");
    expect(json.description).toContain("AI Cofounder");
    expect(json.options).toHaveLength(1);
    expect(json.options![0].name).toBe("message");
    expect(json.options![0].required).toBe(true);
  });

  it("statusCommand has correct name", async () => {
    const { statusCommand } = await import("../commands/status.js");
    const json = statusCommand.toJSON();
    expect(json.name).toBe("status");
  });
});
