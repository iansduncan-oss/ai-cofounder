import { Worker, Job } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";
import { getRedisConnection } from "./connection.js";
import {
  QUEUE_NAMES,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
} from "./queues.js";

const logger = createLogger("queue-workers");

// ── Worker processor types ──
// These are the function signatures that consumers must provide.
// The agent-server will register actual implementations at startup.

export type AgentTaskProcessor = (job: Job<AgentTaskJob>) => Promise<void>;
export type MonitoringProcessor = (job: Job<MonitoringJob>) => Promise<void>;
export type BriefingProcessor = (job: Job<BriefingJob>) => Promise<void>;
export type NotificationProcessor = (
  job: Job<NotificationJob>,
) => Promise<void>;
export type PipelineProcessor = (job: Job<PipelineJob>) => Promise<void>;

export interface WorkerProcessors {
  agentTask?: AgentTaskProcessor;
  monitoring?: MonitoringProcessor;
  briefing?: BriefingProcessor;
  notification?: NotificationProcessor;
  pipeline?: PipelineProcessor;
}

const activeWorkers: Worker[] = [];

/**
 * Starts BullMQ workers for all registered processors.
 * Call at server startup with the actual processing functions.
 */
export function startWorkers(processors: WorkerProcessors): void {
  const connection = getRedisConnection();

  if (processors.agentTask) {
    const worker = new Worker<AgentTaskJob>(
      QUEUE_NAMES.AGENT_TASKS,
      processors.agentTask,
      {
        connection,
        concurrency: 1,              // one agent task at a time (LLM-intensive)
        lockDuration: 600_000,       // 10 minutes — prevents false stall on long agent tasks
        stalledInterval: 30_000,     // check stalls every 30s
        maxStalledCount: 1,          // re-queue once if stalled, then fail
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.AGENT_TASKS);
    activeWorkers.push(worker);
  }

  if (processors.monitoring) {
    const worker = new Worker<MonitoringJob>(
      QUEUE_NAMES.MONITORING,
      processors.monitoring,
      {
        connection,
        concurrency: 4,
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.MONITORING);
    activeWorkers.push(worker);
  }

  if (processors.briefing) {
    const worker = new Worker<BriefingJob>(
      QUEUE_NAMES.BRIEFINGS,
      processors.briefing,
      {
        connection,
        concurrency: 1,
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.BRIEFINGS);
    activeWorkers.push(worker);
  }

  if (processors.notification) {
    const worker = new Worker<NotificationJob>(
      QUEUE_NAMES.NOTIFICATIONS,
      processors.notification,
      {
        connection,
        concurrency: 5,
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.NOTIFICATIONS);
    activeWorkers.push(worker);
  }

  if (processors.pipeline) {
    const worker = new Worker<PipelineJob>(
      QUEUE_NAMES.PIPELINES,
      processors.pipeline,
      {
        connection,
        concurrency: 1,
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.PIPELINES);
    activeWorkers.push(worker);
  }

  logger.info(
    { workerCount: activeWorkers.length },
    "Queue workers started",
  );
}

function attachWorkerEvents(worker: Worker, queueName: string): void {
  worker.on("completed", (job) => {
    logger.info({ jobId: job?.id, queue: queueName }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, queue: queueName, err },
      "Job failed",
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId, queue: queueName }, "Job stalled");
  });
}

export async function stopWorkers(): Promise<void> {
  const closers = activeWorkers.map((w) => w.close());
  await Promise.all(closers);
  activeWorkers.length = 0;
  logger.info("All queue workers stopped");
}
