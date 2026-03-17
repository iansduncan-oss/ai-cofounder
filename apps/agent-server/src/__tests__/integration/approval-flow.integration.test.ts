/**
 * Integration tests: Approval workflow against a real PostgreSQL database.
 *
 * Exercises create, list pending, resolve (approve/reject) via app.inject().
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

describe.skipIf(shouldSkip())("Approval Flow (integration)", () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;
  let conversationId: string;
  let goalId: string;
  let taskId: string;

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

    // Create a goal and task for approvals to reference
    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Approval Test Goal" },
    });
    goalId = goalRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Approval Test Task" },
    });
    taskId = taskRes.json().id;
  });

  it("creates an approval request with pending status", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: {
        taskId,
        requestedBy: "orchestrator",
        reason: "Needs human review before deployment",
      },
    });

    expect(res.statusCode).toBe(201);
    const approval = res.json();
    expect(approval.id).toBeDefined();
    expect(approval.taskId).toBe(taskId);
    expect(approval.requestedBy).toBe("orchestrator");
    expect(approval.status).toBe("pending");
    expect(approval.reason).toBe("Needs human review before deployment");
  });

  it("lists pending approvals", async () => {
    // Create two approvals
    await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "coder", reason: "First request" },
    });
    await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "reviewer", reason: "Second request" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
    });

    expect(res.statusCode).toBe(200);
    const pending = res.json();
    expect(pending).toHaveLength(2);
  });

  it("resolves an approval as approved", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "orchestrator", reason: "Deploy approval" },
    });
    const approvalId = createRes.json().id;

    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approvalId}/resolve`,
      payload: {
        status: "approved",
        decision: "Looks good, proceed with deployment",
      },
    });

    expect(resolveRes.statusCode).toBe(200);
    const resolved = resolveRes.json();
    expect(resolved.status).toBe("approved");

    // Verify it's no longer in pending list
    const pendingRes = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
    });
    expect(pendingRes.json()).toHaveLength(0);
  });

  it("resolves an approval as rejected", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "orchestrator", reason: "Risky change" },
    });
    const approvalId = createRes.json().id;

    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approvalId}/resolve`,
      payload: {
        status: "rejected",
        decision: "Too risky, revert the changes",
      },
    });

    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe("rejected");
  });

  it("fetches a single approval by ID", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "planner", reason: "Check this" },
    });
    const approvalId = createRes.json().id;

    const getRes = await app.inject({
      method: "GET",
      url: `/api/approvals/${approvalId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(approvalId);
    expect(getRes.json().reason).toBe("Check this");
  });

  it("lists approvals by task", async () => {
    await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "coder", reason: "A" },
    });
    await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "reviewer", reason: "B" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/approvals?taskId=${taskId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("returns 404 for non-existent approval", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/approvals/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Approval not found");
  });
});
