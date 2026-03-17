/**
 * Integration tests: API response shape contracts.
 *
 * Validates that response structures match what the dashboard's
 * TanStack Query hooks expect (PaginatedResponse<T>, entity shapes, 404s).
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

describe.skipIf(shouldSkip())("API Contract (integration)", () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;
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
    conversationId = seed.conversationId;
  });

  describe("PaginatedResponse shapes", () => {
    it("GET /api/goals returns { data, total, limit, offset }", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/goals?conversationId=${conversationId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(typeof body.limit).toBe("number");
      expect(typeof body.offset).toBe("number");
    });

    it("GET /api/tasks returns { data, total, limit, offset }", async () => {
      // Need a goal first
      const goalRes = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: { conversationId, title: "Contract Test" },
      });
      const goalId = goalRes.json().id;

      const res = await app.inject({
        method: "GET",
        url: `/api/tasks?goalId=${goalId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("Goal entity shape", () => {
    it("has all expected fields", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: {
          conversationId,
          title: "Shape Test",
          description: "Description here",
          priority: "medium",
        },
      });
      const goal = createRes.json();

      expect(goal).toHaveProperty("id");
      expect(goal).toHaveProperty("conversationId");
      expect(goal).toHaveProperty("title");
      expect(goal).toHaveProperty("description");
      expect(goal).toHaveProperty("status");
      expect(goal).toHaveProperty("priority");
      expect(goal).toHaveProperty("createdAt");
      expect(goal).toHaveProperty("updatedAt");

      // Type checks
      expect(typeof goal.id).toBe("string");
      expect(typeof goal.conversationId).toBe("string");
      expect(typeof goal.title).toBe("string");
      expect(typeof goal.status).toBe("string");
    });
  });

  describe("Task entity shape", () => {
    it("has all expected fields", async () => {
      const goalRes = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: { conversationId, title: "Task Shape" },
      });
      const goalId = goalRes.json().id;

      const taskRes = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          goalId,
          title: "Shape Task",
          assignedAgent: "researcher",
          orderIndex: 0,
        },
      });
      const task = taskRes.json();

      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("goalId");
      expect(task).toHaveProperty("title");
      expect(task).toHaveProperty("status");
      expect(task).toHaveProperty("assignedAgent");
      expect(task).toHaveProperty("orderIndex");
      expect(task).toHaveProperty("createdAt");
      expect(task).toHaveProperty("updatedAt");

      expect(typeof task.id).toBe("string");
      expect(typeof task.goalId).toBe("string");
      expect(task.goalId).toBe(goalId);
      expect(task.assignedAgent).toBe("researcher");
    });

    it("includes dependsOn field when created with dependencies", async () => {
      const goalRes = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: { conversationId, title: "DependsOn Shape" },
      });
      const gId = goalRes.json().id;

      const rootRes = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { goalId: gId, title: "Dep Root", orderIndex: 0 },
      });
      const rootId = rootRes.json().id;

      const depRes = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { goalId: gId, title: "Dep Child", orderIndex: 1, dependsOn: [rootId] },
      });
      const task = depRes.json();

      expect(task).toHaveProperty("dependsOn");
      expect(Array.isArray(task.dependsOn)).toBe(true);
      expect(task.dependsOn).toEqual([rootId]);
    });
  });

  describe("Approval entity shape", () => {
    it("has all expected fields", async () => {
      const goalRes = await app.inject({
        method: "POST",
        url: "/api/goals",
        payload: { conversationId, title: "Approval Shape" },
      });
      const goalId = goalRes.json().id;

      const taskRes = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { goalId, title: "Approval Task" },
      });
      const taskId = taskRes.json().id;

      const approvalRes = await app.inject({
        method: "POST",
        url: "/api/approvals",
        payload: {
          taskId,
          requestedBy: "orchestrator",
          reason: "Shape test",
        },
      });
      const approval = approvalRes.json();

      expect(approval).toHaveProperty("id");
      expect(approval).toHaveProperty("taskId");
      expect(approval).toHaveProperty("requestedBy");
      expect(approval).toHaveProperty("status");
      expect(approval).toHaveProperty("reason");
      expect(approval).toHaveProperty("createdAt");

      expect(typeof approval.id).toBe("string");
      expect(approval.taskId).toBe(taskId);
      expect(approval.status).toBe("pending");
    });
  });

  describe("404 handling", () => {
    it("returns { error: string } for missing goal", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/goals/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
    });

    it("returns { error: string } for missing task", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/tasks/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
    });

    it("returns { error: string } for missing approval", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
    });

    it("returns 400 for invalid UUID format", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/goals/not-a-uuid",
      });
      // Typebox validation returns 400 for format: "uuid" violations
      expect(res.statusCode).toBe(400);
    });
  });
});
