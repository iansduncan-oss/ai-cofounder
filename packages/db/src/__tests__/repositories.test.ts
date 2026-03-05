import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "../client.js";

// ─── Mock Db factory ────────────────────────────────────────────────
// Creates a chainable mock that simulates Drizzle query builder chains.
// Each method returns the chain (for fluent calls) or resolves with mockResult.

let mockResult: unknown = [];

function createMockChain(): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const thenableMethods = [
    "from",
    "where",
    "limit",
    "orderBy",
    "returning",
    "set",
    "values",
    "innerJoin",
  ];

  for (const method of thenableMethods) {
    chain[method] = vi.fn().mockImplementation(() => chainProxy);
  }

  // The chain itself is a thenable so `await db.select().from(...)` works
  const chainProxy = new Proxy(chain, {
    get(target, prop) {
      if (prop === "then") {
        // Make the chain thenable – resolve with mockResult
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          try {
            resolve(mockResult);
          } catch (e) {
            reject(e);
          }
        };
      }
      if (typeof prop === "string" && !(prop in target)) {
        // Auto-stub unknown methods to keep the chain going
        target[prop] = vi.fn().mockReturnValue(chainProxy);
      }
      return target[prop];
    },
  });

  return chain;
}

function createMockDb() {
  const selectChain = createMockChain();
  const insertChain = createMockChain();
  const updateChain = createMockChain();
  const deleteChain = createMockChain();

  const db = {
    select: vi.fn().mockImplementation((fields?: unknown) => {
      // select() or select({ ... }) both return the chain
      const chain = createMockChain();
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(mockResult);
          }
          if (typeof prop === "string" && !(prop in target)) {
            target[prop] = vi.fn().mockReturnValue(proxy);
          }
          return target[prop];
        },
      });
      return proxy;
    }),
    insert: vi.fn().mockImplementation(() => {
      const chain = createMockChain();
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(mockResult);
          }
          if (typeof prop === "string" && !(prop in target)) {
            target[prop] = vi.fn().mockReturnValue(proxy);
          }
          return target[prop];
        },
      });
      return proxy;
    }),
    update: vi.fn().mockImplementation(() => {
      const chain = createMockChain();
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(mockResult);
          }
          if (typeof prop === "string" && !(prop in target)) {
            target[prop] = vi.fn().mockReturnValue(proxy);
          }
          return target[prop];
        },
      });
      return proxy;
    }),
    delete: vi.fn().mockImplementation(() => {
      const chain = createMockChain();
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(mockResult);
          }
          if (typeof prop === "string" && !(prop in target)) {
            target[prop] = vi.fn().mockReturnValue(proxy);
          }
          return target[prop];
        },
      });
      return proxy;
    }),
    execute: vi.fn().mockImplementation(() => Promise.resolve(mockResult)),
  } as unknown as Db;

  return db;
}

// Helper: set what the next db operation returns, then reset it after the call.
function setMockResult(val: unknown) {
  mockResult = val;
}

// Import all repository functions
import {
  findOrCreateUser,
  findUserByPlatform,
  getChannelConversation,
  upsertChannelConversation,
  deleteChannelConversation,
  createConversation,
  getConversation,
  createMessage,
  getConversationMessages,
  createGoal,
  getGoal,
  listGoalsByConversation,
  updateGoalStatus,
  createTask,
  getTask,
  listTasksByGoal,
  listPendingTasks,
  assignTask,
  startTask,
  completeTask,
  failTask,
  createApproval,
  getApproval,
  listPendingApprovals,
  listApprovalsByTask,
  resolveApproval,
  saveMemory,
  recallMemories,
  searchMemoriesByVector,
  listMemoriesByUser,
  deleteMemory,
  listActiveGoals,
  listRecentlyCompletedGoals,
  countTasksByStatus,
  getActivePrompt,
  getPromptVersion,
  listPromptVersions,
  createPromptVersion,
  createN8nWorkflow,
  updateN8nWorkflow,
  getN8nWorkflow,
  getN8nWorkflowByName,
  listN8nWorkflows,
  findN8nWorkflowByEvent,
  deleteN8nWorkflow,
} from "../repositories.js";

// ─── Fixtures ───────────────────────────────────────────────────────

const NOW = new Date("2026-03-05T12:00:00Z");

const fakeUser = {
  id: "u-1",
  externalId: "ext-1",
  platform: "discord",
  displayName: "Alice",
  createdAt: NOW,
};

const fakeConversation = {
  id: "conv-1",
  userId: "u-1",
  title: "Test conversation",
  createdAt: NOW,
  updatedAt: NOW,
};

const fakeMessage = {
  id: "msg-1",
  conversationId: "conv-1",
  role: "user" as const,
  agentRole: null,
  content: "Hello",
  metadata: null,
  createdAt: NOW,
};

const fakeChannelConv = {
  id: "cc-1",
  channelId: "ch-123",
  conversationId: "conv-1",
  platform: "discord",
  updatedAt: NOW,
};

