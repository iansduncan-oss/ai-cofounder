import { vi } from "vitest";

/**
 * Returns a comprehensive mock for vi.mock("@ai-cofounder/db") with sensible defaults.
 * All functions return empty/null defaults. Override specific ones in your test's beforeEach.
 *
 * Usage: `vi.mock("@ai-cofounder/db", () => mockDbModule())`
 */
export function mockDbModule() {
  return {
    createDb: vi.fn().mockReturnValue({}),
    // Users
    findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
    findUserByPlatform: vi.fn().mockResolvedValue(null),
    // Conversations
    createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
    getConversation: vi.fn().mockResolvedValue(null),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    // Channel conversations
    getChannelConversation: vi.fn().mockResolvedValue(null),
    upsertChannelConversation: vi.fn().mockResolvedValue({ channelId: "ch-1", conversationId: "conv-1" }),
    deleteChannelConversation: vi.fn().mockResolvedValue(undefined),
    // Goals
    createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal" }),
    getGoal: vi.fn().mockResolvedValue(null),
    listGoalsByConversation: vi.fn().mockResolvedValue([]),
    listActiveGoals: vi.fn().mockResolvedValue([]),
    updateGoalStatus: vi.fn().mockResolvedValue({}),
    // Tasks
    createTask: vi.fn().mockResolvedValue({ id: "task-1", title: "Test Task" }),
    getTask: vi.fn().mockResolvedValue(null),
    listTasksByGoal: vi.fn().mockResolvedValue([]),
    listPendingTasks: vi.fn().mockResolvedValue([]),
    assignTask: vi.fn().mockResolvedValue({}),
    startTask: vi.fn().mockResolvedValue({}),
    completeTask: vi.fn().mockResolvedValue({}),
    failTask: vi.fn().mockResolvedValue({}),
    // Approvals
    createApproval: vi.fn().mockResolvedValue({ id: "approval-1" }),
    getApproval: vi.fn().mockResolvedValue(null),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    listApprovalsByTask: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn().mockResolvedValue({}),
    // Memories
    saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
    recallMemories: vi.fn().mockResolvedValue([]),
    searchMemoriesByVector: vi.fn().mockResolvedValue([]),
    listMemoriesByUser: vi.fn().mockResolvedValue([]),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    touchMemory: vi.fn().mockResolvedValue(undefined),
    decayAllMemoryImportance: vi.fn().mockResolvedValue(undefined),
    // Prompts
    getActivePrompt: vi.fn().mockResolvedValue(null),
    getPromptVersion: vi.fn().mockResolvedValue(null),
    listPromptVersions: vi.fn().mockResolvedValue([]),
    createPromptVersion: vi.fn().mockResolvedValue({ id: "p-1", name: "test", version: 1 }),
    // n8n
    getN8nWorkflowByName: vi.fn().mockResolvedValue(null),
    listN8nWorkflows: vi.fn().mockResolvedValue([]),
    createN8nWorkflow: vi.fn().mockResolvedValue({ id: "wf-1" }),
    updateN8nWorkflow: vi.fn().mockResolvedValue({}),
    deleteN8nWorkflow: vi.fn().mockResolvedValue(undefined),
    // Schedules
    createSchedule: vi.fn().mockResolvedValue({ id: "sch-1" }),
    getSchedule: vi.fn().mockResolvedValue(null),
    listSchedules: vi.fn().mockResolvedValue([]),
    updateScheduleEnabled: vi.fn().mockResolvedValue({}),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    // Events
    createEvent: vi.fn().mockResolvedValue({ id: "ev-1" }),
    // Work sessions
    createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
    updateWorkSession: vi.fn().mockResolvedValue({}),
    // LLM usage
    recordLlmUsage: vi.fn().mockResolvedValue(undefined),
    getTodayTokenUsage: vi.fn().mockResolvedValue(0),
    // Milestones
    createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Test Milestone" }),
    getMilestone: vi.fn().mockResolvedValue(null),
    listMilestonesByConversation: vi.fn().mockResolvedValue([]),
    updateMilestoneStatus: vi.fn().mockResolvedValue({}),
    getMilestoneProgress: vi.fn().mockResolvedValue({ total: 0, completed: 0 }),
    assignGoalToMilestone: vi.fn().mockResolvedValue({}),
    deleteMilestone: vi.fn().mockResolvedValue(undefined),
    // Schema table references (used in some queries)
    goals: {},
    channelConversations: {},
    prompts: {},
    tasks: {},
    memories: {},
  };
}

/**
 * Creates controllable db mocks with external vi.fn() references.
 * Returns both the mock fns (for test assertions) and the module factory.
 *
 * Usage:
 * ```
 * const { mocks, moduleFactory } = createControllableDbMocks();
 * vi.mock("@ai-cofounder/db", moduleFactory);
 * // In test: mocks.createGoal.mockResolvedValueOnce(...)
 * ```
 */
export function createControllableDbMocks() {
  const mocks = {
    createDb: vi.fn().mockReturnValue({}),
    findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
    getConversation: vi.fn(),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal" }),
    getGoal: vi.fn(),
    listGoalsByConversation: vi.fn().mockResolvedValue([]),
    listActiveGoals: vi.fn().mockResolvedValue([]),
    updateGoalStatus: vi.fn().mockResolvedValue({}),
    createTask: vi.fn().mockResolvedValue({ id: "task-1" }),
    getTask: vi.fn(),
    listTasksByGoal: vi.fn().mockResolvedValue([]),
    listPendingTasks: vi.fn().mockResolvedValue([]),
    assignTask: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn().mockResolvedValue({}),
    failTask: vi.fn().mockResolvedValue({}),
    createApproval: vi.fn().mockResolvedValue({ id: "approval-1" }),
    getApproval: vi.fn(),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    listApprovalsByTask: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn(),
    saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
    recallMemories: vi.fn().mockResolvedValue([]),
    searchMemoriesByVector: vi.fn().mockResolvedValue([]),
    listMemoriesByUser: vi.fn().mockResolvedValue([]),
    deleteMemory: vi.fn(),
    touchMemory: vi.fn(),
    getActivePrompt: vi.fn().mockResolvedValue(null),
    getChannelConversation: vi.fn(),
    upsertChannelConversation: vi.fn(),
    deleteChannelConversation: vi.fn(),
    findUserByPlatform: vi.fn().mockResolvedValue(null),
    getN8nWorkflowByName: vi.fn(),
    listN8nWorkflows: vi.fn().mockResolvedValue([]),
    recordLlmUsage: vi.fn(),
    getTodayTokenUsage: vi.fn().mockResolvedValue(0),
    createMilestone: vi.fn().mockResolvedValue({ id: "ms-1" }),
    getMilestone: vi.fn(),
    listMilestonesByConversation: vi.fn().mockResolvedValue([]),
    updateMilestoneStatus: vi.fn(),
    getMilestoneProgress: vi.fn().mockResolvedValue({ total: 0, completed: 0 }),
    assignGoalToMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    goals: {},
    channelConversations: {},
    prompts: {},
    tasks: {},
    memories: {},
  };

  const moduleFactory = () => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mocks)) {
      if (typeof value === "function") {
        result[key] = (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  return { mocks, moduleFactory };
}
