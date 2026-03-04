import { Type, type Static } from "@sinclair/typebox";

/* ────────────────────────── Goals ────────────────────────── */

export const CreateGoalBody = Type.Object({
  conversationId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  priority: Type.Optional(
    Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("critical"),
    ]),
  ),
  createdBy: Type.Optional(Type.String({ format: "uuid" })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateGoalBody = Static<typeof CreateGoalBody>;

export const UpdateGoalStatusBody = Type.Object({
  status: Type.Union([
    Type.Literal("draft"),
    Type.Literal("active"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ]),
});
export type UpdateGoalStatusBody = Static<typeof UpdateGoalStatusBody>;

export const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
export type IdParams = Static<typeof IdParams>;

export const ConversationIdQuery = Type.Object({
  conversationId: Type.String({ format: "uuid" }),
});
export type ConversationIdQuery = Static<typeof ConversationIdQuery>;

/* ────────────────────────── Tasks ────────────────────────── */

export const CreateTaskBody = Type.Object({
  goalId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  assignedAgent: Type.Optional(
    Type.Union([
      Type.Literal("orchestrator"),
      Type.Literal("researcher"),
      Type.Literal("coder"),
      Type.Literal("reviewer"),
      Type.Literal("planner"),
    ]),
  ),
  orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  input: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateTaskBody = Static<typeof CreateTaskBody>;

export const GoalIdQuery = Type.Object({
  goalId: Type.String({ format: "uuid" }),
});
export type GoalIdQuery = Static<typeof GoalIdQuery>;

export const AssignTaskBody = Type.Object({
  agent: Type.Union([
    Type.Literal("orchestrator"),
    Type.Literal("researcher"),
    Type.Literal("coder"),
    Type.Literal("reviewer"),
    Type.Literal("planner"),
  ]),
});
export type AssignTaskBody = Static<typeof AssignTaskBody>;

export const CompleteTaskBody = Type.Object({
  result: Type.String(),
});
export type CompleteTaskBody = Static<typeof CompleteTaskBody>;

export const FailTaskBody = Type.Object({
  error: Type.String(),
});
export type FailTaskBody = Static<typeof FailTaskBody>;

export const ListPendingQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export type ListPendingQuery = Static<typeof ListPendingQuery>;

/* ────────────────────────── Approvals ────────────────────── */

export const CreateApprovalBody = Type.Object({
  taskId: Type.String({ format: "uuid" }),
  requestedBy: Type.Union([
    Type.Literal("orchestrator"),
    Type.Literal("researcher"),
    Type.Literal("coder"),
    Type.Literal("reviewer"),
    Type.Literal("planner"),
  ]),
  reason: Type.String({ minLength: 1 }),
});
export type CreateApprovalBody = Static<typeof CreateApprovalBody>;

export const ResolveApprovalBody = Type.Object({
  status: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
  decision: Type.String({ minLength: 1 }),
  decidedBy: Type.Optional(Type.String({ format: "uuid" })),
});
export type ResolveApprovalBody = Static<typeof ResolveApprovalBody>;

export const TaskIdQuery = Type.Object({
  taskId: Type.String({ format: "uuid" }),
});
export type TaskIdQuery = Static<typeof TaskIdQuery>;
