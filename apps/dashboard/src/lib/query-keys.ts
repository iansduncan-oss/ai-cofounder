export const queryKeys = {
  health: {
    status: ["health"] as const,
    providers: ["health", "providers"] as const,
  },
  goals: {
    all: ["goals"] as const,
    list: (conversationId: string) =>
      ["goals", "list", conversationId] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
    progress: (id: string) => ["goals", "progress", id] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (goalId: string) => ["tasks", "list", goalId] as const,
    pending: ["tasks", "pending"] as const,
  },
  approvals: {
    all: ["approvals"] as const,
    pending: ["approvals", "pending"] as const,
    detail: (id: string) => ["approvals", "detail", id] as const,
  },
  memories: {
    all: ["memories"] as const,
    list: (userId: string) => ["memories", "list", userId] as const,
  },
  milestones: {
    all: ["milestones"] as const,
    list: (conversationId: string) =>
      ["milestones", "list", conversationId] as const,
    detail: (id: string) => ["milestones", "detail", id] as const,
    progress: (id: string) => ["milestones", "progress", id] as const,
  },
  conversations: {
    all: ["conversations"] as const,
    list: (userId: string) => ["conversations", "list", userId] as const,
    messages: (id: string) => ["conversations", "messages", id] as const,
  },
  workspace: {
    tree: (path: string) => ["workspace", "tree", path] as const,
    file: (path: string) => ["workspace", "file", path] as const,
  },
  usage: {
    summary: (period?: string) => ["usage", period ?? "all"] as const,
    daily: (days?: number) => ["usage", "daily", days ?? 30] as const,
    budget: ["usage", "budget"] as const,
  },
  monitoring: {
    status: ["monitoring", "status"] as const,
  },
  queue: {
    status: ["queue", "status"] as const,
  },
  briefing: {
    latest: ["briefing", "latest"] as const,
  },
  tools: {
    stats: ["tools", "stats"] as const,
  },
  errors: {
    summary: (hours?: number) => ["errors", "summary", hours ?? 24] as const,
  },
  persona: {
    all: ["persona"] as const,
    active: ["persona", "active"] as const,
    list: ["persona", "list"] as const,
  },
  pipelines: {
    all: ["pipelines"] as const,
    list: ["pipelines", "list"] as const,
    detail: (jobId: string) => ["pipelines", "detail", jobId] as const,
  },
  patterns: {
    all: ["patterns"] as const,
    list: (userId?: string) => ["patterns", "list", userId ?? "all"] as const,
  },
  autonomy: {
    tiers: ["autonomy", "tiers"] as const,
  },
  autonomous: {
    all: ["autonomous"] as const,
    sessions: ["autonomous", "sessions"] as const,
  },
  journal: {
    all: ["journal"] as const,
    list: (params?: string) => ["journal", "list", params ?? ""] as const,
    standup: (date?: string) => ["journal", "standup", date ?? "today"] as const,
  },
  n8n: {
    workflows: ["n8n", "workflows"] as const,
    executions: (opts?: string) => ["n8n", "executions", opts ?? "all"] as const,
  },
  pipelineTemplates: {
    all: ["pipeline-templates"] as const,
    list: ["pipeline-templates", "list"] as const,
  },
  dlq: {
    all: ["dlq"] as const,
    list: (params?: string) => ["dlq", "list", params ?? ""] as const,
  },
  subagents: {
    all: ["subagents"] as const,
    list: (status?: string) => ["subagents", "list", status ?? "all"] as const,
  },
  dashboard: {
    summary: ["dashboard", "summary"] as const,
  },
  projects: {
    all: ["projects"] as const,
    list: ["projects", "list"] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
  },
  settings: {
    all: ["settings"] as const,
    current: ["settings", "current"] as const,
  },
};
