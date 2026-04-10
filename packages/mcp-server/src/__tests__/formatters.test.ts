import { describe, it, expect } from "vitest";
import {
  formatDashboard,
  formatMonitoring,
  formatQueues,
  formatGoals,
  formatBriefing,
  formatSubagentRun,
  formatApprovals,
  formatBudgetStatus,
  formatErrorSummary,
  formatConversations,
  formatSearchResults,
  formatFollowUps,
  formatGoalAnalytics,
  formatGoalCost,
  formatDeployments,
  formatCircuitBreaker,
  formatToolStats,
  formatReflections,
  formatJournalEntries,
} from "../formatters.js";

describe("MCP formatters", () => {
  describe("formatDashboard", () => {
    it("formats a full dashboard summary", () => {
      const result = formatDashboard({
        goals: {
          activeCount: 3,
          recent: [
            { title: "Build MVP", status: "active", completedTaskCount: 2, taskCount: 5 } as any,
          ],
        },
        tasks: { pendingCount: 1, runningCount: 2, completedCount: 10, failedCount: 0 },
        costs: { today: 0.1234, week: 1.5, month: 5.25 },
      } as any);

      expect(result).toContain("# Dashboard Summary");
      expect(result).toContain("Goals: 3 active");
      expect(result).toContain("Build MVP [active] (2/5 tasks)");
      expect(result).toContain("Pending: 1");
      expect(result).toContain("Today: $0.1234");
    });

    it("handles empty goals", () => {
      const result = formatDashboard({
        goals: { activeCount: 0, recent: [] },
        tasks: { pendingCount: 0, runningCount: 0, completedCount: 0, failedCount: 0 },
        costs: { today: 0, week: 0, month: 0 },
      } as any);

      expect(result).toContain("Goals: 0 active");
    });
  });

  describe("formatMonitoring", () => {
    it("formats full monitoring report", () => {
      const result = formatMonitoring({
        github: {
          ciStatus: [{ repo: "ai-cofounder", branch: "main", status: "completed", conclusion: "success" }],
          openPRs: [{ number: 1, title: "Fix bug", author: "alice" }],
        },
        vps: {
          cpuLoadAvg: [0.5, 0.3, 0.2],
          memoryUsagePercent: 45.5,
          diskUsagePercent: 60.0,
          uptime: "10 days",
          containers: [{ name: "agent-server", status: "running", health: "healthy" }],
        },
        alerts: [{ severity: "warning", source: "disk", message: "80% full" }],
      } as any);

      expect(result).toContain("# Monitoring Report");
      expect(result).toContain("ai-cofounder/main: completed (success)");
      expect(result).toContain("#1 Fix bug by alice");
      expect(result).toContain("Memory: 45.5%");
      expect(result).toContain("agent-server: running (healthy)");
      expect(result).toContain("[warning] disk: 80% full");
    });

    it("handles missing sections", () => {
      const result = formatMonitoring({ alerts: [] } as any);
      expect(result).toContain("# Monitoring Report");
      expect(result).not.toContain("GitHub");
      expect(result).not.toContain("VPS");
    });
  });

  describe("formatQueues", () => {
    it("formats queue status", () => {
      const result = formatQueues({
        queues: [{ name: "agent-tasks", waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 }],
      });
      expect(result).toContain("agent-tasks");
      expect(result).toContain("Waiting: 5");
      expect(result).toContain("Failed: 3");
    });
  });

  describe("formatGoals", () => {
    it("formats goal list", () => {
      const result = formatGoals({
        data: [{ id: "g-1", title: "Build API", status: "active", priority: "high", description: "REST API" } as any],
        total: 1,
      });
      expect(result).toContain("**Build API** [active/high]");
      expect(result).toContain("REST API");
    });

    it("returns message for empty list", () => {
      expect(formatGoals({ data: [], total: 0 })).toBe("No goals found.");
    });
  });

  describe("formatBriefing", () => {
    it("formats briefing", () => {
      expect(formatBriefing({ briefing: "Good morning!" } as any)).toContain("Good morning!");
    });

    it("handles missing briefing", () => {
      expect(formatBriefing({} as any)).toBe("No briefing available.");
    });
  });

  describe("formatApprovals", () => {
    it("formats pending approvals", () => {
      const result = formatApprovals([
        { id: "a-1", taskId: "t-1", requestedBy: "orchestrator", reason: "needs review" } as any,
      ]);
      expect(result).toContain("Pending Approvals (1)");
      expect(result).toContain("needs review");
    });

    it("returns message for empty list", () => {
      expect(formatApprovals([])).toBe("No pending approvals.");
    });
  });

  describe("formatBudgetStatus", () => {
    it("formats budget with suggestions", () => {
      const result = formatBudgetStatus({
        daily: { spentUsd: 1.5, limitUsd: 10, percentUsed: 15 },
        weekly: { spentUsd: 5, limitUsd: 50, percentUsed: 10 },
        optimizationSuggestions: ["Use Groq for simple tasks"],
      } as any);
      expect(result).toContain("Spent: $1.5000");
      expect(result).toContain("Used: 15.0%");
      expect(result).toContain("Use Groq for simple tasks");
    });
  });

  describe("formatErrorSummary", () => {
    it("formats errors", () => {
      const result = formatErrorSummary({
        timestamp: "2024-01-01",
        hours: 24,
        totalErrors: 5,
        errors: [{ toolName: "search_web", errorMessage: "timeout", count: 3, lastSeen: "2024-01-01" }],
      });
      expect(result).toContain("5 errors in past 24h");
      expect(result).toContain("**search_web** (x3)");
    });

    it("returns message when no errors", () => {
      const result = formatErrorSummary({ timestamp: "", hours: 24, totalErrors: 0, errors: [] });
      expect(result).toBe("No errors in the past 24 hours.");
    });
  });

  describe("formatSearchResults", () => {
    it("formats results across categories", () => {
      const result = formatSearchResults({
        goals: [{ id: "g-1", title: "Build API", status: "active" } as any],
        tasks: [],
        conversations: [{ id: "c-1", title: "Chat 1" } as any],
        memories: [],
      });
      expect(result).toContain("Search Results (2)");
      expect(result).toContain("## Goals (1)");
      expect(result).toContain("## Conversations (1)");
    });

    it("returns message for no results", () => {
      expect(formatSearchResults({ goals: [], tasks: [], conversations: [], memories: [] })).toBe(
        "No search results found.",
      );
    });
  });

  describe("formatSubagentRun", () => {
    it("formats a complete subagent run", () => {
      const result = formatSubagentRun({
        id: "sa-1",
        title: "Research competitors",
        status: "completed",
        instruction: "Find top 5 competitors",
        model: "claude-sonnet",
        provider: "anthropic",
        toolRounds: 2,
        toolsUsed: ["search_web", "browse_web"],
        tokens: 1500,
        durationMs: 5000,
        output: "Found 5 competitors...",
      } as any);
      expect(result).toContain("# Subagent: Research competitors");
      expect(result).toContain("Tool Rounds**: 2");
      expect(result).toContain("Duration**: 5.0s");
      expect(result).toContain("Found 5 competitors");
    });
  });

  describe("formatGoalCost", () => {
    it("formats cost summary", () => {
      const result = formatGoalCost({
        totalCostUsd: 0.0567,
        totalInputTokens: 10000,
        totalOutputTokens: 2000,
        requestCount: 5,
      });
      expect(result).toContain("$0.0567");
      expect(result).toContain("10,000");
      expect(result).toContain("Requests: 5");
    });
  });

  describe("formatCircuitBreaker", () => {
    it("formats active circuit breaker", () => {
      const result = formatCircuitBreaker({ isPaused: false, failureCount: 0 } as any);
      expect(result).toContain("Status: Active");
    });

    it("formats paused circuit breaker", () => {
      const result = formatCircuitBreaker({
        isPaused: true,
        failureCount: 3,
        pausedAt: "2024-01-01",
        pausedReason: "3 consecutive failures",
      } as any);
      expect(result).toContain("Status: PAUSED");
      expect(result).toContain("Failures: 3");
      expect(result).toContain("3 consecutive failures");
    });
  });

  describe("formatToolStats", () => {
    it("formats tool statistics", () => {
      const result = formatToolStats({
        timestamp: "2024-01-01",
        tools: [{ toolName: "search_web", totalExecutions: 100, successCount: 95, avgDurationMs: 1500 }],
      } as any);
      expect(result).toContain("**search_web**: 95.0% success, 1500ms avg, 100 calls");
    });

    it("handles empty tools", () => {
      expect(formatToolStats({ timestamp: "", tools: [] })).toBe("No tool stats available.");
    });
  });

  describe("formatFollowUps", () => {
    it("formats follow-ups with due dates", () => {
      const result = formatFollowUps({
        data: [{ id: "fu-1", title: "Review PR", status: "pending", dueDate: "2024-01-15", description: "Check tests" } as any],
        total: 1,
      });
      expect(result).toContain("[pending] **Review PR** — due 2024-01-15");
      expect(result).toContain("Check tests");
    });

    it("handles empty list", () => {
      expect(formatFollowUps({ data: [], total: 0 })).toBe("No follow-ups found.");
    });
  });

  describe("formatDeployments", () => {
    it("formats deployment list", () => {
      const result = formatDeployments({
        data: [{ shortSha: "abc1234", status: "success", branch: "main", triggeredBy: "ci" } as any],
        total: 1,
      });
      expect(result).toContain("**abc1234** [success] main — by ci");
    });

    it("handles empty list", () => {
      expect(formatDeployments({ data: [], total: 0 })).toBe("No deployments found.");
    });
  });

  describe("formatConversations", () => {
    it("formats conversation list", () => {
      const result = formatConversations({
        data: [{ id: "c-1", title: "API Discussion", createdAt: "2024-01-01" } as any],
        total: 1,
      });
      expect(result).toContain("**API Discussion**");
    });

    it("handles untitled conversations", () => {
      const result = formatConversations({
        data: [{ id: "c-1", createdAt: "2024-01-01" } as any],
        total: 1,
      });
      expect(result).toContain("**Untitled**");
    });

    it("handles empty list", () => {
      expect(formatConversations({ data: [], total: 0 })).toBe("No conversations found.");
    });
  });

  describe("formatGoalAnalytics", () => {
    it("formats analytics with agent stats", () => {
      const result = formatGoalAnalytics({
        totalGoals: 10,
        completionRate: 80,
        avgCompletionHours: 2.5,
        taskSuccessRate: 90,
        totalTasks: 50,
        byStatus: { active: 2, completed: 8 },
        byPriority: { high: 3, medium: 7 },
        tasksByAgent: [{ agent: "coder", completed: 20, total: 25, failed: 2 }],
      } as any);
      expect(result).toContain("Total Goals: 10");
      expect(result).toContain("Completion Rate: 80.0%");
      expect(result).toContain("Avg Completion: 2.5h");
      expect(result).toContain("**coder**: 20/25 completed, 2 failed");
    });
  });

  describe("formatReflections", () => {
    it("formats reflections with lessons", () => {
      const result = formatReflections({
        data: [{
          reflectionType: "post_goal",
          content: "The API integration went well but needed more error handling",
          lessons: [{ lesson: "Always add retry logic" }],
        } as any],
        total: 1,
      });
      expect(result).toContain("[post_goal]");
      expect(result).toContain("Always add retry logic");
    });

    it("handles empty list", () => {
      expect(formatReflections({ data: [], total: 0 })).toBe("No reflections found.");
    });
  });

  describe("formatJournalEntries", () => {
    it("formats journal entries", () => {
      const result = formatJournalEntries({
        data: [{
          entryType: "work_session",
          title: "Morning session",
          occurredAt: "2024-01-01",
          summary: "Completed 3 tasks",
        } as any],
        total: 1,
      });
      expect(result).toContain("[work_session] **Morning session**");
      expect(result).toContain("Completed 3 tasks");
    });

    it("handles empty list", () => {
      expect(formatJournalEntries({ data: [], total: 0 })).toBe("No journal entries found.");
    });
  });
});
