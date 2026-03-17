/**
 * Integration tests: Goal & Task lifecycle against a real PostgreSQL database.
 *
 * Exercises create, read, update, and clone operations via app.inject().
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import {
  shouldSkip,
  buildIntegrationServer,
  seedUserAndConversation,
  createTestSql,
  truncateAll,
} from "./helpers.js";

describe.skipIf(shouldSkip())("Goal Lifecycle (integration)", () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    app = await buildIntegrationServer();
    sql = createTestSql();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  beforeEach(async () => {
    await truncateAll(sql);
    const seed = await seedUserAndConversation(app);
    userId = seed.userId;
    conversationId = seed.conversationId;
  });

  it("creates a goal and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: {
        conversationId,
        title: "Test Goal",
        description: "A test goal",
        priority: "high",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Test Goal");
    expect(body.description).toBe("A test goal");
    expect(body.priority).toBe("high");
    expect(body.status).toBe("draft");
    expect(body.conversationId).toBe(conversationId);
  });

  it("gets a goal by ID", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Fetch Me" },
    });
    const goalId = createRes.json().id;

    const getRes = await app.inject({
      method: "GET",
      url: `/api/goals/${goalId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().title).toBe("Fetch Me");
  });

  it("lists goals for a conversation with pagination", async () => {
    // Create 3 goals
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: { conversationId, title: `Goal ${i}` },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/goals?conversationId=${conversationId}&limit=2&offset=0`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it("updates goal status", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Status Test" },
    });
    const goalId = createRes.json().id;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/goals/${goalId}/status`,
      payload: { status: "active" },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().status).toBe("active");
  });

  it("creates a task linked to a goal", async () => {
    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Task Parent" },
    });
    const goalId = goalRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        goalId,
        title: "First Task",
        description: "Do something",
        assignedAgent: "coder",
        orderIndex: 0,
      },
    });

    expect(taskRes.statusCode).toBe(201);
    const task = taskRes.json();
    expect(task.goalId).toBe(goalId);
    expect(task.title).toBe("First Task");
    expect(task.assignedAgent).toBe("coder");
    expect(task.status).toBe("pending");
  });

  it("task lifecycle: start → complete", async () => {
    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Lifecycle Test" },
    });
    const goalId = goalRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Lifecycle Task" },
    });
    const taskId = taskRes.json().id;

    // Start
    const startRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/start`,
    });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().status).toBe("running");

    // Complete
    const completeRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/complete`,
      payload: { result: "Done!" },
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.json().status).toBe("completed");
    expect(completeRes.json().output).toBe("Done!");
  });

  it("task lifecycle: start → fail", async () => {
    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Fail Test" },
    });
    const goalId = goalRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Will Fail" },
    });
    const taskId = taskRes.json().id;

    await app.inject({ method: "PATCH", url: `/api/tasks/${taskId}/start` });

    const failRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/fail`,
      payload: { error: "Something broke" },
    });
    expect(failRes.statusCode).toBe(200);
    expect(failRes.json().status).toBe("failed");
  });

  it("clones a goal with its tasks", async () => {
    // Create goal + tasks
    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Original Goal" },
    });
    const goalId = goalRes.json().id;

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task A", orderIndex: 0 },
    });
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task B", orderIndex: 1 },
    });

    // Clone
    const cloneRes = await app.inject({
      method: "POST",
      url: `/api/goals/${goalId}/clone`,
    });

    expect(cloneRes.statusCode).toBe(201);
    const cloned = cloneRes.json();
    expect(cloned.title).toBe("Original Goal (copy)");
    expect(cloned.id).not.toBe(goalId);

    // Verify cloned tasks exist
    const tasksRes = await app.inject({
      method: "GET",
      url: `/api/tasks?goalId=${cloned.id}`,
    });
    const tasks = tasksRes.json();
    expect(tasks.data).toHaveLength(2);
    expect(tasks.data.map((t: { title: string }) => t.title).sort()).toEqual(["Task A", "Task B"]);
  });

  it("returns 404 for non-existent goal", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/goals/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Goal not found");
  });
});
