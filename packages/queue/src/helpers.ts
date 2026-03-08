import { Job } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";
import {
  getAgentTaskQueue,
  getMonitoringQueue,
  getBriefingQueue,
  getNotificationQueue,
  getPipelineQueue,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
  type PipelineStage,
} from "./queues.js";

const logger = createLogger("queue-helpers");

// ── Priority mapping ──

const PRIORITY_MAP = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
} as const;

// ── Convenience functions for enqueuing jobs ──

export async function enqueueAgentTask(
  job: AgentTaskJob,
): Promise<string | undefined> {
  const queue = getAgentTaskQueue();
  const added = await queue.add("agent-task", job, {
    priority: PRIORITY_MAP[job.priority ?? "normal"],
  });
  logger.info({ jobId: added.id, goalId: job.goalId }, "Agent task enqueued");
  return added.id;
}

export async function enqueueMonitoringCheck(
  job: MonitoringJob,
): Promise<string | undefined> {
  const queue = getMonitoringQueue();
  const added = await queue.add(job.check, job);
  return added.id;
}

export async function enqueueBriefing(
  job: BriefingJob,
): Promise<string | undefined> {
  const queue = getBriefingQueue();
  const added = await queue.add(`briefing-${job.type}`, job);
  logger.info({ jobId: added.id, type: job.type }, "Briefing enqueued");
  return added.id;
}

export async function enqueueNotification(
  job: NotificationJob,
): Promise<string | undefined> {
  const queue = getNotificationQueue();
  const added = await queue.add("notification", job);
  return added.id;
}

export async function enqueuePipeline(opts: {
  goalId: string;
  stages: PipelineStage[];
  context?: Record<string, unknown>;
}): Promise<string | undefined> {
  const queue = getPipelineQueue();
  const pipelineId = `pipeline-${Date.now()}`;
  const job: PipelineJob = {
    pipelineId,
    goalId: opts.goalId,
    stages: opts.stages,
    currentStage: 0,
    context: opts.context ?? {},
  };
  const added = await queue.add("pipeline", job);
  logger.info(
    { jobId: added.id, pipelineId, stageCount: opts.stages.length },
    "Pipeline enqueued",
  );
  return added.id;
}

// ── Individual job status helper ──

export interface JobStatusResult {
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown";
  jobId: string;
  attemptsMade: number;
  finishedOn?: number;
  failedReason?: string;
}

export async function getJobStatus(jobId: string): Promise<JobStatusResult | null> {
  const queue = getAgentTaskQueue();
  const job = await Job.fromId(queue, jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    state: state as JobStatusResult["state"],
    jobId,
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
  };
}

// ── Queue status helpers ──

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function getAllQueueStatus(): Promise<QueueStatus[]> {
  const queues = [
    { name: "agent-tasks", queue: getAgentTaskQueue() },
    { name: "monitoring", queue: getMonitoringQueue() },
    { name: "briefings", queue: getBriefingQueue() },
    { name: "notifications", queue: getNotificationQueue() },
    { name: "pipelines", queue: getPipelineQueue() },
  ];

  return Promise.all(
    queues.map(async ({ name, queue }) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      return { name, waiting, active, completed, failed, delayed };
    }),
  );
}
