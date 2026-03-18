import { describe, it, expect } from "vitest";
import { classifyGoalScope, scopeRequiresApproval, maxScope } from "../services/scope-classifier.js";
import type { GoalScope } from "@ai-cofounder/shared";

describe("scope-classifier", () => {
  describe("classifyGoalScope", () => {
    it("returns read_only for research-only tasks", () => {
      const tasks = [
        { description: "Research the current market trends", assigned_agent: "researcher" },
        { description: "Summarize findings into a report", assigned_agent: "planner" },
      ];
      expect(classifyGoalScope(tasks)).toBe("read_only");
    });

    it("returns local for coder tasks", () => {
      const tasks = [
        { description: "Implement the new button component", assigned_agent: "coder" },
      ];
      expect(classifyGoalScope(tasks)).toBe("local");
    });

    it("returns local for debugger tasks", () => {
      const tasks = [
        { description: "Fix the null pointer bug", assigned_agent: "debugger" },
      ];
      expect(classifyGoalScope(tasks)).toBe("local");
    });

    it("returns external for tasks with email keywords", () => {
      const tasks = [
        { description: "Send an email to the client with the report", assigned_agent: "planner" },
      ];
      expect(classifyGoalScope(tasks)).toBe("external");
    });

    it("returns external for tasks with deploy keywords", () => {
      const tasks = [
        { description: "Deploy the new version to production", assigned_agent: "coder" },
      ];
      expect(classifyGoalScope(tasks)).toBe("external");
    });

    it("returns destructive for tasks with delete keywords", () => {
      const tasks = [
        { description: "Delete the old user accounts from the database", assigned_agent: "coder" },
      ];
      expect(classifyGoalScope(tasks)).toBe("destructive");
    });

    it("returns destructive for drop table keywords", () => {
      const tasks = [
        { description: "Drop the legacy sessions table", assigned_agent: "coder" },
      ];
      expect(classifyGoalScope(tasks)).toBe("destructive");
    });

    it("takes the MAX of server and LLM scope", () => {
      const tasks = [
        { description: "Write the unit tests", assigned_agent: "coder" },
      ];
      // Server classifies as "local" (coder), LLM says "external" → external wins
      expect(classifyGoalScope(tasks, "external")).toBe("external");
    });

    it("LLM cannot downgrade server scope", () => {
      const tasks = [
        { description: "Delete all old logs", assigned_agent: "coder" },
      ];
      // Server: destructive, LLM: read_only → destructive wins
      expect(classifyGoalScope(tasks, "read_only")).toBe("destructive");
    });

    it("returns highest scope across all tasks", () => {
      const tasks = [
        { description: "Research the API docs", assigned_agent: "researcher" },
        { description: "Write the integration code", assigned_agent: "coder" },
        { description: "Push the changes to the remote", assigned_agent: "coder" },
      ];
      // "push" is external, coder is local → external wins
      expect(classifyGoalScope(tasks)).toBe("external");
    });
  });

  describe("scopeRequiresApproval", () => {
    it("returns false for read_only", () => {
      expect(scopeRequiresApproval("read_only")).toBe(false);
    });

    it("returns false for local", () => {
      expect(scopeRequiresApproval("local")).toBe(false);
    });

    it("returns true for external", () => {
      expect(scopeRequiresApproval("external")).toBe(true);
    });

    it("returns true for destructive", () => {
      expect(scopeRequiresApproval("destructive")).toBe(true);
    });
  });

  describe("maxScope", () => {
    it("returns the higher scope", () => {
      expect(maxScope("read_only", "local")).toBe("local");
      expect(maxScope("local", "external")).toBe("external");
      expect(maxScope("external", "destructive")).toBe("destructive");
      expect(maxScope("destructive", "read_only")).toBe("destructive");
    });

    it("returns same when equal", () => {
      const scopes: GoalScope[] = ["read_only", "local", "external", "destructive"];
      for (const s of scopes) {
        expect(maxScope(s, s)).toBe(s);
      }
    });
  });
});
