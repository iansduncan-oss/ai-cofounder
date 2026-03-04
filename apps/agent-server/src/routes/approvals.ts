import type { FastifyPluginAsync } from "fastify";
import {
  createApproval,
  getApproval,
  listPendingApprovals,
  listApprovalsByTask,
  resolveApproval,
} from "@ai-cofounder/db";
import {
  CreateApprovalBody,
  ResolveApprovalBody,
  IdParams,
  TaskIdQuery,
  ListPendingQuery,
} from "../schemas.js";

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create an approval request */
  app.post<{ Body: typeof CreateApprovalBody.static }>(
    "/",
    { schema: { body: CreateApprovalBody } },
    async (request, reply) => {
      const approval = await createApproval(app.db, request.body);
      return reply.status(201).send(approval);
    },
  );

  /* GET /pending — list pending approvals */
  app.get<{ Querystring: typeof ListPendingQuery.static }>(
    "/pending",
    { schema: { querystring: ListPendingQuery } },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingApprovals(app.db, limit);
    },
  );

  /* GET /:id — get a single approval */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { params: IdParams } },
    async (request, reply) => {
      const approval = await getApproval(app.db, request.params.id);
      if (!approval)
        return reply.status(404).send({ error: "Approval not found" });
      return approval;
    },
  );

  /* GET / — list approvals for a task */
  app.get<{ Querystring: typeof TaskIdQuery.static }>(
    "/",
    { schema: { querystring: TaskIdQuery } },
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
    { schema: { params: IdParams, body: ResolveApprovalBody } },
    async (request, reply) => {
      const approval = await resolveApproval(
        app.db,
        request.params.id,
        request.body.status,
        request.body.decision,
        request.body.decidedBy,
      );
      if (!approval)
        return reply.status(404).send({ error: "Approval not found" });
      return approval;
    },
  );
};
