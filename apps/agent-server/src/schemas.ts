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

export const BulkGoalStatusBody = Type.Object({
  updates: Type.Array(
    Type.Object({
      id: Type.String({ format: "uuid" }),
      status: Type.Union([
        Type.Literal("draft"),
        Type.Literal("active"),
        Type.Literal("completed"),
        Type.Literal("cancelled"),
        Type.Literal("needs_review"),
      ]),
    }),
    { minItems: 1 },
  ),
});
export type BulkGoalStatusBody = Static<typeof BulkGoalStatusBody>;

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

/* ────────────────────────── Persona ────────────────────────── */

export const UpsertPersonaBody = Type.Object({
  id: Type.Optional(Type.String({ format: "uuid" })),
  name: Type.String({ minLength: 1 }),
  voiceId: Type.Optional(Type.String()),
  corePersonality: Type.String({ minLength: 1 }),
  capabilities: Type.Optional(Type.String()),
  behavioralGuidelines: Type.Optional(Type.String()),
  isActive: Type.Optional(Type.Boolean()),
});
export type UpsertPersonaBody = Static<typeof UpsertPersonaBody>;

/* ────────────────────────── Pipeline ────────────────────────── */

const PipelineStageSchema = Type.Object({
  agent: Type.Union([
    Type.Literal("planner"),
    Type.Literal("coder"),
    Type.Literal("reviewer"),
    Type.Literal("debugger"),
    Type.Literal("researcher"),
  ]),
  prompt: Type.String({ minLength: 1 }),
  dependsOnPrevious: Type.Boolean({ default: false }),
});

export const CreatePipelineBody = Type.Object({
  goalId: Type.String({ format: "uuid" }),
  stages: Type.Array(PipelineStageSchema, { minItems: 1 }),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreatePipelineBody = Static<typeof CreatePipelineBody>;

export const GoalPipelineBody = Type.Object({
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type GoalPipelineBody = Static<typeof GoalPipelineBody>;

export const JobIdParams = Type.Object({
  jobId: Type.String(),
});
export type JobIdParams = Static<typeof JobIdParams>;

export const GoalIdParams = Type.Object({
  goalId: Type.String({ format: "uuid" }),
});
export type GoalIdParams = Static<typeof GoalIdParams>;

/* ────────────────────────── RAG ────────────────────────── */

const RagSourceType = Type.Union([
  Type.Literal("git"),
  Type.Literal("conversation"),
  Type.Literal("slack"),
  Type.Literal("memory"),
  Type.Literal("reflection"),
  Type.Literal("markdown"),
]);

export const RagIngestBody = Type.Object({
  action: Type.Union([
    Type.Literal("ingest_repo"),
    Type.Literal("ingest_conversations"),
    Type.Literal("ingest_text"),
  ]),
  sourceId: Type.String({ minLength: 1 }),
  cursor: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
});
export type RagIngestBody = Static<typeof RagIngestBody>;

export const RagSearchBody = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  sourceType: Type.Optional(RagSourceType),
  minScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});
export type RagSearchBody = Static<typeof RagSearchBody>;

export const RagChunkCountQuery = Type.Object({
  sourceType: Type.Optional(RagSourceType),
});
export type RagChunkCountQuery = Static<typeof RagChunkCountQuery>;

export const RagDeleteSourceParams = Type.Object({
  sourceType: Type.String(),
  sourceId: Type.String(),
});
export type RagDeleteSourceParams = Static<typeof RagDeleteSourceParams>;

/* ────────────────────────── Reflections ────────────────────────── */

export const ReflectionListQuery = Type.Object({
  type: Type.Optional(
    Type.Union([
      Type.Literal("goal_completion"),
      Type.Literal("failure_analysis"),
      Type.Literal("pattern_extraction"),
      Type.Literal("weekly_summary"),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export type ReflectionListQuery = Static<typeof ReflectionListQuery>;
