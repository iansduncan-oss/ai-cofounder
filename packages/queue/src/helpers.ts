import net from "net";
import { Job, type Queue } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";
import {
  getAgentTaskQueue,
  getMonitoringQueue,
  getBriefingQueue,
  getNotificationQueue,
  getPipelineQueue,
  getRagIngestionQueue,
  getReflectionQueue,
  getSubagentTaskQueue,
  getDeadLetterQueue,
  getAutonomousSessionQueue,
  getDeployVerificationQueue,
  getMeetingPrepQueue,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
  type PipelineStage,
  type RagIngestionJob,
  type ReflectionJob,
  type SubagentTaskJob,
  type DeadLetterJob,
  type AutonomousSessionJob,
  type MeetingPrepJob,
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

export async function enqueueRagIngestion(
  job: RagIngestionJob,
): Promise<string | undefined> {
  const queue = getRagIngestionQueue();
  const added = await queue.add("rag-ingestion", job);
  logger.info({ jobId: added.id, action: job.action, sourceId: job.sourceId }, "RAG ingestion enqueued");
  return added.id;
}

export async function enqueueReflection(
  job: ReflectionJob,
): Promise<string | undefined> {
  const queue = getReflectionQueue();
  const added = await queue.add(`reflection-${job.action}`, job);
  logger.info({ jobId: added.id, action: job.action, goalId: job.goalId }, "Reflection job enqueued");
  return added.id;
}

export async function enqueueSubagentTask(
  job: SubagentTaskJob,
): Promise<string | undefined> {
  const queue = getSubagentTaskQueue();
  const added = await queue.add("subagent-task", job, {
    priority: PRIORITY_MAP[job.priority ?? "normal"],
  });
  logger.info({ jobId: added.id, subagentRunId: job.subagentRunId, title: job.title }, "Subagent task enqueued");
  return added.id;
}

export async function enqueueMeetingPrep(
  job: MeetingPrepJob,
): Promise<string | undefined> {
  const queue = getMeetingPrepQueue();
  const added = await queue.add(`meeting-prep-${job.action}`, job);
  logger.info({ jobId: added.id, action: job.action }, "Meeting prep job enqueued");
  return added.id;
}

export async function enqueueAutonomousSession(
  job: AutonomousSessionJob,
): Promise<string | undefined> {
  const queue = getAutonomousSessionQueue();
  const added = await queue.add("autonomous-session", job);
  logger.info({ jobId: added.id, trigger: job.trigger }, "Autonomous session enqueued");
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

// ── Redis ping helper ──

export async function pingRedis(): Promise<"ok" | "unreachable"> {
  return new Promise((resolve) => {
    try {
      const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
      const parsed = new URL(redisUrl);
      const host = parsed.hostname || "localhost";
      const port = parseInt(parsed.port || "6379", 10);

      const socket = net.connect({ host, port });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve("unreachable");
      }, 3000);

      socket.on("connect", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve("ok");
      });

      socket.on("error", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve("unreachable");
      });
    } catch {
      resolve("unreachable");
    }
  });
}

// ── Queue status helpers ──

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  oldestWaitingTimestamp?: number;
}

export async function getAllQueueStatus(): Promise<QueueStatus[]> {
  const queues = [
    { name: "agent-tasks", queue: getAgentTaskQueue() },
    { name: "subagent-tasks", queue: getSubagentTaskQueue() },
    { name: "monitoring", queue: getMonitoringQueue() },
    { name: "briefings", queue: getBriefingQueue() },
    { name: "notifications", queue: getNotificationQueue() },
    { name: "pipelines", queue: getPipelineQueue() },
    { name: "rag-ingestion", queue: getRagIngestionQueue() },
    { name: "reflections", queue: getReflectionQueue() },
    { name: "dead-letter", queue: getDeadLetterQueue() },
  ];

  return Promise.all(
    queues.map(async ({ name, queue }) => {
      const [waiting, active, completed, failed, delayed, waitingJobs] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.getWaiting(0, 0), // get oldest waiting job (index 0)
      ]);
      const oldestWaitingTimestamp = waitingJobs[0]?.timestamp;
      return { name, waiting, active, completed, failed, delayed, oldestWaitingTimestamp };
    }),
  );
}

// ── Dead Letter Queue helpers ──

