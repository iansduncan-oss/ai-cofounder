import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  createMilestone,
  getMilestone,
  listMilestonesByConversation,
  updateMilestoneStatus,
  getMilestoneProgress,
  assignGoalToMilestone,
  deleteMilestone,
} from "@ai-cofounder/db";

const CreateMilestoneBody = Type.Object({
  conversationId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 4000 })),
  orderIndex: Type.Optional(Type.Number()),
  dueDate: Type.Optional(Type.String({ format: "date-time" })),
  createdBy: Type.Optional(Type.String({ format: "uuid" })),
});

const StatusBody = Type.Object({
  status: Type.Union([
    Type.Literal("planned"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ]),
});

const AssignGoalBody = Type.Object({
  goalId: Type.String({ format: "uuid" }),
});

export const milestoneRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: typeof CreateMilestoneBody.static }>(
    "/",
    { schema: { tags: ["milestones"], body: CreateMilestoneBody } },
    async (request, reply) => {
      const data = {
        ...request.body,
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : undefined,
      };
      const milestone = await createMilestone(app.db, data);
      return reply.status(201).send(milestone);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", { schema: { tags: ["milestones"] } }, async (request, reply) => {
    const milestone = await getMilestone(app.db, request.params.id);
    if (!milestone) return reply.status(404).send({ error: "Milestone not found" });
    return milestone;
  });

  app.get<{ Params: { conversationId: string } }>(
    "/conversation/:conversationId",
    { schema: { tags: ["milestones"] } },
    async (request) => {
      return listMilestonesByConversation(app.db, request.params.conversationId);
    },
  );

  app.patch<{ Params: { id: string }; Body: typeof StatusBody.static }>(
    "/:id/status",
    { schema: { tags: ["milestones"], body: StatusBody } },
    async (request, reply) => {
      const updated = await updateMilestoneStatus(app.db, request.params.id, request.body.status);
      if (!updated) return reply.status(404).send({ error: "Milestone not found" });
      return updated;
    },
  );

  app.get<{ Params: { id: string } }>("/:id/progress", { schema: { tags: ["milestones"] } }, async (request) => {
    return getMilestoneProgress(app.db, request.params.id);
  });

  app.post<{ Params: { id: string }; Body: typeof AssignGoalBody.static }>(
    "/:id/goals",
    { schema: { tags: ["milestones"], body: AssignGoalBody } },
    async (request, reply) => {
      const updated = await assignGoalToMilestone(app.db, request.body.goalId, request.params.id);
      if (!updated) return reply.status(404).send({ error: "Goal not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", { schema: { tags: ["milestones"] } }, async (request, reply) => {
    const deleted = await deleteMilestone(app.db, request.params.id);
    if (!deleted) return reply.status(404).send({ error: "Milestone not found" });
    return { status: "deleted", id: deleted.id };
  });
};
