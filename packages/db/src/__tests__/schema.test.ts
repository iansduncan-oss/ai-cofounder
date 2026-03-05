import { describe, it, expect } from "vitest";
import {
  users,
  conversations,
  messages,
  channelConversations,
  goals,
  tasks,
  approvals,
  memories,
  prompts,
  n8nWorkflows,
} from "../schema.js";

describe("schema", () => {
  it("exports all tables", () => {
    expect(users).toBeDefined();
    expect(conversations).toBeDefined();
    expect(messages).toBeDefined();
    expect(channelConversations).toBeDefined();
    expect(goals).toBeDefined();
    expect(tasks).toBeDefined();
    expect(approvals).toBeDefined();
    expect(memories).toBeDefined();
    expect(prompts).toBeDefined();
    expect(n8nWorkflows).toBeDefined();
  });

  it("users table has expected columns", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("id");
    expect(columns).toContain("externalId");
    expect(columns).toContain("platform");
  });

  it("goals table has expected columns", () => {
    const columns = Object.keys(goals);
    expect(columns).toContain("id");
    expect(columns).toContain("conversationId");
    expect(columns).toContain("title");
    expect(columns).toContain("status");
    expect(columns).toContain("priority");
  });

  it("tasks table has expected columns", () => {
    const columns = Object.keys(tasks);
    expect(columns).toContain("id");
    expect(columns).toContain("goalId");
    expect(columns).toContain("title");
    expect(columns).toContain("status");
    expect(columns).toContain("assignedAgent");
    expect(columns).toContain("orderIndex");
  });

  it("memories table has expected columns", () => {
    const columns = Object.keys(memories);
    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("category");
    expect(columns).toContain("key");
    expect(columns).toContain("content");
    expect(columns).toContain("embedding");
  });

  it("approvals table has expected columns", () => {
    const columns = Object.keys(approvals);
    expect(columns).toContain("id");
    expect(columns).toContain("taskId");
    expect(columns).toContain("requestedBy");
    expect(columns).toContain("status");
    expect(columns).toContain("reason");
  });
});
