import { describe, it, expect, beforeAll } from "vitest";

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

  it("goalsCommand has correct name and description", async () => {
    const { goalsCommand } = await import("../commands/goals.js");
    const json = goalsCommand.toJSON();
    expect(json.name).toBe("goals");
    expect(json.description).toBeDefined();
  });

  it("tasksCommand has correct name and description", async () => {
    const { tasksCommand } = await import("../commands/tasks.js");
    const json = tasksCommand.toJSON();
    expect(json.name).toBe("tasks");
    expect(json.description).toBeDefined();
  });

  it("memoryCommand has correct name and description", async () => {
    const { memoryCommand } = await import("../commands/memory.js");
    const json = memoryCommand.toJSON();
    expect(json.name).toBe("memory");
    expect(json.description).toBeDefined();
  });

  it("clearCommand has correct name and description", async () => {
    const { clearCommand } = await import("../commands/clear.js");
    const json = clearCommand.toJSON();
    expect(json.name).toBe("clear");
    expect(json.description).toBeDefined();
  });

  it("executeCommand has correct name and required option", async () => {
    const { executeCommand } = await import("../commands/execute.js");
    const json = executeCommand.toJSON();
    expect(json.name).toBe("execute");
    expect(json.options).toHaveLength(1);
    expect(json.options![0].name).toBe("goal_id");
    expect(json.options![0].required).toBe(true);
  });

  it("approveCommand has correct name and required option", async () => {
    const { approveCommand } = await import("../commands/approve.js");
    const json = approveCommand.toJSON();
    expect(json.name).toBe("approve");
    expect(json.options).toHaveLength(1);
    expect(json.options![0].name).toBe("approval_id");
    expect(json.options![0].required).toBe(true);
  });
});
