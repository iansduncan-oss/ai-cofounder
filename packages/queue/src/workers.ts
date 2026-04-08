import { Worker, type Job } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";
import { getRedisConnection } from "./connection.js";
import {
  QUEUE_NAMES,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
  type RagIngestionJob,
  type ReflectionJob,
  type SubagentTaskJob,
  type DeployVerificationJob,
  type AutonomousSessionJob,
  type MeetingPrepJob,
  type DiscordTriageJob,
} from "./queues.js";
import { sendToDeadLetter } from "./helpers.js";

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
export type RagIngestionProcessor = (job: Job<RagIngestionJob>) => Promise<void>;
export type ReflectionProcessor = (job: Job<ReflectionJob>) => Promise<void>;
export type SubagentTaskProcessor = (job: Job<SubagentTaskJob>) => Promise<void>;
export type DeployVerificationProcessor = (job: Job<DeployVerificationJob>) => Promise<void>;
export type AutonomousSessionProcessor = (job: Job<AutonomousSessionJob>) => Promise<void>;
export type MeetingPrepProcessor = (job: Job<MeetingPrepJob>) => Promise<void>;
export type DiscordTriageProcessor = (job: Job<DiscordTriageJob>) => Promise<void>;

export interface WorkerProcessors {
  agentTask?: AgentTaskProcessor;
  monitoring?: MonitoringProcessor;
  briefing?: BriefingProcessor;
  notification?: NotificationProcessor;
  pipeline?: PipelineProcessor;
  ragIngestion?: RagIngestionProcessor;
  reflection?: ReflectionProcessor;
  subagentTask?: SubagentTaskProcessor;
  deployVerification?: DeployVerificationProcessor;
  autonomousSession?: AutonomousSessionProcessor;
  meetingPrep?: MeetingPrepProcessor;
  discordTriage?: DiscordTriageProcessor;
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

  if (processors.ragIngestion) {
    const worker = new Worker<RagIngestionJob>(
      QUEUE_NAMES.RAG_INGESTION,
      processors.ragIngestion,
      {
        connection,
        concurrency: 2,
        lockDuration: 300_000, // 5 min — ingestion can be slow for large repos
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.RAG_INGESTION);
    activeWorkers.push(worker);
  }

  if (processors.reflection) {
    const worker = new Worker<ReflectionJob>(
      QUEUE_NAMES.REFLECTIONS,
      processors.reflection,
      {
        connection,
        concurrency: 1, // LLM-intensive — one at a time
        lockDuration: 300_000, // 5 min — LLM reflection can be slow
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.REFLECTIONS);
    activeWorkers.push(worker);
  }

  if (processors.subagentTask) {
    const worker = new Worker<SubagentTaskJob>(
      QUEUE_NAMES.SUBAGENT_TASKS,
      processors.subagentTask,
      {
        connection,
        concurrency: 3,              // up to 3 subagents in parallel
        lockDuration: 900_000,       // 15 min — subagents run extended tool loops
        stalledInterval: 60_000,     // check stalls every 60s
        maxStalledCount: 1,
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.SUBAGENT_TASKS);
    activeWorkers.push(worker);
  }

  if (processors.deployVerification) {
    const worker = new Worker<DeployVerificationJob>(
      QUEUE_NAMES.DEPLOY_VERIFICATION,
      processors.deployVerification,
      {
        connection,
        concurrency: 1,
        lockDuration: 300_000, // 5 min — health checks + rollback can be slow
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.DEPLOY_VERIFICATION);
    activeWorkers.push(worker);
  }

  if (processors.autonomousSession) {
    const worker = new Worker<AutonomousSessionJob>(
      QUEUE_NAMES.AUTONOMOUS_SESSIONS,
      processors.autonomousSession,
      {
        connection,
        concurrency: 1,              // one autonomous session at a time
        lockDuration: 1_800_000,     // 30 min — sessions can be long-running
        stalledInterval: 60_000,     // check stalls every 60s
        maxStalledCount: 1,          // re-queue once if stalled, then fail
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.AUTONOMOUS_SESSIONS);
    activeWorkers.push(worker);
  }

  if (processors.meetingPrep) {
    const worker = new Worker<MeetingPrepJob>(
      QUEUE_NAMES.MEETING_PREP,
      processors.meetingPrep,
      {
        connection,
        concurrency: 1,
        lockDuration: 300_000, // 5 min — LLM-intensive
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.MEETING_PREP);
    activeWorkers.push(worker);
  }

  if (processors.discordTriage) {
    const worker = new Worker<DiscordTriageJob>(
      QUEUE_NAMES.DISCORD_TRIAGE,
      processors.discordTriage,
      {
        connection,
        concurrency: 2,              // can triage multiple channels in parallel
        lockDuration: 660_000,       // 11 min — 5 min session budget + 6 min headroom for triage + overhead
      },
    );
    attachWorkerEvents(worker, QUEUE_NAMES.DISCORD_TRIAGE);
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

    // Send to DLQ if all retries exhausted
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      sendToDeadLetter(
        queueName,
        job.id ?? "unknown",
        job.name,
        job.data,
        err?.message ?? "Unknown error",
        job.attemptsMade,
      ).catch((dlqErr) => {
        logger.error({ dlqErr, jobId: job.id }, "Failed to send job to DLQ");
      });
    }
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