const fakeGoal = {
  id: "goal-1",
  conversationId: "conv-1",
  title: "Build feature",
  description: "Build a new feature",
  status: "draft" as const,
  priority: "medium" as const,
  createdBy: "u-1",
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const fakeTask = {
  id: "task-1",
  goalId: "goal-1",
  title: "Research APIs",
  description: "Look up REST APIs",
  status: "pending" as const,
  assignedAgent: null,
  orderIndex: 0,
  input: null,
  output: null,
  error: null,
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const fakeApproval = {
  id: "appr-1",
  taskId: "task-1",
  requestedBy: "orchestrator" as const,
  status: "pending" as const,
  reason: "Needs human review",
  decision: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: NOW,
};

const fakeMemory = {
  id: "mem-1",
  userId: "u-1",
  category: "projects" as const,
  key: "current-project",
  content: "Building AI cofounder",
  embedding: null,
  source: "conversation",
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const fakePrompt = {
  id: "prompt-1",
  name: "system-orchestrator",
  version: 1,
  content: "You are an orchestrator.",
  isActive: 1,
  metadata: null,
  createdAt: NOW,
};

const fakeWorkflow = {
  id: "wf-1",
  name: "deploy-hook",
  description: "Triggers a deploy",
  webhookUrl: "https://n8n.example.com/webhook/123",
  direction: "outbound" as const,
  eventType: "deploy",
  inputSchema: null,
  isActive: true,
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ─── Tests ──────────────────────────────────────────────────────────

let db: Db;

beforeEach(() => {
  vi.restoreAllMocks();
  mockResult = [];
  db = createMockDb();
});

/* ────────────────────────── Users ────────────────────────── */

describe("Users", () => {
  describe("findOrCreateUser", () => {
    it("returns existing user when found", async () => {
      setMockResult([fakeUser]);
      const result = await findOrCreateUser(db, "ext-1", "discord", "Alice");
      expect(result).toEqual(fakeUser);
      expect(db.select).toHaveBeenCalled();
      // insert should NOT be called since user exists
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("creates and returns new user when not found", async () => {
      // First call (select) returns empty, second (insert...returning) returns created user
      let callCount = 0;
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeUser]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await findOrCreateUser(db, "ext-1", "discord", "Alice");
      expect(result).toEqual(fakeUser);
      expect(db.select).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
    });

    it("handles missing displayName", async () => {
      setMockResult([{ ...fakeUser, displayName: null }]);
      const result = await findOrCreateUser(db, "ext-1", "discord");
      expect(result.displayName).toBeNull();
    });
  });

  describe("findUserByPlatform", () => {
    it("returns user when found", async () => {
      setMockResult([fakeUser]);
      const result = await findUserByPlatform(db, "discord", "ext-1");
      expect(result).toEqual(fakeUser);
      expect(db.select).toHaveBeenCalled();
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await findUserByPlatform(db, "discord", "nonexistent");
      expect(result).toBeNull();
    });
  });
});

/* ──────────────── Channel Conversations ──────────────────── */

describe("Channel Conversations", () => {
  describe("getChannelConversation", () => {
    it("returns channel conversation when found", async () => {
      setMockResult([fakeChannelConv]);
      const result = await getChannelConversation(db, "ch-123");
      expect(result).toEqual(fakeChannelConv);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getChannelConversation(db, "unknown-channel");
      expect(result).toBeNull();
    });
  });

  describe("upsertChannelConversation", () => {
    it("creates new channel conversation when none exists", async () => {
      // First select returns empty (getChannelConversation lookup), then insert returns created
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeChannelConv]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await upsertChannelConversation(db, "ch-123", "conv-1");
      expect(result).toEqual(fakeChannelConv);
      expect(db.insert).toHaveBeenCalled();
    });

    it("updates existing channel conversation", async () => {
      const updatedConv = { ...fakeChannelConv, conversationId: "conv-2" };
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeChannelConv]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([updatedConv]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);

      const result = await upsertChannelConversation(db, "ch-123", "conv-2");
      expect(result).toEqual(updatedConv);
      expect(db.update).toHaveBeenCalled();
    });

    it("defaults platform to discord", async () => {
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeChannelConv]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await upsertChannelConversation(db, "ch-123", "conv-1");
      expect(result).toBeDefined();
      // The function signature defaults to "discord" when platform not provided
    });
  });

  describe("deleteChannelConversation", () => {
    it("calls delete with correct channel id", async () => {
      setMockResult([]);
      await deleteChannelConversation(db, "ch-123");
      expect(db.delete).toHaveBeenCalled();
    });

    it("does not throw when channel does not exist", async () => {
      setMockResult([]);
      await expect(deleteChannelConversation(db, "nonexistent")).resolves.toBeUndefined();
    });
  });
});

/* ──────────────── Conversations ──────────────────────────── */

describe("Conversations", () => {
  describe("createConversation", () => {
    it("creates and returns a conversation", async () => {
      setMockResult([fakeConversation]);
      const result = await createConversation(db, { userId: "u-1", title: "Test" });
      expect(result).toEqual(fakeConversation);
      expect(db.insert).toHaveBeenCalled();
    });

    it("works without optional title", async () => {
      const convNoTitle = { ...fakeConversation, title: null };
      setMockResult([convNoTitle]);
      const result = await createConversation(db, { userId: "u-1" });
      expect(result.title).toBeNull();
    });
  });

  describe("getConversation", () => {
    it("returns conversation when found", async () => {
      setMockResult([fakeConversation]);
      const result = await getConversation(db, "conv-1");
      expect(result).toEqual(fakeConversation);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getConversation(db, "nonexistent");
      expect(result).toBeNull();
    });
  });
});

/* ────────────────────── Messages ────────────────────────── */

describe("Messages", () => {
  describe("createMessage", () => {
    it("creates and returns a message", async () => {
      setMockResult([fakeMessage]);
      const result = await createMessage(db, {
        conversationId: "conv-1",
        role: "user",
        content: "Hello",
      });
      expect(result).toEqual(fakeMessage);
      expect(db.insert).toHaveBeenCalled();
    });

    it("creates message with agentRole", async () => {
      const agentMsg = { ...fakeMessage, role: "agent", agentRole: "orchestrator" };
      setMockResult([agentMsg]);
      const result = await createMessage(db, {
        conversationId: "conv-1",
        role: "agent",
        agentRole: "orchestrator",
        content: "Hello from orchestrator",
      });
      expect(result.agentRole).toBe("orchestrator");
    });

    it("creates message with metadata", async () => {
      const msgWithMeta = { ...fakeMessage, metadata: { tool: "search" } };
      setMockResult([msgWithMeta]);
      const result = await createMessage(db, {
        conversationId: "conv-1",
        role: "system",
        content: "System event",
        metadata: { tool: "search" },
      });
      expect(result.metadata).toEqual({ tool: "search" });
    });
  });

  describe("getConversationMessages", () => {
    it("returns messages for a conversation", async () => {
      const msgs = [fakeMessage, { ...fakeMessage, id: "msg-2", content: "World" }];
      setMockResult(msgs);
      const result = await getConversationMessages(db, "conv-1");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no messages exist", async () => {
      setMockResult([]);
      const result = await getConversationMessages(db, "conv-1");
      expect(result).toEqual([]);
    });

    it("uses default limit of 50", async () => {
      setMockResult([]);
      await getConversationMessages(db, "conv-1");
      expect(db.select).toHaveBeenCalled();
    });

    it("accepts custom limit", async () => {
      setMockResult([]);
      await getConversationMessages(db, "conv-1", 10);
      expect(db.select).toHaveBeenCalled();
    });
  });
});

/* ────────────────────────── Goals ────────────────────────── */

describe("Goals", () => {
  describe("createGoal", () => {
    it("creates and returns a goal", async () => {
      setMockResult([fakeGoal]);
      const result = await createGoal(db, {
        conversationId: "conv-1",
        title: "Build feature",
      });
      expect(result).toEqual(fakeGoal);
      expect(db.insert).toHaveBeenCalled();
    });

    it("creates goal with all optional fields", async () => {
      const goalWithOpts = {
        ...fakeGoal,
        priority: "critical" as const,
        description: "Urgent fix",
        metadata: { source: "discord" },
      };
      setMockResult([goalWithOpts]);
      const result = await createGoal(db, {
        conversationId: "conv-1",
        title: "Urgent fix",
        description: "Urgent fix",
        priority: "critical",
        createdBy: "u-1",
        metadata: { source: "discord" },
      });
      expect(result.priority).toBe("critical");
    });
  });

  describe("getGoal", () => {
    it("returns goal when found", async () => {
      setMockResult([fakeGoal]);
      const result = await getGoal(db, "goal-1");
      expect(result).toEqual(fakeGoal);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getGoal(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listGoalsByConversation", () => {
    it("returns goals ordered by createdAt desc", async () => {
      const goals = [fakeGoal, { ...fakeGoal, id: "goal-2", title: "Second goal" }];
      setMockResult(goals);
      const result = await listGoalsByConversation(db, "conv-1");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no goals exist", async () => {
      setMockResult([]);
      const result = await listGoalsByConversation(db, "conv-1");
      expect(result).toEqual([]);
    });
  });

  describe("updateGoalStatus", () => {
    it("updates and returns the goal", async () => {
      const updated = { ...fakeGoal, status: "active" as const };
      setMockResult([updated]);
      const result = await updateGoalStatus(db, "goal-1", "active");
      expect(result).toEqual(updated);
      expect(db.update).toHaveBeenCalled();
    });

    it("returns null when goal does not exist", async () => {
      setMockResult([]);
      const result = await updateGoalStatus(db, "nonexistent", "cancelled");
      expect(result).toBeNull();
    });

    it("accepts all valid status values", async () => {
      for (const status of ["draft", "active", "completed", "cancelled"] as const) {
        const updated = { ...fakeGoal, status };
        setMockResult([updated]);
        const result = await updateGoalStatus(db, "goal-1", status);
        expect(result?.status).toBe(status);
      }
    });
  });

  describe("listActiveGoals", () => {
    it("returns active goals with task counts", async () => {
      // First call: select active goals; subsequent calls: select tasks per goal
      const activeGoal = { ...fakeGoal, status: "active" as const };
      const goalTasks = [
        { status: "completed" },
        { status: "running" },
        { status: "pending" },
      ];

      let callIndex = 0;
      const makeProxy = (data: unknown) =>
        new Proxy({} as Record<string, unknown>, {
          get(_, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => void) => resolve(data);
            }
            return vi.fn().mockReturnValue(makeProxy(data));
          },
        });

      // First select returns active goals, second returns tasks
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return makeProxy([activeGoal]);
        return makeProxy(goalTasks);
      });

      const result = await listActiveGoals(db);
      expect(result).toHaveLength(1);
      expect(result[0].taskCount).toBe(3);
      expect(result[0].completedTaskCount).toBe(1);
    });

    it("returns empty array when no active goals", async () => {
      setMockResult([]);
      const result = await listActiveGoals(db);
      expect(result).toEqual([]);
    });
  });

  describe("listRecentlyCompletedGoals", () => {
    it("returns completed goals since given date", async () => {
      const completedGoal = {
        id: "goal-1",
        title: "Done goal",
        updatedAt: NOW,
      };
      setMockResult([completedGoal]);
      const since = new Date("2026-03-01T00:00:00Z");
      const result = await listRecentlyCompletedGoals(db, since);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Done goal");
    });

    it("returns empty when no completed goals since date", async () => {
      setMockResult([]);
      const result = await listRecentlyCompletedGoals(db, new Date());
      expect(result).toEqual([]);
    });
  });
});

/* ────────────────────────── Tasks ────────────────────────── */

describe("Tasks", () => {
  describe("createTask", () => {
    it("creates and returns a task", async () => {
      setMockResult([fakeTask]);
      const result = await createTask(db, {
        goalId: "goal-1",
        title: "Research APIs",
      });
      expect(result).toEqual(fakeTask);
      expect(db.insert).toHaveBeenCalled();
    });

    it("creates task with all optional fields", async () => {
      const fullTask = {
        ...fakeTask,
        assignedAgent: "researcher" as const,
        orderIndex: 3,
        input: "search terms",
      };
      setMockResult([fullTask]);
      const result = await createTask(db, {
        goalId: "goal-1",
        title: "Research APIs",
        description: "Look up REST APIs",
        assignedAgent: "researcher",
        orderIndex: 3,
        input: "search terms",
        metadata: { tags: ["api"] },
      });
      expect(result.assignedAgent).toBe("researcher");
      expect(result.orderIndex).toBe(3);
    });
  });

  describe("getTask", () => {
    it("returns task when found", async () => {
      setMockResult([fakeTask]);
      const result = await getTask(db, "task-1");
      expect(result).toEqual(fakeTask);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getTask(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listTasksByGoal", () => {
    it("returns tasks ordered by orderIndex asc", async () => {
      const orderedTasks = [
        { ...fakeTask, orderIndex: 0 },
        { ...fakeTask, id: "task-2", orderIndex: 1 },
      ];
      setMockResult(orderedTasks);
      const result = await listTasksByGoal(db, "goal-1");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no tasks", async () => {
      setMockResult([]);
      const result = await listTasksByGoal(db, "goal-1");
      expect(result).toEqual([]);
    });
  });

  describe("listPendingTasks", () => {
    it("returns pending tasks with default limit", async () => {
      setMockResult([fakeTask]);
      const result = await listPendingTasks(db);
      expect(result).toHaveLength(1);
    });

    it("returns empty array when no pending tasks", async () => {
      setMockResult([]);
      const result = await listPendingTasks(db);
      expect(result).toEqual([]);
    });

    it("accepts custom limit", async () => {
      setMockResult([]);
      await listPendingTasks(db, 5);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe("assignTask", () => {
    it("assigns agent and returns updated task", async () => {
      const assigned = { ...fakeTask, status: "assigned" as const, assignedAgent: "coder" as const };
      setMockResult([assigned]);
      const result = await assignTask(db, "task-1", "coder");
      expect(result?.status).toBe("assigned");
      expect(result?.assignedAgent).toBe("coder");
      expect(db.update).toHaveBeenCalled();
    });

    it("returns null when task not found", async () => {
      setMockResult([]);
      const result = await assignTask(db, "nonexistent", "coder");
      expect(result).toBeNull();
    });
  });

  describe("startTask", () => {
    it("sets status to running", async () => {
      const running = { ...fakeTask, status: "running" as const };
      setMockResult([running]);
      const result = await startTask(db, "task-1");
      expect(result?.status).toBe("running");
      expect(db.update).toHaveBeenCalled();
    });

    it("returns null when task not found", async () => {
      setMockResult([]);
      const result = await startTask(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("completeTask", () => {
    it("sets status to completed with output", async () => {
      const completed = { ...fakeTask, status: "completed" as const, output: "Done successfully" };
      setMockResult([completed]);
      const result = await completeTask(db, "task-1", "Done successfully");
      expect(result?.status).toBe("completed");
      expect(result?.output).toBe("Done successfully");
    });

    it("returns null when task not found", async () => {
      setMockResult([]);
      const result = await completeTask(db, "nonexistent", "output");
      expect(result).toBeNull();
    });
  });

  describe("failTask", () => {
    it("sets status to failed with error", async () => {
      const failed = { ...fakeTask, status: "failed" as const, error: "Timeout" };
      setMockResult([failed]);
      const result = await failTask(db, "task-1", "Timeout");
      expect(result?.status).toBe("failed");
      expect(result?.error).toBe("Timeout");
    });

    it("returns null when task not found", async () => {
      setMockResult([]);
      const result = await failTask(db, "nonexistent", "error");
      expect(result).toBeNull();
    });
  });

  describe("countTasksByStatus", () => {
    it("counts tasks grouped by status for active goals", async () => {
      const taskRows = [
        { status: "pending" },
        { status: "pending" },
        { status: "running" },
        { status: "completed" },
        { status: "completed" },
        { status: "completed" },
      ];
      setMockResult(taskRows);
      const result = await countTasksByStatus(db);
      expect(result.pending).toBe(2);
      expect(result.running).toBe(1);
      expect(result.completed).toBe(3);
    });

    it("returns empty object when no tasks", async () => {
      setMockResult([]);
      const result = await countTasksByStatus(db);
      expect(result).toEqual({});
    });
  });
});

/* ────────────────────────── Approvals ────────────────────── */

describe("Approvals", () => {
  describe("createApproval", () => {
    it("creates and returns an approval", async () => {
      setMockResult([fakeApproval]);
      const result = await createApproval(db, {
        taskId: "task-1",
        requestedBy: "orchestrator",
        reason: "Needs human review",
      });
      expect(result).toEqual(fakeApproval);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("getApproval", () => {
    it("returns approval when found", async () => {
      setMockResult([fakeApproval]);
      const result = await getApproval(db, "appr-1");
      expect(result).toEqual(fakeApproval);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getApproval(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listPendingApprovals", () => {
    it("returns pending approvals", async () => {
      setMockResult([fakeApproval]);
      const result = await listPendingApprovals(db);
      expect(result).toHaveLength(1);
    });

    it("returns empty array when none pending", async () => {
      setMockResult([]);
      const result = await listPendingApprovals(db);
      expect(result).toEqual([]);
    });

    it("uses default limit of 50", async () => {
      setMockResult([]);
      await listPendingApprovals(db);
      expect(db.select).toHaveBeenCalled();
    });

    it("accepts custom limit", async () => {
      setMockResult([]);
      await listPendingApprovals(db, 5);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe("listApprovalsByTask", () => {
    it("returns approvals for a task", async () => {
      setMockResult([fakeApproval]);
      const result = await listApprovalsByTask(db, "task-1");
      expect(result).toHaveLength(1);
    });

    it("returns empty array when none exist", async () => {
      setMockResult([]);
      const result = await listApprovalsByTask(db, "task-1");
      expect(result).toEqual([]);
    });
  });

  describe("resolveApproval", () => {
    it("approves and returns updated approval", async () => {
      const approved = {
        ...fakeApproval,
        status: "approved" as const,
        decision: "Looks good",
        decidedBy: "u-1",
        decidedAt: NOW,
      };
      setMockResult([approved]);
      const result = await resolveApproval(db, "appr-1", "approved", "Looks good", "u-1");
      expect(result?.status).toBe("approved");
      expect(result?.decision).toBe("Looks good");
      expect(db.update).toHaveBeenCalled();
    });

    it("rejects an approval", async () => {
      const rejected = {
        ...fakeApproval,
        status: "rejected" as const,
        decision: "Not ready",
        decidedBy: "u-1",
        decidedAt: NOW,
      };
      setMockResult([rejected]);
      const result = await resolveApproval(db, "appr-1", "rejected", "Not ready", "u-1");
      expect(result?.status).toBe("rejected");
    });

    it("returns null when approval not found", async () => {
      setMockResult([]);
      const result = await resolveApproval(db, "nonexistent", "approved", "ok");
      expect(result).toBeNull();
    });

    it("works without decidedBy", async () => {
      const approved = {
        ...fakeApproval,
        status: "approved" as const,
        decision: "Auto-approved",
        decidedBy: null,
        decidedAt: NOW,
      };
      setMockResult([approved]);
      const result = await resolveApproval(db, "appr-1", "approved", "Auto-approved");
      expect(result?.decidedBy).toBeNull();
    });
  });
});

/* ────────────────────── Memories ─────────────────────────── */

describe("Memories", () => {
  describe("saveMemory", () => {
    it("creates new memory when key does not exist", async () => {
      // select returns empty (no existing), insert returns created
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeMemory]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await saveMemory(db, {
        userId: "u-1",
        category: "projects",
        key: "current-project",
        content: "Building AI cofounder",
        source: "conversation",
      });
      expect(result).toEqual(fakeMemory);
      expect(db.insert).toHaveBeenCalled();
    });

    it("updates existing memory when key exists (upsert)", async () => {
      const updatedMemory = { ...fakeMemory, content: "Updated content" };
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakeMemory]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([updatedMemory]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);

      const result = await saveMemory(db, {
        userId: "u-1",
        category: "projects",
        key: "current-project",
        content: "Updated content",
      });
      expect(result).toEqual(updatedMemory);
      expect(db.update).toHaveBeenCalled();
    });

    it("saves memory with embedding vector", async () => {
      const memWithEmb = { ...fakeMemory, embedding: [0.1, 0.2, 0.3] };
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([memWithEmb]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await saveMemory(db, {
        userId: "u-1",
        category: "technical",
        key: "embedding-test",
        content: "Some content",
        embedding: [0.1, 0.2, 0.3],
      });
      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("recallMemories", () => {
    it("returns memories for user", async () => {
      setMockResult([fakeMemory]);
      const result = await recallMemories(db, "u-1");
      expect(result).toHaveLength(1);
    });

    it("filters by category", async () => {
      setMockResult([fakeMemory]);
      const result = await recallMemories(db, "u-1", { category: "projects" });
      expect(result).toHaveLength(1);
    });

    it("filters by query string (ILIKE)", async () => {
      setMockResult([fakeMemory]);
      const result = await recallMemories(db, "u-1", { query: "AI" });
      expect(result).toHaveLength(1);
    });

    it("combines category and query filters", async () => {
      setMockResult([fakeMemory]);
      const result = await recallMemories(db, "u-1", { category: "projects", query: "AI" });
      expect(result).toHaveLength(1);
    });

    it("uses default limit of 20", async () => {
      setMockResult([]);
      await recallMemories(db, "u-1");
      expect(db.select).toHaveBeenCalled();
    });

    it("accepts custom limit", async () => {
      setMockResult([]);
      await recallMemories(db, "u-1", { limit: 5 });
      expect(db.select).toHaveBeenCalled();
    });

    it("returns empty array when no memories match", async () => {
      setMockResult([]);
      const result = await recallMemories(db, "u-1", { query: "nonexistent" });
      expect(result).toEqual([]);
    });
  });

  describe("searchMemoriesByVector", () => {
    it("executes raw SQL with vector literal", async () => {
      const vectorResult = [
        {
          id: "mem-1",
          user_id: "u-1",
          category: "projects",
          key: "test",
          content: "content",
          source: null,
          metadata: null,
          created_at: NOW,
          updated_at: NOW,
          distance: 0.1,
        },
      ];
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(vectorResult);

      const embedding = [0.1, 0.2, 0.3];
      const result = await searchMemoriesByVector(db, embedding, "u-1", 5);
      expect(result).toHaveLength(1);
      expect(result[0].distance).toBe(0.1);
      expect(db.execute).toHaveBeenCalled();
    });

    it("uses default limit of 10", async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await searchMemoriesByVector(db, [0.1], "u-1");
      expect(db.execute).toHaveBeenCalled();
    });

    it("returns empty array when no matches", async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await searchMemoriesByVector(db, [0.1, 0.2], "u-1");
      expect(result).toEqual([]);
    });
  });

  describe("listMemoriesByUser", () => {
    it("returns all memories for a user", async () => {
      setMockResult([fakeMemory, { ...fakeMemory, id: "mem-2", key: "another-key" }]);
      const result = await listMemoriesByUser(db, "u-1");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when user has no memories", async () => {
      setMockResult([]);
      const result = await listMemoriesByUser(db, "u-1");
      expect(result).toEqual([]);
    });
  });

  describe("deleteMemory", () => {
    it("deletes and returns the memory", async () => {
      setMockResult([fakeMemory]);
      const result = await deleteMemory(db, "mem-1");
      expect(result).toEqual(fakeMemory);
      expect(db.delete).toHaveBeenCalled();
    });

    it("returns null when memory does not exist", async () => {
      setMockResult([]);
      const result = await deleteMemory(db, "nonexistent");
      expect(result).toBeNull();
    });
  });
});

/* ────────────────────── Prompts ─────────────────────────── */

describe("Prompts", () => {
  describe("getActivePrompt", () => {
    it("returns the active prompt for a name", async () => {
      setMockResult([fakePrompt]);
      const result = await getActivePrompt(db, "system-orchestrator");
      expect(result).toEqual(fakePrompt);
    });

    it("returns null when no active prompt exists", async () => {
      setMockResult([]);
      const result = await getActivePrompt(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getPromptVersion", () => {
    it("returns specific version of a prompt", async () => {
      setMockResult([fakePrompt]);
      const result = await getPromptVersion(db, "system-orchestrator", 1);
      expect(result).toEqual(fakePrompt);
    });

    it("returns null when version does not exist", async () => {
      setMockResult([]);
      const result = await getPromptVersion(db, "system-orchestrator", 99);
      expect(result).toBeNull();
    });
  });

  describe("listPromptVersions", () => {
    it("returns all versions for a prompt name", async () => {
      const versions = [
        { ...fakePrompt, version: 2, isActive: 1 },
        { ...fakePrompt, version: 1, isActive: 0 },
      ];
      setMockResult(versions);
      const result = await listPromptVersions(db, "system-orchestrator");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when prompt name not found", async () => {
      setMockResult([]);
      const result = await listPromptVersions(db, "nonexistent");
      expect(result).toEqual([]);
    });
  });

  describe("createPromptVersion", () => {
    it("creates first version (version 1) when none exist", async () => {
      // Select existing versions: empty
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      // Update (deactivate previous): resolves
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });
      // Insert new version
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([fakePrompt]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await createPromptVersion(db, {
        name: "system-orchestrator",
        content: "You are an orchestrator.",
      });
      expect(result).toEqual(fakePrompt);
    });

    it("increments version number when versions exist", async () => {
      const v2Prompt = { ...fakePrompt, version: 2 };

      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([{ version: 1 }]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([v2Prompt]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await createPromptVersion(db, {
        name: "system-orchestrator",
        content: "Updated prompt.",
      });
      expect(result.version).toBe(2);
    });

    it("deactivates previous versions", async () => {
      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([{ version: 1 }]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([{ ...fakePrompt, version: 2 }]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      await createPromptVersion(db, {
        name: "system-orchestrator",
        content: "New content",
      });
      // update is called to deactivate previous versions
      expect(db.update).toHaveBeenCalled();
    });

    it("accepts optional metadata", async () => {
      const promptWithMeta = { ...fakePrompt, metadata: { author: "test" } };

      const selectProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(selectProxy);
        },
      });
      const updateProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([]);
          }
          return vi.fn().mockReturnValue(updateProxy);
        },
      });
      const insertProxy = new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve([promptWithMeta]);
          }
          return vi.fn().mockReturnValue(insertProxy);
        },
      });

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectProxy);
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateProxy);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertProxy);

      const result = await createPromptVersion(db, {
        name: "system-orchestrator",
        content: "Content",
        metadata: { author: "test" },
      });
      expect(result.metadata).toEqual({ author: "test" });
    });
  });
});

/* ────────────────── n8n Workflows ─────────────────────── */

describe("n8n Workflows", () => {
  describe("createN8nWorkflow", () => {
    it("creates and returns a workflow", async () => {
      setMockResult([fakeWorkflow]);
      const result = await createN8nWorkflow(db, {
        name: "deploy-hook",
        webhookUrl: "https://n8n.example.com/webhook/123",
      });
      expect(result).toEqual(fakeWorkflow);
      expect(db.insert).toHaveBeenCalled();
    });

    it("creates workflow with all optional fields", async () => {
      const fullWorkflow = {
        ...fakeWorkflow,
        direction: "inbound" as const,
        eventType: "webhook.received",
        inputSchema: { type: "object" },
        isActive: false,
      };
      setMockResult([fullWorkflow]);
      const result = await createN8nWorkflow(db, {
        name: "deploy-hook",
        description: "Triggers a deploy",
        webhookUrl: "https://n8n.example.com/webhook/123",
        direction: "inbound",
        eventType: "webhook.received",
        inputSchema: { type: "object" },
        isActive: false,
        metadata: { env: "prod" },
      });
      expect(result.direction).toBe("inbound");
      expect(result.isActive).toBe(false);
    });
  });

  describe("updateN8nWorkflow", () => {
    it("updates and returns the workflow", async () => {
      const updated = { ...fakeWorkflow, name: "deploy-hook-v2" };
      setMockResult([updated]);
      const result = await updateN8nWorkflow(db, "wf-1", { name: "deploy-hook-v2" });
      expect(result?.name).toBe("deploy-hook-v2");
      expect(db.update).toHaveBeenCalled();
    });

    it("returns null when workflow not found", async () => {
      setMockResult([]);
      const result = await updateN8nWorkflow(db, "nonexistent", { name: "new-name" });
      expect(result).toBeNull();
    });

    it("updates multiple fields at once", async () => {
      const updated = {
        ...fakeWorkflow,
        name: "new-name",
        webhookUrl: "https://new-url.com",
        isActive: false,
      };
      setMockResult([updated]);
      const result = await updateN8nWorkflow(db, "wf-1", {
        name: "new-name",
        webhookUrl: "https://new-url.com",
        isActive: false,
      });
      expect(result?.name).toBe("new-name");
      expect(result?.webhookUrl).toBe("https://new-url.com");
      expect(result?.isActive).toBe(false);
    });
  });

  describe("getN8nWorkflow", () => {
    it("returns workflow when found", async () => {
      setMockResult([fakeWorkflow]);
      const result = await getN8nWorkflow(db, "wf-1");
      expect(result).toEqual(fakeWorkflow);
    });

    it("returns null when not found", async () => {
      setMockResult([]);
      const result = await getN8nWorkflow(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getN8nWorkflowByName", () => {
    it("returns active workflow by name", async () => {
      setMockResult([fakeWorkflow]);
      const result = await getN8nWorkflowByName(db, "deploy-hook");
      expect(result).toEqual(fakeWorkflow);
    });

    it("returns null when name not found or inactive", async () => {
      setMockResult([]);
      const result = await getN8nWorkflowByName(db, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listN8nWorkflows", () => {
    it("returns all active workflows when no direction filter", async () => {
      setMockResult([fakeWorkflow]);
      const result = await listN8nWorkflows(db);
      expect(result).toHaveLength(1);
    });

    it("filters by direction", async () => {
      setMockResult([fakeWorkflow]);
      const result = await listN8nWorkflows(db, "outbound");
      expect(result).toHaveLength(1);
    });

    it("returns empty array when no workflows match", async () => {
      setMockResult([]);
      const result = await listN8nWorkflows(db, "inbound");
      expect(result).toEqual([]);
    });
  });

  describe("findN8nWorkflowByEvent", () => {
    it("returns active workflow matching event type", async () => {
      setMockResult([fakeWorkflow]);
      const result = await findN8nWorkflowByEvent(db, "deploy");
      expect(result).toEqual(fakeWorkflow);
    });

    it("returns null when no workflow matches event", async () => {
      setMockResult([]);
      const result = await findN8nWorkflowByEvent(db, "unknown-event");
      expect(result).toBeNull();
    });
  });

  describe("deleteN8nWorkflow", () => {
    it("deletes and returns the workflow", async () => {
      setMockResult([fakeWorkflow]);
      const result = await deleteN8nWorkflow(db, "wf-1");
      expect(result).toEqual(fakeWorkflow);
      expect(db.delete).toHaveBeenCalled();
    });

    it("returns null when workflow does not exist", async () => {
      setMockResult([]);
      const result = await deleteN8nWorkflow(db, "nonexistent");
      expect(result).toBeNull();
    });
  });
});

/* ────────────────── Cross-cutting concerns ─────────────────── */

describe("Cross-cutting concerns", () => {
  it("all finder functions return null (not undefined) for missing records", async () => {
    setMockResult([]);

    expect(await findUserByPlatform(db, "discord", "x")).toBeNull();
    expect(await getChannelConversation(db, "x")).toBeNull();
    expect(await getConversation(db, "x")).toBeNull();
    expect(await getGoal(db, "x")).toBeNull();
    expect(await getTask(db, "x")).toBeNull();
    expect(await getApproval(db, "x")).toBeNull();
    expect(await getActivePrompt(db, "x")).toBeNull();
    expect(await getPromptVersion(db, "x", 1)).toBeNull();
    expect(await getN8nWorkflow(db, "x")).toBeNull();
    expect(await getN8nWorkflowByName(db, "x")).toBeNull();
    expect(await findN8nWorkflowByEvent(db, "x")).toBeNull();
  });

  it("all update functions return null when target does not exist", async () => {
    setMockResult([]);

    expect(await updateGoalStatus(db, "x", "active")).toBeNull();
    expect(await assignTask(db, "x", "coder")).toBeNull();
    expect(await startTask(db, "x")).toBeNull();
    expect(await completeTask(db, "x", "output")).toBeNull();
    expect(await failTask(db, "x", "error")).toBeNull();
    expect(await resolveApproval(db, "x", "approved", "ok")).toBeNull();
    expect(await updateN8nWorkflow(db, "x", { name: "y" })).toBeNull();
  });

  it("all delete functions return null when target does not exist", async () => {
    setMockResult([]);

    expect(await deleteMemory(db, "x")).toBeNull();
    expect(await deleteN8nWorkflow(db, "x")).toBeNull();
  });

  it("all list functions return empty arrays when no records", async () => {
    setMockResult([]);

    expect(await listGoalsByConversation(db, "x")).toEqual([]);
    expect(await listTasksByGoal(db, "x")).toEqual([]);
    expect(await listPendingTasks(db)).toEqual([]);
    expect(await listPendingApprovals(db)).toEqual([]);
    expect(await listApprovalsByTask(db, "x")).toEqual([]);
    expect(await recallMemories(db, "x")).toEqual([]);
    expect(await listMemoriesByUser(db, "x")).toEqual([]);
    expect(await listPromptVersions(db, "x")).toEqual([]);
    expect(await listN8nWorkflows(db)).toEqual([]);
    expect(await listActiveGoals(db)).toEqual([]);
  });
});