export async function sendToDeadLetter(
  originalQueue: string,
  originalJobId: string,
  originalJobName: string,
  originalData: unknown,
  failedReason: string,
  attemptsMade: number,
): Promise<string | undefined> {
  const dlq = getDeadLetterQueue();
  const dlJob: DeadLetterJob = {
    originalQueue,
    originalJobId,
    originalJobName,
    originalData,
    failedReason,
    attemptsMade,
    failedAt: new Date().toISOString(),
  };
  const added = await dlq.add("dead-letter", dlJob, {
    removeOnComplete: false,
    removeOnFail: false,
  });
  logger.warn(
    { jobId: added.id, originalQueue, originalJobId, failedReason },
    "Job sent to dead letter queue",
  );
  return added.id;
}

export interface DeadLetterEntry {
  dlqJobId: string;
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

export async function listDeadLetterJobs(limit = 50, offset = 0): Promise<DeadLetterEntry[]> {
  const dlq = getDeadLetterQueue();
  const jobs = await dlq.getWaiting(offset, offset + limit - 1);
  return jobs.map((job) => ({
    dlqJobId: job.id ?? "",
    originalQueue: job.data.originalQueue,
    originalJobId: job.data.originalJobId,
    originalJobName: job.data.originalJobName,
    failedReason: job.data.failedReason,
    attemptsMade: job.data.attemptsMade,
    failedAt: job.data.failedAt,
  }));
}

export async function retryDeadLetterJob(dlqJobId: string): Promise<{ requeued: boolean; originalQueue: string }> {
  const dlq = getDeadLetterQueue();
  const job = await Job.fromId(dlq, dlqJobId);
  if (!job) throw new Error(`DLQ job ${dlqJobId} not found`);

  const { originalQueue, originalJobName, originalData } = job.data;

  // Re-enqueue to the original queue
  const queueMap: Record<string, () => Queue> = {
    "agent-tasks": getAgentTaskQueue,
    "subagent-tasks": getSubagentTaskQueue,
    "monitoring": getMonitoringQueue,
    "briefings": getBriefingQueue,
    "notifications": getNotificationQueue,
    "pipelines": getPipelineQueue,
    "rag-ingestion": getRagIngestionQueue,
    "reflections": getReflectionQueue,
    "deploy-verification": getDeployVerificationQueue,
    "autonomous-sessions": getAutonomousSessionQueue,
  };

  const getQueue = queueMap[originalQueue];
  if (!getQueue) throw new Error(`Unknown original queue: ${originalQueue}`);

  const targetQueue = getQueue();
  await targetQueue.add(originalJobName, originalData);
  await job.remove();

  logger.info({ dlqJobId, originalQueue, originalJobName }, "DLQ job retried");
  return { requeued: true, originalQueue };
}

export async function deleteDeadLetterJob(dlqJobId: string): Promise<void> {
  const dlq = getDeadLetterQueue();
  const job = await Job.fromId(dlq, dlqJobId);
  if (!job) throw new Error(`DLQ job ${dlqJobId} not found`);
  await job.remove();
  logger.info({ dlqJobId }, "DLQ job deleted");
}

// ── Stale job detection ──

export interface StaleJobCount {
  name: string;
  staleCount: number;
}

/**
 * Returns a count of active jobs per queue that have been running longer than `thresholdMs`.
 */
export async function getStaleJobCounts(thresholdMs = 30 * 60 * 1000): Promise<StaleJobCount[]> {
  const queues = [
    { name: "agent-tasks", queue: getAgentTaskQueue() },
    { name: "subagent-tasks", queue: getSubagentTaskQueue() },
    { name: "monitoring", queue: getMonitoringQueue() },
    { name: "briefings", queue: getBriefingQueue() },
    { name: "notifications", queue: getNotificationQueue() },
    { name: "pipelines", queue: getPipelineQueue() },
    { name: "rag-ingestion", queue: getRagIngestionQueue() },
    { name: "reflections", queue: getReflectionQueue() },
    { name: "autonomous-sessions", queue: getAutonomousSessionQueue() },
  ];

  const now = Date.now();
  const results: StaleJobCount[] = [];

  for (const { name, queue } of queues) {
    try {
      const activeJobs = await queue.getActive();
      const staleCount = activeJobs.filter(
        (job) => job.processedOn && now - job.processedOn > thresholdMs,
      ).length;
      if (staleCount > 0) {
        results.push({ name, staleCount });
      }
    } catch {
      // Queue not available — skip
    }
  }

  return results;
}
