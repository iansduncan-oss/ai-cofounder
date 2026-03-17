/**
 * Dashboard API contract tests.
 *
 * Validates that query hooks return the expected shapes from the API client.
 * Uses mocked apiClient to verify response structures match dashboard expectations.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/api/client", () => ({
  apiClient: {
    listGoals: vi.fn(),
    listTasks: vi.fn(),
    health: vi.fn(),
    listPendingApprovals: vi.fn(),
    getGoal: vi.fn(),
    getUsage: vi.fn(),
    getBudgetStatus: vi.fn(),
  },
}));

import { apiClient } from "@/api/client";
import {
  useGoals,
  useTasks,
  useHealth,
  usePendingApprovals,
  useGoal,
  useUsage,
  useBudgetStatus,
} from "@/api/queries";

const mockApiClient = vi.mocked(apiClient);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("Dashboard API Contracts", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("useGoals returns PaginatedResponse<Goal> shape", async () => {
    const mockGoal = {
      id: "g-1",
      conversationId: "c-1",
      title: "Test Goal",
      description: "A goal",
      status: "active",
      priority: "medium",
      metadata: null,
      milestoneId: null,
      createdBy: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    mockApiClient.listGoals.mockResolvedValue({
      data: [mockGoal],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const { result } = renderHook(() => useGoals("c-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = result.current.data!;
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
    expect(Array.isArray(body.data)).toBe(true);

    const goal = body.data[0];
    expect(goal).toHaveProperty("id");
    expect(goal).toHaveProperty("conversationId");
    expect(goal).toHaveProperty("title");
    expect(goal).toHaveProperty("status");
    expect(goal).toHaveProperty("createdAt");
  });

  it("useTasks returns PaginatedResponse<Task> shape with dependsOn", async () => {
    const mockTask = {
      id: "t-1",
      goalId: "g-1",
      title: "Test Task",
      description: "A task",
      status: "pending",
      assignedAgent: "coder",
      orderIndex: 0,
      input: null,
      output: null,
      error: null,
      dependsOn: ["t-0"],
      metadata: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    mockApiClient.listTasks.mockResolvedValue({
      data: [mockTask],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const { result } = renderHook(() => useTasks("g-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = result.current.data!;
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");

    const task = body.data[0];
    expect(task).toHaveProperty("id");
    expect(task).toHaveProperty("goalId");
    expect(task).toHaveProperty("title");
    expect(task).toHaveProperty("status");
    expect(task).toHaveProperty("dependsOn");
    expect(Array.isArray(task.dependsOn)).toBe(true);
  });

  it("useHealth returns HealthResponse shape", async () => {
    mockApiClient.health.mockResolvedValue({
      status: "ok",
      timestamp: "2025-01-01T00:00:00.000Z",
      uptime: 3600,
    });

    const { result } = renderHook(() => useHealth(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = result.current.data!;
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.status).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  it("usePendingApprovals returns approval array shape", async () => {
    const mockApproval = {
      id: "a-1",
      taskId: "t-1",
      requestedBy: "orchestrator",
      status: "pending",
      reason: "Review needed",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    mockApiClient.listPendingApprovals.mockResolvedValue([mockApproval]);

    const { result } = renderHook(() => usePendingApprovals(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const approvals = result.current.data!;
    expect(Array.isArray(approvals)).toBe(true);
    expect(approvals[0]).toHaveProperty("id");
    expect(approvals[0]).toHaveProperty("taskId");
    expect(approvals[0]).toHaveProperty("requestedBy");
    expect(approvals[0]).toHaveProperty("status");
    expect(approvals[0]).toHaveProperty("reason");
    expect(approvals[0]).toHaveProperty("createdAt");
  });

  it("useGoal returns single Goal shape", async () => {
    const mockGoal = {
      id: "g-1",
      conversationId: "c-1",
      title: "Single Goal",
      description: "Details",
      status: "active",
      priority: "high",
      metadata: null,
      milestoneId: null,
      createdBy: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    mockApiClient.getGoal.mockResolvedValue(mockGoal);

    const { result } = renderHook(() => useGoal("g-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const goal = result.current.data!;
    expect(goal).toHaveProperty("id");
    expect(goal).toHaveProperty("conversationId");
    expect(goal).toHaveProperty("title");
    expect(goal).toHaveProperty("status");
    expect(goal).toHaveProperty("priority");
    expect(goal).toHaveProperty("createdAt");
    expect(goal).toHaveProperty("updatedAt");
  });

  it("useUsage returns UsageSummary shape", async () => {
    const mockUsage = {
      totalInputTokens: 100000,
      totalOutputTokens: 50000,
      totalCostUsd: 2.5,
      requestCount: 42,
      period: "today",
      byProvider: { anthropic: { cost: 2.5, requests: 42 } },
      byModel: { "claude-sonnet-4-20250514": { cost: 2.5, requests: 42 } },
      byAgent: { orchestrator: { cost: 2.5, requests: 42 } },
    };
    mockApiClient.getUsage.mockResolvedValue(mockUsage);

    const { result } = renderHook(() => useUsage("today"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const usage = result.current.data!;
    expect(usage).toHaveProperty("totalInputTokens");
    expect(usage).toHaveProperty("totalOutputTokens");
    expect(usage).toHaveProperty("totalCostUsd");
    expect(usage).toHaveProperty("requestCount");
    expect(usage).toHaveProperty("byProvider");
    expect(usage).toHaveProperty("byModel");
    expect(typeof usage.totalCostUsd).toBe("number");
  });

  it("useBudgetStatus returns BudgetStatusResponse shape", async () => {
    const mockBudget = {
      dailyLimitUsd: 10,
      todaySpentUsd: 2.5,
      remainingUsd: 7.5,
      utilizationPct: 25,
      isOverBudget: false,
    };
    mockApiClient.getBudgetStatus.mockResolvedValue(mockBudget);

    const { result } = renderHook(() => useBudgetStatus(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const budget = result.current.data!;
    expect(budget).toHaveProperty("dailyLimitUsd");
    expect(budget).toHaveProperty("todaySpentUsd");
    expect(budget).toHaveProperty("remainingUsd");
    expect(budget).toHaveProperty("utilizationPct");
    expect(budget).toHaveProperty("isOverBudget");
    expect(typeof budget.isOverBudget).toBe("boolean");
  });
});
