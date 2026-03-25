/* ── API response types ── */

import type { AgentRole, GoalStatus, GoalScope } from "@ai-cofounder/shared";
export type { AgentRole, GoalStatus, GoalScope } from "@ai-cofounder/shared";
export type GoalPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "cancelled" | "blocked";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Goal {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  status: GoalStatus;
  priority: GoalPriority;
  scope?: GoalScope;
  requiresApproval?: boolean;
  createdBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedAgent?: AgentRole;
  orderIndex: number;
  dependsOn?: string[] | null;
  input?: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  taskId: string;
  requestedBy: AgentRole;
  status: ApprovalStatus;
  reason: string;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface Memory {
  id: string;
  userId: string;
  category: string;
  key: string;
  content: string;
  importance: number;
  accessCount: number;
  source?: string;
  agentRole?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  uptime: number;
  error?: string;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  recentErrors: Array<{ time: string; message: string }>;
  lastSuccessAt?: string;
  lastErrorAt?: string;
}

export interface AgentRunResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  plan?: {
    goalId: string;
    goalTitle: string;
    tasks: Array<{ id: string; title: string; assignedAgent: AgentRole; orderIndex: number }>;
  };
  suggestions?: string[];
}

export interface ExecutionProgress {
  goalId: string;
  goalTitle: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  currentTask?: { id: string; title: string; agent: string; status: string };
  tasks: Array<{ id: string; title: string; agent: string; status: string; output?: string }>;
}

/* ── Streaming ── */

export type StreamEventType =
  | "thinking" | "tool_call" | "tool_result" | "text_delta" | "done" | "error"
  | "started" | "progress" | "completed" | "suggestions" | "rich_card";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export type MilestoneStatus = "planned" | "in_progress" | "completed" | "cancelled";

