// Connection
export { getRedisConnection, resetRedisConnection } from "./connection.js";

// Pub/Sub (Redis pub/sub for real-time agent progress events)
export {
  RedisPubSub,
  createSubscriber,
  goalChannel,
  historyKey,
  subagentChannel,
  subagentHistoryKey,
  CHANNEL_PREFIX,
  HISTORY_PREFIX,
  SUBAGENT_CHANNEL_PREFIX,
  SUBAGENT_HISTORY_PREFIX,
  HISTORY_TTL_SECONDS,
  type AgentProgressEvent,
  type AgentLifecycleEvent,
  type SubagentProgressEvent,
  type AgentEvent,
  type AgentMessageEvent,
  AGENT_MSG_PREFIX,
  AGENT_BROADCAST_PREFIX,
} from "./pubsub.js";

// Queues & job types
export {
  QUEUE_NAMES,
  getAgentTaskQueue,
  getMonitoringQueue,
  getBriefingQueue,
  getNotificationQueue,
  getPipelineQueue,
  getRagIngestionQueue,
  getSubagentTaskQueue,
  getAutonomousSessionQueue,
  closeAllQueues,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
  type PipelineStage,
  type RagIngestionJob,
  getReflectionQueue,
  getDeployVerificationQueue,
  getDeadLetterQueue,
  type ReflectionJob,
  type SubagentTaskJob,
  type DeployVerificationJob,
  type DeadLetterJob,
  type AutonomousSessionJob,
  getMeetingPrepQueue,
  getDiscordTriageQueue,
  type MeetingPrepJob,
  type DiscordTriageJob,
  type DiscordTriageMessage,
} from "./queues.js";

// Workers
export {
  startWorkers,
  stopWorkers,
  type WorkerProcessors,
  type AgentTaskProcessor,
  type MonitoringProcessor,
  type BriefingProcessor,
  type NotificationProcessor,
  type PipelineProcessor,
  type RagIngestionProcessor,
  type ReflectionProcessor,
  type SubagentTaskProcessor,
  type DeployVerificationProcessor,
  type AutonomousSessionProcessor,
  type MeetingPrepProcessor,
  type DiscordTriageProcessor,
} from "./workers.js";

// Scheduler (recurring jobs)
export { setupRecurringJobs } from "./scheduler.js";

// Helper functions
export {
  enqueueAgentTask,
  enqueueMonitoringCheck,
  enqueueBriefing,
  enqueueNotification,
  enqueuePipeline,
  enqueueRagIngestion,
  enqueueReflection,
  enqueueSubagentTask,
  enqueueMeetingPrep,
  enqueueDiscordTriage,
  enqueueAutonomousSession,
  getAllQueueStatus,
  getJobStatus,
  pingRedis,
  sendToDeadLetter,
  listDeadLetterJobs,
  retryDeadLetterJob,
  deleteDeadLetterJob,
  getStaleJobCounts,
  trimEventStreams,
  type QueueStatus,
  type JobStatusResult,
  type DeadLetterEntry,
  type StaleJobCount,
} from "./helpers.js";
