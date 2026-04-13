import type { FastifyPluginAsync } from "fastify";
import {
  createApproval,
  getApproval,
  listPendingApprovals,
  listApprovalsByTask,
  resolveApproval,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import {
  CreateApprovalBody,
  ResolveApprovalBody,
  IdParams,
  TaskIdQuery,
  ListPendingQuery,
} from "../schemas.js";
import { notifyApprovalCreated } from "../services/notifications.js";
import { recordActionSafe } from "../services/action-recorder.js";

const logger = createLogger("approval-routes");

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create an approval request */
  app.post<{ Body: typeof CreateApprovalBody.static }>(
    "/",
    {
      schema: {
        tags: ["approvals"],
        summary: "Create a human approval request",
        description:
          "Creates a pending approval for a potentially risky action (destructive tools, yellow-tier agents, " +
          "external communications). Notifies the user via Discord webhook (if configured). The orchestrator " +
          "or dispatcher polls this endpoint and waits until the approval is resolved or times out.",
        body: CreateApprovalBody,
      },
    },
    async (request, reply) => {
      const approval = await createApproval(app.db, request.body);
      app.wsBroadcast?.("approvals");
      notifyApprovalCreated({
        approvalId: approval.id,
        taskId: request.body.taskId,
        reason: request.body.reason,
        requestedBy: request.body.requestedBy,
      }).catch((err) => logger.warn({ err }, "approval event creation failed"));
      return reply.status(201).send(approval);
    },
  );

  /* GET /pending — list pending approvals */
  app.get<{ Querystring: typeof ListPendingQuery.static }>(
    "/pending",
    {
      schema: {
        tags: ["approvals"],
        summary: "List approvals awaiting decision",
        description:
          "Returns all approvals with status `pending`. Powers the dashboard's approval inbox and the " +
          "Discord bot's /pending command.",
        querystring: ListPendingQuery,
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingApprovals(app.db, limit);
    },
  );

  /* GET /:id — get a single approval */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    {
      schema: {
        tags: ["approvals"],
        summary: "Get an approval by ID",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const approval = await getApproval(app.db, request.params.id);
      if (!approval) return reply.status(404).send({ error: "Approval not found" });
      return approval;
    },
  );

  /* GET / — list approvals for a task */
  app.get<{ Querystring: typeof TaskIdQuery.static }>(
    "/",
    {
      schema: {
        tags: ["approvals"],
        summary: "List approvals for a specific task",
        description:
          "Returns all approvals (pending, approved, rejected) associated with a task ID. Useful for " +
          "showing approval history on a task detail page.",
        querystring: TaskIdQuery,
      },
    },
    async (request) => {
      return listApprovalsByTask(app.db, request.query.taskId);
    },
  );

  /* PATCH /:id/resolve — approve or reject */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof ResolveApprovalBody.static;
  }>(
    "/:id/resolve",
    {
      schema: {
        tags: ["approvals"],
        summary: "Resolve a pending approval (approve or reject)",
        description:
          "Sets the approval status to `approved` or `rejected` along with a `decision` note and the " +
          "`decidedBy` user ID. The orchestrator/dispatcher is polling this approval, so the waiting action " +
          "will proceed (or abort) once resolved. Records an `approval_submitted` action for audit.",
        params: IdParams,
        body: ResolveApprovalBody,
      },
    },
    async (request, reply) => {
      const approval = await resolveApproval(
        app.db,
        request.params.id,
        request.body.status,
        request.body.decision,
        request.body.decidedBy,
      );
      if (!approval) return reply.status(404).send({ error: "Approval not found" });
      app.wsBroadcast?.("approvals");
      recordActionSafe(app.db, {
        userId: request.body.decidedBy,
        actionType: "approval_submitted",
        actionDetail: `${request.body.status}: ${request.body.decision.slice(0, 150)}`,
      });
      return approval;
    },
  );
};