export interface Milestone {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  orderIndex: number;
  dueDate?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneProgress {
  milestoneId: string;
  totalGoals: number;
  completedGoals: number;
  totalTasks: number;
  completedTasks: number;
  percentComplete: number;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  permissions?: string;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface Schedule {
  id: string;
  cronExpression: string;
  actionPrompt: string;
  description?: string;
  userId?: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageSummary {
  period: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  requestCount: number;
}

/* ── Pagination ── */

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/* ── Events ── */

export interface Event {
  id: string;
  source: string;
  type: string;
  payload: unknown;
  processed: boolean;
  result?: string;
  createdAt: string;
}

/* ── Briefing ── */

export interface BriefingResponse {
  sent: boolean;
  briefing: string;
  data?: {
    activeGoals: Array<{ title: string; priority: string; progress: string }>;
    completedYesterday: Array<{ title: string }>;
    taskBreakdown: Record<string, number>;
    costsSinceYesterday: { totalCostUsd: number; requestCount: number };
    upcomingSchedules: Array<{ description: string; nextRunAt: string | null }>;
    recentSessions: Array<{ trigger: string; status: string; summary: string | null }>;
  };
}

/* ── Conversations ── */

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "agent" | "system";
  agentRole?: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/* ── Dashboard ── */

export interface GoalSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  completedTaskCount: number;
}

export interface DashboardSummary {
  goals: {
    activeCount: number;
    recent: GoalSummary[];
  };
  tasks: {
    pendingCount: number;
    runningCount: number;
    completedCount: number;
    failedCount: number;
  };
  providerHealth: ProviderHealth[];
  costs: {
    today: number;
    week: number;
    month: number;
  };
  recentEvents: Event[];
}

/* ── Monitoring ── */

export interface MonitoringReport {
  timestamp: string;
  github?: {
    ciStatus: GitHubCIStatus[];
    openPRs: GitHubPR[];
  };
  vps?: VPSHealthStatus;
  alerts: MonitoringAlert[];
}

export interface GitHubCIStatus {
  repo: string;
  branch: string;
  status: "success" | "failure" | "pending" | "error";
  conclusion: string | null;
  url: string;
  updatedAt: string;
}

export interface GitHubPR {
  repo: string;
  number: number;
  title: string;
  author: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface VPSHealthStatus {
  diskUsagePercent: number;
  memoryUsagePercent: number;
  cpuLoadAvg: number[];
  uptime: string;
  containers: ContainerStatus[];
}

export interface ContainerStatus {
  name: string;
  status: string;
  health?: string;
}

export interface MonitoringAlert {
  severity: "critical" | "warning" | "info";
  source: string;
  message: string;
}

/* ── Queue ── */

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/* ── Tool Stats ── */

export interface ToolStat {
  toolName: string;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

/* ── Persona ── */

export interface Persona {
  id: string;
  name: string;
  voiceId: string | null;
  corePersonality: string;
  capabilities: string | null;
  behavioralGuidelines: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPersonaInput {
  id?: string;
  name: string;
  voiceId?: string;
  corePersonality: string;
  capabilities?: string;
  behavioralGuidelines?: string;
  isActive?: boolean;
}

/* ── Pipelines ── */

export type PipelineRunState = "waiting" | "active" | "completed" | "failed" | "delayed";

export type PipelineAgentRole = "planner" | "coder" | "reviewer" | "debugger" | "researcher";

export interface PipelineStageDefinition {
  agent: PipelineAgentRole;
  prompt: string;
  dependsOnPrevious: boolean;
}

export interface PipelineStageResult {
  stageIndex: number;
  agent: string;
  status: "completed" | "failed" | "skipped";
  output?: string;
  error?: string;
}

export interface PipelineResult {
  pipelineId: string;
  goalId: string;
  status: "completed" | "failed" | "partial";
  stageResults: PipelineStageResult[];
}

export interface PipelineRun {
  jobId: string;
  pipelineId: string;
  goalId: string;
  stageCount: number;
  state: PipelineRunState;
  createdAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
  result: PipelineResult | null;
}

export interface PipelineDetail {
  jobId: string;
  pipelineId: string;
  goalId: string;
  stages: PipelineStageDefinition[];
  currentStage: number;
  context: Record<string, unknown>;
  state: PipelineRunState;
  createdAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
  result: PipelineResult | null;
}

export interface SubmitPipelineInput {
  goalId: string;
  stages: PipelineStageDefinition[];
  context?: Record<string, unknown>;
}

export interface SubmitPipelineResponse {
  jobId: string;
  status: string;
  stageCount: number;
}

export interface CancelPipelineResponse {
  cancelled: boolean;
}

export interface RetryPipelineResponse {
  jobId: string;
  status: string;
  stageCount: number;
}

/* ── Subagents ── */

export type SubagentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentRun {
  id: string;
  parentRequestId: string | null;
  conversationId: string | null;
  goalId: string | null;
  title: string;
  instruction: string;
  status: SubagentRunStatus;
  output: string | null;
  error: string | null;
  toolRounds: number;
  toolsUsed: string[] | null;
  tokens: number;
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  userId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpawnSubagentInput {
  title: string;
  instruction: string;
  conversationId?: string;
  goalId?: string;
  userId?: string;
  priority?: "critical" | "high" | "normal" | "low";
}

export interface SpawnSubagentResponse {
  subagentRunId: string;
  status: string;
  title: string;
}

/* ── Agent Messages ── */

export type AgentMessageType = "request" | "response" | "broadcast" | "notification" | "handoff";
export type AgentMessageStatus = "pending" | "delivered" | "read" | "expired";

/* ── Agent Info ── */

export interface AgentRoleInfo {
  role: AgentRole;
  description: string;
}

export interface AgentCapability {
  role: AgentRole;
  description: string;
  tools: string[];
  specialties: string[];
}

export interface UserPattern {
  id: string;
  userId: string | null;
  patternType: string;
  description: string;
  triggerCondition: Record<string, unknown>;
  suggestedAction: string;
  confidence: number;
  hitCount: number;
  acceptCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Pattern Analytics ── */

export interface PatternAnalyticsItem {
  id: string;
  description: string;
  pattern_type: string;
  confidence: number;
  hit_count: number;
  accept_count: number;
  accept_rate: number;
}

export interface PatternAnalytics {
  totalPatterns: number;
  activePatterns: number;
  totalHits: number;
  totalAccepts: number;
  overallAcceptRate: number;
  avgConfidence: number;
  byType: Record<string, number>;
  patterns: UserPattern[];
  perPattern?: PatternAnalyticsItem[];
  typeDistribution?: Array<{ pattern_type: string; count: number }>;
  topByConfidence?: Array<{ id: string; description: string; confidence: number }>;
  heatmap?: Array<{ day_of_week: number; hour_of_day: number; count: number }>;
}

/* ── Dead Letter Queue ── */

export interface DeadLetterEntry {
  dlqJobId: string;
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

export type AutonomyTier = "green" | "yellow" | "red";

export interface ToolTierConfig {
  toolName: string;
  tier: AutonomyTier;
  timeoutMs: number;
  updatedBy: string | null;
  updatedAt: string;
}

/* ── Autonomous Execution ── */

export interface GoalBacklogItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  pendingTaskCount: number;
}

export interface AutonomousRunResponse {
  jobId: string;
  status: "queued";
  goalId: string;
}

/* ── Deployments ── */

export type DeployStatus = "started" | "building" | "deploying" | "verifying" | "healthy" | "failed" | "rolled_back";

export interface Deployment {
  id: string;
  commitSha: string;
  shortSha: string;
  branch: string;
  status: DeployStatus;
  services: string[] | null;
  previousSha: string | null;
  triggeredBy: string;
  healthChecks: unknown | null;
  errorLog: string | null;
  rootCauseAnalysis: string | null;
  rolledBack: boolean;
  rollbackSha: string | null;
  soakStatus?: string;
  soakMetrics?: unknown;
  remediationActions?: unknown;
  gitDiffSummary?: string;
  startedAt: string;
  completedAt: string | null;
}

/* ── Circuit Breaker ── */

export interface DeployCircuitBreakerStatus {
  isPaused: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  failureCount: number;
  failureWindowStart: string | null;
  resumedAt: string | null;
  resumedBy: string | null;
}

/* ── Session Engagement ── */

export interface SessionEngagement {
  id: string;
  userId: string;
  sessionStart: string;
  messageCount: number;
  avgMessageLength: number;
  avgResponseIntervalMs: number;
  complexityScore: number;
  energyLevel: string;
  lastMessageAt: string | null;
}

/* ── Context ── */

export interface WorkFocus {
  recentActions: Array<{ actionType: string; count: number }>;
  activeGoals: Array<{ id: string; title: string }>;
}

/* ── Work Sessions ── */

export interface WorkSession {
  id: string;
  trigger: string;
  scheduleId: string | null;
  eventId: string | null;
  goalId: string | null;
  status: "running" | "completed" | "failed" | "timeout" | "skipped" | "aborted";
  tokensUsed: number | null;
  durationMs: number | null;
  actionsTaken: Record<string, unknown> | null;
  summary: string | null;
  context: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

/* ── Journal ── */

export type JournalEntryType =
  | "goal_started" | "goal_completed" | "goal_failed"
  | "task_completed" | "task_failed"
  | "git_commit" | "pr_created"
  | "reflection" | "work_session" | "subagent_run" | "deployment"
  | "content_pipeline";

export interface JournalEntry {
  id: string;
  entryType: JournalEntryType;
  goalId: string | null;
  taskId: string | null;
  workSessionId: string | null;
  title: string;
  summary: string | null;
  details: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
}

export interface StandupData {
  date: string;
  entryCounts: Record<string, number>;
  highlights: string[];
  totalEntries: number;
  costUsd: number;
}

export interface StandupResponse {
  date: string;
  narrative: string;
  data: StandupData;
}

/* ── Financial Tracking ── */

export interface DailyCostDay {
  date: string; // "2026-03-14"
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface DailyCostResponse {
  days: DailyCostDay[];
}

export interface BudgetStatusResponse {
  daily: { spentUsd: number; limitUsd: number; percentUsed: number | null };
  weekly: { spentUsd: number; limitUsd: number; percentUsed: number | null };
  optimizationSuggestions: string[];
}

export interface GoalCostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
}

export interface TopExpensiveGoal {
  goalId: string;
  goalTitle: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
}

export interface AgentMessageItem {
  id: string;
  senderRole: string;
  senderRunId: string | null;
  targetRole: string | null;
  targetRunId: string | null;
  channel: string | null;
  messageType: AgentMessageType;
  subject: string;
  body: string;
  correlationId: string | null;
  inReplyTo: string | null;
  goalId: string | null;
  taskId: string | null;
  conversationId: string | null;
  status: AgentMessageStatus;
  priority: string;
  expiresAt: string | null;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/* ── Registered Projects ── */

export type ProjectLanguage = "typescript" | "python" | "javascript" | "go" | "other";

export interface RegisteredProject {
  id: string;
  name: string;
  slug: string;
  workspacePath: string;
  repoUrl?: string | null;
  description?: string | null;
  language: ProjectLanguage;
  defaultBranch: string;
  testCommand?: string | null;
  isActive: boolean;
  config?: Record<string, unknown> | null;
  lastIngestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDependency {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  dependencyType: string;
  description?: string | null;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  workspacePath: string;
  repoUrl?: string;
  description?: string;
  language?: ProjectLanguage;
  defaultBranch?: string;
  testCommand?: string;
  config?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  workspacePath?: string;
  repoUrl?: string | null;
  description?: string | null;
  language?: ProjectLanguage;
  defaultBranch?: string;
  testCommand?: string | null;
  isActive?: boolean;
  config?: Record<string, unknown> | null;
}

export interface CreateProjectDependencyInput {
  targetProjectId: string;
  dependencyType: string;
  description?: string;
}

/* ── Gmail ── */

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  hasAttachments: boolean;
  labels: string[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  bodyHtml: string;
  date: string;
  isUnread: boolean;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
  labels: string[];
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
  subject: string;
  participants: string[];
  messageCount: number;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  inReplyTo?: string;
  threadId?: string;
}

/* ── Calendar ── */

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  status: string;
  attendeeCount: number;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: string;
  htmlLink: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus: string;
    self?: boolean;
  }>;
  organizer?: { email: string; displayName?: string; self?: boolean };
  created: string;
  updated: string;
}

export interface CreateCalendarEventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export interface UpdateCalendarEventInput {
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export interface FreeBusyResponse {
  timeMin: string;
  timeMax: string;
  busy: Array<{ start: string; end: string }>;
}

/* ── Meeting Prep ── */

export interface MeetingPrepResponse {
  eventId: string;
  eventTitle: string;
  prepText: string;
  attendees: unknown;
  relatedMemories: unknown;
  generatedAt: string;
}

/* ── Briefing ── */

export interface BriefingSections {
  todaySchedule?: string;
  emailHighlights?: string;
  goals?: string;
  tasks?: string;
  costs?: string;
}

export interface TodayBriefingResponse {
  date: string;
  text: string;
  sections: BriefingSections | null;
  cached: boolean;
}

/* ── Follow-Ups ── */

export type FollowUpStatus = "pending" | "done" | "dismissed";

export interface FollowUp {
  id: string;
  title: string;
  description?: string | null;
  status: FollowUpStatus;
  dueDate?: string | null;
  source?: string | null;
  reminderSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFollowUpInput {
  title: string;
  description?: string;
  dueDate?: string;
  source?: string;
}

export interface UpdateFollowUpInput {
  title?: string;
  description?: string;
  status?: FollowUpStatus;
  dueDate?: string | null;
  source?: string;
}

/* ── App Settings ── */

export interface AppSettings {
  dailyBudgetUsd: number;
  weeklyBudgetUsd: number;
}

export interface UpdateBudgetInput {
  dailyUsd: number;
  weeklyUsd: number;
}

/* ── Global Search ── */

export interface GlobalSearchResults {
  goals: Array<{ id: string; title: string; description: string | null; status: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; status: string; goalId: string; createdAt: string }>;
  conversations: Array<{ id: string; title: string | null; createdAt: string }>;
  memories: Array<{ id: string; key: string; content: string; category: string; createdAt: string }>;
}
