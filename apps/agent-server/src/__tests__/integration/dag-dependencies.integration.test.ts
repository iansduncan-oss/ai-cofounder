/**
 * Integration tests: DAG task dependencies.
 *
 * Validates that dependsOn is persisted, returned in API responses,
 * and task lifecycle works correctly with dependency chains.
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

describe.skipIf(shouldSkip())("DAG Dependencies (integration)", () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;
  let conversationId: string;
  let goalId: string;

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
    conversationId = seed.conversationId;

    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "DAG Test Goal" },
    });
    goalId = goalRes.json().id;
  });

  it("creates a task with dependsOn referencing another task UUID", async () => {
    const taskA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task A", orderIndex: 0 },
    });
    const taskAId = taskA.json().id;

    const taskB = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task B", orderIndex: 1, dependsOn: [taskAId] },
    });
    expect(taskB.statusCode).toBe(201);
    expect(taskB.json().dependsOn).toEqual([taskAId]);

    // Verify via GET
    const fetched = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskB.json().id}`,
    });
    expect(fetched.json().dependsOn).toEqual([taskAId]);
  });

  it("persists diamond dependency graph correctly", async () => {
    // A → B, A → C, B+C → D
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "A", orderIndex: 0 },
    });
    const aId = resA.json().id;

    const resB = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "B", orderIndex: 1, dependsOn: [aId] },
    });
    const bId = resB.json().id;

    const resC = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "C", orderIndex: 2, dependsOn: [aId] },
    });
    const cId = resC.json().id;

    const resD = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "D", orderIndex: 3, dependsOn: [bId, cId] },
    });

    expect(resA.json().dependsOn).toBeNull();
    expect(resB.json().dependsOn).toEqual([aId]);
    expect(resC.json().dependsOn).toEqual([aId]);
    expect(resD.json().dependsOn).toEqual(expect.arrayContaining([bId, cId]));
    expect(resD.json().dependsOn).toHaveLength(2);
  });

  it("task list includes dependsOn in response", async () => {
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Root", orderIndex: 0 },
    });
    const aId = resA.json().id;

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Dependent", orderIndex: 1, dependsOn: [aId] },
    });

    const listRes = await app.inject({
      method: "GET",
      url: `/api/tasks?goalId=${goalId}`,
    });
    expect(listRes.statusCode).toBe(200);
    const tasks = listRes.json().data;
    expect(tasks).toHaveLength(2);

    const dependent = tasks.find((t: { title: string }) => t.title === "Dependent");
    expect(dependent).toBeDefined();
    expect(dependent.dependsOn).toEqual([aId]);
  });

  it("task with no dependencies can start immediately", async () => {
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Independent", orderIndex: 0 },
    });
    const aId = resA.json().id;

    const startRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${aId}/start`,
    });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().status).toBe("running");
  });

  it("dependent task can start after dependency completes", async () => {
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "A", orderIndex: 0 },
    });
    const aId = resA.json().id;

    const resB = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "B", orderIndex: 1, dependsOn: [aId] },
    });
    const bId = resB.json().id;

    // Start and complete A
    await app.inject({ method: "PATCH", url: `/api/tasks/${aId}/start` });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${aId}/complete`,
      payload: { result: "Done" },
    });

    // B should be startable
    const startB = await app.inject({ method: "PATCH", url: `/api/tasks/${bId}/start` });
    expect(startB.statusCode).toBe(200);
    expect(startB.json().status).toBe("running");
  });

  it("blocked task status is persisted correctly", async () => {
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Will be blocked", orderIndex: 0 },
    });
    const aId = resA.json().id;

    // Block via direct DB call (as dispatcher would)
    const { blockTask } = await import("@ai-cofounder/db");
    const db = (app as unknown as { db: Parameters<typeof blockTask>[0] }).db;
    await blockTask(db, aId, "Upstream failed");

    const fetched = await app.inject({
      method: "GET",
      url: `/api/tasks/${aId}`,
    });
    expect(fetched.json().status).toBe("blocked");
    expect(fetched.json().error).toBe("Upstream failed");
  });

  it("full DAG lifecycle: create → execute → complete goal", async () => {
    // Create 3 chained tasks: A → B → C
    const resA = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Step 1", orderIndex: 0 },
    });
    const aId = resA.json().id;

    const resB = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Step 2", orderIndex: 1, dependsOn: [aId] },
    });
    const bId = resB.json().id;

    const resC = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Step 3", orderIndex: 2, dependsOn: [bId] },
    });
    const cId = resC.json().id;

    // Progress through: start → complete for each in order
    for (const id of [aId, bId, cId]) {
      const start = await app.inject({ method: "PATCH", url: `/api/tasks/${id}/start` });
      expect(start.statusCode).toBe(200);

      const complete = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${id}/complete`,
        payload: { result: `${id} done` },
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().status).toBe("completed");
    }

    // Complete the goal
    const goalUpdate = await app.inject({
      method: "PATCH",
      url: `/api/goals/${goalId}/status`,
      payload: { status: "completed" },
    });
    expect(goalUpdate.statusCode).toBe(200);
    expect(goalUpdate.json().status).toBe("completed");

    // Verify all final states
    for (const id of [aId, bId, cId]) {
      const task = await app.inject({ method: "GET", url: `/api/tasks/${id}` });
      expect(task.json().status).toBe("completed");
    }
  });
});
