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
    { schema: { tags: ["approvals"], body: CreateApprovalBody } },
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
    { schema: { tags: ["approvals"], querystring: ListPendingQuery } },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingApprovals(app.db, limit);
    },
  );

  /* GET /:id — get a single approval */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["approvals"], params: IdParams } },
    async (request, reply) => {
      const approval = await getApproval(app.db, request.params.id);
      if (!approval) return reply.status(404).send({ error: "Approval not found" });
      return approval;
    },
  );

  /* GET / — list approvals for a task */
  app.get<{ Querystring: typeof TaskIdQuery.static }>(
    "/",
    { schema: { tags: ["approvals"], querystring: TaskIdQuery } },
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
    { schema: { tags: ["approvals"], params: IdParams, body: ResolveApprovalBody } },
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
