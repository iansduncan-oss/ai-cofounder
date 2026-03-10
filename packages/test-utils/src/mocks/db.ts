import { vi } from "vitest";

/**
 * Returns a comprehensive mock for vi.mock("@ai-cofounder/db") with sensible defaults.
 * All functions return empty/null defaults. Override specific ones in your test's beforeEach.
 *
 * Usage: `vi.mock("@ai-cofounder/db", () => mockDbModule())`
 */
export function mockDbModule() {
  return {
    // Client
    createDb: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    }),
    runMigrations: vi.fn().mockResolvedValue(undefined),
    // Users
    findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
    findUserByPlatform: vi.fn().mockResolvedValue(null),
    // Conversations
    createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
    getConversation: vi.fn().mockResolvedValue(null),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    getConversationMessageCount: vi.fn().mockResolvedValue(0),
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    // Channel conversations
    getChannelConversation: vi.fn().mockResolvedValue(null),
    upsertChannelConversation: vi.fn().mockResolvedValue({ channelId: "ch-1", conversationId: "conv-1" }),
    deleteChannelConversation: vi.fn().mockResolvedValue(undefined),
    // Goals
    createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal" }),
    getGoal: vi.fn().mockResolvedValue(null),
    listGoalsByConversation: vi.fn().mockResolvedValue([]),
    countGoalsByConversation: vi.fn().mockResolvedValue(0),
    listActiveGoals: vi.fn().mockResolvedValue([]),
    listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
    updateGoalStatus: vi.fn().mockResolvedValue({}),
    updateGoalMetadata: vi.fn().mockResolvedValue({}),
    // Tasks
    createTask: vi.fn().mockResolvedValue({ id: "task-1", title: "Test Task" }),
    getTask: vi.fn().mockResolvedValue(null),
    listTasksByGoal: vi.fn().mockResolvedValue([]),
    countTasksByGoal: vi.fn().mockResolvedValue(0),
    listPendingTasks: vi.fn().mockResolvedValue([]),
    countTasksByStatus: vi.fn().mockResolvedValue({}),
    assignTask: vi.fn().mockResolvedValue({}),
    startTask: vi.fn().mockResolvedValue({}),
    completeTask: vi.fn().mockResolvedValue({}),
    failTask: vi.fn().mockResolvedValue({}),
    // Approvals
    createApproval: vi.fn().mockResolvedValue({ id: "approval-1" }),
    getApproval: vi.fn().mockResolvedValue(null),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    listPendingApprovalsForTasks: vi.fn().mockResolvedValue([]),
    listApprovalsByTask: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn().mockResolvedValue({}),
    // Memories
    saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
    recallMemories: vi.fn().mockResolvedValue([]),
    searchMemoriesByVector: vi.fn().mockResolvedValue([]),
    listMemoriesByUser: vi.fn().mockResolvedValue([]),
    countMemoriesByUser: vi.fn().mockResolvedValue(0),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    computeImportance: vi.fn().mockReturnValue(0.5),
    touchMemory: vi.fn().mockResolvedValue(undefined),
    decayMemoryImportance: vi.fn().mockResolvedValue(undefined),
    decayAllMemoryImportance: vi.fn().mockResolvedValue(undefined),
    // Prompts
    getActivePrompt: vi.fn().mockResolvedValue(null),
    getPromptVersion: vi.fn().mockResolvedValue(null),
    listPromptVersions: vi.fn().mockResolvedValue([]),
    createPromptVersion: vi.fn().mockResolvedValue({ id: "p-1", name: "test", version: 1 }),
    // n8n
    getN8nWorkflow: vi.fn().mockResolvedValue(null),
    getN8nWorkflowByName: vi.fn().mockResolvedValue(null),
    listN8nWorkflows: vi.fn().mockResolvedValue([]),
    findN8nWorkflowByEvent: vi.fn().mockResolvedValue(null),
    createN8nWorkflow: vi.fn().mockResolvedValue({ id: "wf-1" }),
    updateN8nWorkflow: vi.fn().mockResolvedValue({}),
    deleteN8nWorkflow: vi.fn().mockResolvedValue(undefined),
    // Code executions
    saveCodeExecution: vi.fn().mockResolvedValue({ id: "ce-1" }),
    listCodeExecutionsByTask: vi.fn().mockResolvedValue([]),
    // LLM usage
    recordLlmUsage: vi.fn().mockResolvedValue(undefined),
    getTodayTokenTotal: vi.fn().mockResolvedValue(0),
    getTodayTokenUsage: vi.fn().mockResolvedValue(0),
    getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} }),
    // Schedules
    createSchedule: vi.fn().mockResolvedValue({ id: "sch-1" }),
    getSchedule: vi.fn().mockResolvedValue(null),
    listSchedules: vi.fn().mockResolvedValue([]),
    listEnabledSchedules: vi.fn().mockResolvedValue([]),
    listDueSchedules: vi.fn().mockResolvedValue([]),
    toggleSchedule: vi.fn().mockResolvedValue({}),
    updateScheduleEnabled: vi.fn().mockResolvedValue({}),
    updateScheduleLastRun: vi.fn().mockResolvedValue(undefined),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    // Events
    createEvent: vi.fn().mockResolvedValue({ id: "ev-1" }),
    listEvents: vi.fn().mockResolvedValue([]),
    countEvents: vi.fn().mockResolvedValue(0),
    markEventProcessed: vi.fn().mockResolvedValue(undefined),
    listUnprocessedEvents: vi.fn().mockResolvedValue([]),
    // Work sessions
    createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
    updateWorkSession: vi.fn().mockResolvedValue({}),
    completeWorkSession: vi.fn().mockResolvedValue(undefined),
    listRecentWorkSessions: vi.fn().mockResolvedValue([]),
    // Milestones
    createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Test Milestone" }),
    getMilestone: vi.fn().mockResolvedValue(null),
    listMilestonesByConversation: vi.fn().mockResolvedValue([]),
    updateMilestoneStatus: vi.fn().mockResolvedValue({}),
    getMilestoneProgress: vi.fn().mockResolvedValue({ total: 0, completed: 0 }),
    assignGoalToMilestone: vi.fn().mockResolvedValue({}),
    deleteMilestone: vi.fn().mockResolvedValue(undefined),
    // Conversation summaries
    saveConversationSummary: vi.fn().mockResolvedValue({ id: "cs-1" }),
    getLatestConversationSummary: vi.fn().mockResolvedValue(null),
    getRecentConversationSummaries: vi.fn().mockResolvedValue([]),
    getRecentSessionSummaries: vi.fn().mockResolvedValue([]),
    // Observability
    upsertProviderHealth: vi.fn().mockResolvedValue({}),
    getProviderHealthRecords: vi.fn().mockResolvedValue([]),
    getProviderHealthHistory: vi.fn().mockResolvedValue([]),
    recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
    getToolStats: vi.fn().mockResolvedValue([]),
    // Decisions
    listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    // User time
    getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
    // Personas
    getActivePersona: vi.fn().mockResolvedValue(null),
    listPersonas: vi.fn().mockResolvedValue([]),
    getPersona: vi.fn().mockResolvedValue(null),
    upsertPersona: vi.fn().mockResolvedValue({ id: "persona-1" }),
    deletePersona: vi.fn().mockResolvedValue(undefined),
    // RAG / Document chunks
    insertChunks: vi.fn().mockResolvedValue(undefined),
    searchChunksByVector: vi.fn().mockResolvedValue([]),
    deleteChunksBySource: vi.fn().mockResolvedValue(undefined),
    getChunkCount: vi.fn().mockResolvedValue(0),
    // Ingestion state
    upsertIngestionState: vi.fn().mockResolvedValue({}),
    getIngestionState: vi.fn().mockResolvedValue(null),
    listIngestionStates: vi.fn().mockResolvedValue([]),
    // Reflections
    insertReflection: vi.fn().mockResolvedValue({ id: "ref-1" }),
    getReflection: vi.fn().mockResolvedValue(null),
    listReflectionsByGoal: vi.fn().mockResolvedValue([]),
    listReflections: vi.fn().mockResolvedValue([]),
    getReflectionStats: vi.fn().mockResolvedValue({ total: 0 }),
    // Admin users
    findAdminByEmail: vi.fn().mockResolvedValue(null),
    createAdminUser: vi.fn().mockResolvedValue({ id: "admin-1" }),
    countAdminUsers: vi.fn().mockResolvedValue(0),
    // Subagent runs
    createSubagentRun: vi.fn().mockResolvedValue({ id: "sa-1" }),
    updateSubagentRunStatus: vi.fn().mockResolvedValue({}),
    getSubagentRun: vi.fn().mockResolvedValue(null),
    listSubagentRuns: vi.fn().mockResolvedValue([]),
    getSubagentRunsByParentRequest: vi.fn().mockResolvedValue([]),
    // Schema table references (used in some queries)
    goals: {},
    tasks: {},
    memories: {},
    users: {},
    conversations: {},
    messages: {},
    channelConversations: {},
    milestones: {},
    approvals: {},
    prompts: {},
    n8nWorkflows: {},
    schedules: {},
    events: {},
    workSessions: {},
    codeExecutions: {},
    llmUsage: {},
    conversationSummaries: {},
    providerHealth: {},
    toolExecutions: {},
    personas: {},
    documentChunks: {},
    ingestionState: {},
    reflections: {},
    adminUsers: {},
    subagentRuns: {},
    // Agent messages
    sendAgentMessage: vi.fn().mockResolvedValue({ id: "am-1" }),
    getAgentInbox: vi.fn().mockResolvedValue([]),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    getResponseToRequest: vi.fn().mockResolvedValue(null),
    getMessageThread: vi.fn().mockResolvedValue([]),
    markMessagesRead: vi.fn().mockResolvedValue(undefined),
    listAgentMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getAgentMessage: vi.fn().mockResolvedValue(null),
    getAgentMessageStats: vi.fn().mockResolvedValue([]),
    expireStaleMessages: vi.fn().mockResolvedValue(0),
    listGoalMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    agentMessages: {},
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
    listPendingApprovalsForTasks: vi.fn().mockResolvedValue([]),
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
    getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} }),
    createMilestone: vi.fn().mockResolvedValue({ id: "ms-1" }),
    getMilestone: vi.fn(),
    listMilestonesByConversation: vi.fn().mockResolvedValue([]),
    updateMilestoneStatus: vi.fn(),
    getMilestoneProgress: vi.fn().mockResolvedValue({ total: 0, completed: 0 }),
    assignGoalToMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    upsertProviderHealth: vi.fn(),
    getProviderHealthRecords: vi.fn().mockResolvedValue([]),
    recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
    getToolStats: vi.fn().mockResolvedValue([]),
    listDueSchedules: vi.fn().mockResolvedValue([]),
    listEnabledSchedules: vi.fn().mockResolvedValue([]),
    updateScheduleLastRun: vi.fn(),
    listEvents: vi.fn().mockResolvedValue([]),
    countEvents: vi.fn().mockResolvedValue(0),
    markEventProcessed: vi.fn(),
    listUnprocessedEvents: vi.fn().mockResolvedValue([]),
    createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
    completeWorkSession: vi.fn(),
    listRecentWorkSessions: vi.fn().mockResolvedValue([]),
    searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
    countTasksByStatus: vi.fn().mockResolvedValue({}),
    decayAllMemoryImportance: vi.fn(),
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
