import { Queue } from "bullmq";
import { getRedisConnection } from "./connection.js";

// ── Job type definitions ──

export interface AgentTaskJob {
  goalId: string;
  taskId?: string;
  prompt: string;
  conversationId?: string;
  userId?: string;
  agentRole?: string;
  priority?: "critical" | "high" | "normal" | "low";
}

export interface MonitoringJob {
  check: "github_ci" | "github_prs" | "vps_health" | "vps_containers" | "approval_timeout_sweep" | "budget_check" | "dlq_check" | "follow_up_reminders" | "sandbox_orphan_cleanup" | "custom";
  target?: string; // repo name, service name, etc.
  metadata?: Record<string, unknown>;
}

export interface BriefingJob {
  type: "morning" | "evening" | "on_demand";
  userId?: string;
  deliveryChannels?: ("slack" | "discord" | "voice" | "dashboard")[];
}

export interface NotificationJob {
  channel: "slack" | "discord" | "all";
  type: "alert" | "info" | "warning" | "success";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineJob {
  pipelineId: string;
  goalId: string;
  stages: PipelineStage[];
  currentStage: number;
  context: Record<string, unknown>;
}

export interface PipelineStage {
  agent: "planner" | "coder" | "reviewer" | "debugger" | "researcher";
  prompt: string;
  dependsOnPrevious: boolean;
}

export interface RagIngestionJob {
  action: "ingest_repo" | "ingest_conversations" | "ingest_text";
  sourceId: string;
  cursor?: string;
  metadata?: Record<string, unknown>;
}

export interface ReflectionJob {
  action: "analyze_goal" | "weekly_patterns" | "analyze_user_patterns" | "extract_decision" | "consolidate_memories" | "process_pattern_feedback" | "create_episode" | "learn_procedure" | "memory_lifecycle" | "analyze_failures";
  goalId?: string;
  goalTitle?: string;
  status?: string;
  taskResults?: Array<{
    id: string;
    title: string;
    agent: string;
    status: string;
    output?: string;
  }>;
  // Used by extract_decision action (MEM-02)
  response?: string;
  userId?: string;
  conversationId?: string;
}

export interface SubagentTaskJob {
  subagentRunId: string;
  title: string;
  instruction: string;
  conversationId?: string;
  goalId?: string;
  userId?: string;
  parentRequestId?: string;
  priority?: "critical" | "high" | "normal" | "low";
  metadata?: Record<string, unknown>;
}

export interface DeployVerificationJob {
  deploymentId: string;
  commitSha: string;
  previousSha?: string;
  errorLog?: string;
}

export interface AutonomousSessionJob {
  trigger: "schedule" | "manual" | "ci-heal";
  tokenBudget?: number;
  timeBudgetMs?: number;
  prompt?: string;
}

export interface MeetingPrepJob {
  action: "generate_upcoming" | "send_notifications";
}

// ── Queue names ──

export const QUEUE_NAMES = {
  AGENT_TASKS: "agent-tasks",
  SUBAGENT_TASKS: "subagent-tasks",
  MONITORING: "monitoring",
  BRIEFINGS: "briefings",
  NOTIFICATIONS: "notifications",
  PIPELINES: "pipelines",
  RAG_INGESTION: "rag-ingestion",
  REFLECTIONS: "reflections",
  DEPLOY_VERIFICATION: "deploy-verification",
  DEAD_LETTER: "dead-letter",
  AUTONOMOUS_SESSIONS: "autonomous-sessions",
  MEETING_PREP: "meeting-prep",
} as const;

export interface DeadLetterJob {
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  originalData: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

// ── Queue instances ──

const queues = new Map<string, Queue>();

function getOrCreateQueue<T>(name: string): Queue<T> {
  if (!queues.has(name)) {
    const queue = new Queue<T>(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 1000 },  // 24h TTL, max 1000
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },   // 7d TTL for debugging
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
    queues.set(name, queue);
  }
  return queues.get(name)! as Queue<T>;
}

export function getAgentTaskQueue(): Queue<AgentTaskJob> {
  return getOrCreateQueue<AgentTaskJob>(QUEUE_NAMES.AGENT_TASKS);
}

export function getMonitoringQueue(): Queue<MonitoringJob> {
  return getOrCreateQueue<MonitoringJob>(QUEUE_NAMES.MONITORING);
}

export function getBriefingQueue(): Queue<BriefingJob> {
  return getOrCreateQueue<BriefingJob>(QUEUE_NAMES.BRIEFINGS);
}

export function getNotificationQueue(): Queue<NotificationJob> {
  return getOrCreateQueue<NotificationJob>(QUEUE_NAMES.NOTIFICATIONS);
}

export function getPipelineQueue(): Queue<PipelineJob> {
  return getOrCreateQueue<PipelineJob>(QUEUE_NAMES.PIPELINES);
}

export function getRagIngestionQueue(): Queue<RagIngestionJob> {
  return getOrCreateQueue<RagIngestionJob>(QUEUE_NAMES.RAG_INGESTION);
}

export function getReflectionQueue(): Queue<ReflectionJob> {
  return getOrCreateQueue<ReflectionJob>(QUEUE_NAMES.REFLECTIONS);
}

export function getSubagentTaskQueue(): Queue<SubagentTaskJob> {
  return getOrCreateQueue<SubagentTaskJob>(QUEUE_NAMES.SUBAGENT_TASKS);
}

export function getDeployVerificationQueue(): Queue<DeployVerificationJob> {
  return getOrCreateQueue<DeployVerificationJob>(QUEUE_NAMES.DEPLOY_VERIFICATION);
}

export function getDeadLetterQueue(): Queue<DeadLetterJob> {
  return getOrCreateQueue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER);
}

export function getAutonomousSessionQueue(): Queue<AutonomousSessionJob> {
  return getOrCreateQueue<AutonomousSessionJob>(QUEUE_NAMES.AUTONOMOUS_SESSIONS);
}

export function getMeetingPrepQueue(): Queue<MeetingPrepJob> {
  return getOrCreateQueue<MeetingPrepJob>(QUEUE_NAMES.MEETING_PREP);
}

export async function closeAllQueues(): Promise<void> {
  const closers = Array.from(queues.values()).map((q) => q.close());
  await Promise.all(closers);
  queues.clear();
}
