import { describe, it, expect } from "vitest";
import { users, conversations, messages, agentRuns } from "../schema.js";

describe("schema", () => {
  it("exports all tables", () => {
    expect(users).toBeDefined();
    expect(conversations).toBeDefined();
    expect(messages).toBeDefined();
    expect(agentRuns).toBeDefined();
  });

  it("users table has expected columns", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("id");
    expect(columns).toContain("externalId");
    expect(columns).toContain("platform");
  });

  it("agentRuns table has expected columns", () => {
    const columns = Object.keys(agentRuns);
    expect(columns).toContain("id");
    expect(columns).toContain("agentRole");
    expect(columns).toContain("status");
    expect(columns).toContain("input");
    expect(columns).toContain("output");
  });
});
