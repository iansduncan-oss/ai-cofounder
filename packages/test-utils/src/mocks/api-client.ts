import { vi } from "vitest";

/**
 * Creates a mock ApiClient with all methods stubbed.
 * Pass overrides to customize specific methods for your test.
 *
 * Usage:
 * ```
 * const client = mockApiClient({
 *   runAgent: vi.fn().mockResolvedValue({ response: "hello" }),
 * });
 * ```
 */
export function mockApiClient(overrides: Record<string, unknown> = {}) {
  return {
    // Health
    health: vi.fn().mockResolvedValue({ status: "ok", timestamp: new Date().toISOString(), uptime: 100 }),
    providerHealth: vi.fn().mockResolvedValue({ status: "ok", providers: [] }),
    // Agent
    runAgent: vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      agentRole: "orchestrator",
      response: "Mock response",
      model: "test-model",
    }),
    // Goals
    createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal", status: "draft" }),
    getGoal: vi.fn().mockResolvedValue(null),
    listGoals: vi.fn().mockResolvedValue([]),
    updateGoalStatus: vi.fn().mockResolvedValue({}),
    // Tasks
    createTask: vi.fn().mockResolvedValue({ id: "task-1", title: "Test Task" }),
    getTask: vi.fn().mockResolvedValue(null),
    listTasks: vi.fn().mockResolvedValue([]),
    listPendingTasks: vi.fn().mockResolvedValue([]),
    assignTask: vi.fn().mockResolvedValue({}),
    startTask: vi.fn().mockResolvedValue({}),
    completeTask: vi.fn().mockResolvedValue({}),
    failTask: vi.fn().mockResolvedValue({}),
    // Execution
    executeGoal: vi.fn().mockResolvedValue({ goalId: "goal-1", status: "running", totalTasks: 0, completedTasks: 0, tasks: [] }),
    getProgress: vi.fn().mockResolvedValue({ goalId: "goal-1", status: "completed", totalTasks: 0, completedTasks: 0, tasks: [] }),
    // Approvals
    createApproval: vi.fn().mockResolvedValue({ id: "approval-1" }),
    getApproval: vi.fn().mockResolvedValue(null),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn().mockResolvedValue({}),
    // Memories
    listMemories: vi.fn().mockResolvedValue([]),
    deleteMemory: vi.fn().mockResolvedValue({ deleted: true }),
    // Channels
    getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
    setChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
    deleteChannelConversation: vi.fn().mockResolvedValue({ deleted: true }),
    // Users
    getUserByPlatform: vi.fn().mockResolvedValue({ id: "user-1" }),
    // Usage
    getUsage: vi.fn().mockResolvedValue({ period: "today", totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 }),
    ...overrides,
  };
}
