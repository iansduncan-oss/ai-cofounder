// Connection
export { getRedisConnection, resetRedisConnection } from "./connection.js";

// Pub/Sub (Redis pub/sub for real-time agent progress events)
export {
  RedisPubSub,
  createSubscriber,
  goalChannel,
  historyKey,
  CHANNEL_PREFIX,
  HISTORY_PREFIX,
  HISTORY_TTL_SECONDS,
  type AgentProgressEvent,
  type AgentLifecycleEvent,
  type AgentEvent,
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
  closeAllQueues,
  type AgentTaskJob,
  type MonitoringJob,
  type BriefingJob,
  type NotificationJob,
  type PipelineJob,
  type PipelineStage,
  type RagIngestionJob,
  getReflectionQueue,
  getDeadLetterQueue,
  type ReflectionJob,
  type DeadLetterJob,
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
  getAllQueueStatus,
  getJobStatus,
  pingRedis,
  sendToDeadLetter,
  listDeadLetterJobs,
  retryDeadLetterJob,
  deleteDeadLetterJob,
  type QueueStatus,
  type JobStatusResult,
  type DeadLetterEntry,
} from "./helpers.js";
