/**
 * Integration tests: Approval + execution context.
 *
 * Validates approval creation linked to tasks, resolution lifecycle,
 * and that approval status is independent of task status.
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

describe.skipIf(shouldSkip())("Approval + Execution (integration)", () => {
  let app: FastifyInstance;
  let sql: ReturnType<typeof postgres>;
  let conversationId: string;
  let userId: string;
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
    userId = seed.userId;

    const goalRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId, title: "Approval Test Goal" },
    });
    goalId = goalRes.json().id;
  });

  it("pending approval is linked to task", async () => {
    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Needs approval" },
    });
    const taskId = taskRes.json().id;

    const approvalRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "orchestrator", reason: "Deploy to prod" },
    });
    expect(approvalRes.statusCode).toBe(201);

    const pendingRes = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
    });
    const pending = pendingRes.json();
    expect(pending).toHaveLength(1);
    expect(pending[0].taskId).toBe(taskId);
    expect(pending[0].status).toBe("pending");
  });

  it("approving does not auto-progress task status", async () => {
    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Gated task" },
    });
    const taskId = taskRes.json().id;

    const approvalRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "planner", reason: "Needs sign-off" },
    });
    const approvalId = approvalRes.json().id;

    // Resolve as approved
    await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approvalId}/resolve`,
      payload: { status: "approved", decision: "Looks good", decidedBy: userId },
    });

    // Task should still be pending
    const taskCheck = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
    });
    expect(taskCheck.json().status).toBe("pending");
  });

  it("rejecting does not auto-fail task", async () => {
    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Maybe rejected" },
    });
    const taskId = taskRes.json().id;

    const approvalRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "coder", reason: "Risky change" },
    });
    const approvalId = approvalRes.json().id;

    await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approvalId}/resolve`,
      payload: { status: "rejected", decision: "Too risky", decidedBy: userId },
    });

    const taskCheck = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
    });
    expect(taskCheck.json().status).toBe("pending");
  });

  it("multiple approvals for different tasks resolve independently", async () => {
    const task1Res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task 1", orderIndex: 0 },
    });
    const task1Id = task1Res.json().id;

    const task2Res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Task 2", orderIndex: 1 },
    });
    const task2Id = task2Res.json().id;

    const appr1 = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId: task1Id, requestedBy: "orchestrator", reason: "Task 1 gate" },
    });
    const appr2 = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId: task2Id, requestedBy: "orchestrator", reason: "Task 2 gate" },
    });

    // Approve task 1, reject task 2
    await app.inject({
      method: "PATCH",
      url: `/api/approvals/${appr1.json().id}/resolve`,
      payload: { status: "approved", decision: "Go", decidedBy: userId },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/approvals/${appr2.json().id}/resolve`,
      payload: { status: "rejected", decision: "No", decidedBy: userId },
    });

    // Verify via GET by ID
    const check1 = await app.inject({ method: "GET", url: `/api/approvals/${appr1.json().id}` });
    const check2 = await app.inject({ method: "GET", url: `/api/approvals/${appr2.json().id}` });
    expect(check1.json().status).toBe("approved");
    expect(check2.json().status).toBe("rejected");

    // Verify via list by task
    const byTask1 = await app.inject({ method: "GET", url: `/api/approvals?taskId=${task1Id}` });
    const byTask2 = await app.inject({ method: "GET", url: `/api/approvals?taskId=${task2Id}` });
    expect(byTask1.json()[0].status).toBe("approved");
    expect(byTask2.json()[0].status).toBe("rejected");
  });

  it("approval includes decidedAt after resolution", async () => {
    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Timestamped approval" },
    });
    const taskId = taskRes.json().id;

    const approvalRes = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId, requestedBy: "reviewer", reason: "Check timestamps" },
    });
    const approval = approvalRes.json();
    expect(approval.decidedAt).toBeNull();

    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { status: "approved", decision: "LGTM", decidedBy: userId },
    });
    const resolved = resolveRes.json();

    expect(resolved.decidedBy).toBe(userId);
    expect(resolved.decidedAt).toBeTruthy();
    // decidedAt should be after createdAt
    expect(new Date(resolved.decidedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(resolved.createdAt).getTime(),
    );
  });

  it("full lifecycle: goal → tasks → approval → resolve → complete", async () => {
    // Create two tasks
    const task1 = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Pre-approval work", orderIndex: 0 },
    });
    const task2 = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId, title: "Post-approval work", orderIndex: 1 },
    });
    const t1Id = task1.json().id;
    const t2Id = task2.json().id;

    // Complete task 1
    await app.inject({ method: "PATCH", url: `/api/tasks/${t1Id}/start` });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t1Id}/complete`,
      payload: { result: "Phase 1 done" },
    });

    // Create approval gate before task 2
    const approval = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId: t2Id, requestedBy: "orchestrator", reason: "Review phase 1 output" },
    });

    // Resolve approval
    await app.inject({
      method: "PATCH",
      url: `/api/approvals/${approval.json().id}/resolve`,
      payload: { status: "approved", decision: "Phase 1 looks good", decidedBy: userId },
    });

    // Now complete task 2
    await app.inject({ method: "PATCH", url: `/api/tasks/${t2Id}/start` });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t2Id}/complete`,
      payload: { result: "Phase 2 done" },
    });

    // Complete goal
    const goalDone = await app.inject({
      method: "PATCH",
      url: `/api/goals/${goalId}/status`,
      payload: { status: "completed" },
    });
    expect(goalDone.json().status).toBe("completed");

    // Verify everything is complete
    const t1Check = await app.inject({ method: "GET", url: `/api/tasks/${t1Id}` });
    const t2Check = await app.inject({ method: "GET", url: `/api/tasks/${t2Id}` });
    expect(t1Check.json().status).toBe("completed");
    expect(t2Check.json().status).toBe("completed");
  });
});
