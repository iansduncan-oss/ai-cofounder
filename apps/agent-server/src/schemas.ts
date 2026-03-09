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
    Type.Literal("needs_review"),
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

/* ────────────────────────── Pagination ────────────────────────── */

export const PaginationQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export type PaginationQuery = Static<typeof PaginationQuery>;

export const GoalListQuery = Type.Intersect([ConversationIdQuery, PaginationQuery]);
export type GoalListQuery = Static<typeof GoalListQuery>;

export const TaskListQuery = Type.Intersect([GoalIdQuery, PaginationQuery]);
export type TaskListQuery = Static<typeof TaskListQuery>;

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

/* ────────────────────────── Queue ────────────────────────── */

export const EnqueueAgentTaskBody = Type.Object({
  goalId: Type.String(),
  prompt: Type.String({ minLength: 1 }),
  conversationId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  priority: Type.Optional(
    Type.Union([
      Type.Literal("critical"),
      Type.Literal("high"),
      Type.Literal("normal"),
      Type.Literal("low"),
    ]),
  ),
});
export type EnqueueAgentTaskBody = Static<typeof EnqueueAgentTaskBody>;

export const EnqueueBriefingBody = Type.Object({
  type: Type.Optional(
    Type.Union([
      Type.Literal("morning"),
      Type.Literal("evening"),
      Type.Literal("on_demand"),
    ]),
  ),
  deliveryChannels: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("slack"),
        Type.Literal("discord"),
        Type.Literal("voice"),
        Type.Literal("dashboard"),
      ]),
    ),
  ),
});
export type EnqueueBriefingBody = Static<typeof EnqueueBriefingBody>;

export const EnqueueNotificationBody = Type.Object({
  channel: Type.Union([
    Type.Literal("slack"),
    Type.Literal("discord"),
    Type.Literal("all"),
  ]),
  type: Type.Union([
    Type.Literal("alert"),
    Type.Literal("info"),
    Type.Literal("warning"),
    Type.Literal("success"),
  ]),
  title: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});
export type EnqueueNotificationBody = Static<typeof EnqueueNotificationBody>;
