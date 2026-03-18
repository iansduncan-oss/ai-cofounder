import { describe, it, expect } from "vitest";
import { classifyGoalScope, scopeRequiresApproval } from "../services/scope-classifier.js";

describe("proposed plan flow (integration logic)", () => {
  it("external tasks → proposed status (requiresApproval=true)", () => {
    const tasks = [
      { description: "Research competitors", assigned_agent: "researcher" },
      { description: "Draft and send the email to the team", assigned_agent: "planner" },
    ];
    const scope = classifyGoalScope(tasks);
    expect(scope).toBe("external");
    expect(scopeRequiresApproval(scope)).toBe(true);
  });

  it("read-only tasks → active status (requiresApproval=false)", () => {
    const tasks = [
      { description: "Research the API documentation", assigned_agent: "researcher" },
      { description: "Summarize the findings", assigned_agent: "planner" },
    ];
    const scope = classifyGoalScope(tasks);
    expect(scope).toBe("read_only");
    expect(scopeRequiresApproval(scope)).toBe(false);
  });

  it("LLM scope override to destructive is honored", () => {
    const tasks = [
      { description: "Update the config file", assigned_agent: "coder" },
    ];
    // Server: local (coder), LLM: destructive → destructive
    const scope = classifyGoalScope(tasks, "destructive");
    expect(scope).toBe("destructive");
    expect(scopeRequiresApproval(scope)).toBe(true);
  });
});
