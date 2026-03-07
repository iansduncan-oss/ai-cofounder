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
  workspace: {
    tree: (path: string) => ["workspace", "tree", path] as const,
    file: (path: string) => ["workspace", "file", path] as const,
  },
  usage: {
    summary: (period?: string) => ["usage", period ?? "all"] as const,
  },
};
