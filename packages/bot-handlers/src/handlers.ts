import type { ApiClient } from "@ai-cofounder/api-client";
import type {
  CommandContext,
  HandlerResult,
} from "./types.js";

export const STATUS_ICON: Record<string, string> = {
  draft: "📝",
  active: "🔵",
  completed: "✅",
  cancelled: "❌",
  failed: "❌",
  in_progress: "🔵",
  awaiting_approval: "⏳",
};

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

export async function handleAsk(
  client: ApiClient,
  ctx: CommandContext,
  message: string,
): Promise<HandlerResult> {
  try {
    let conversationId: string | undefined;
    try {
      const mapping = await client.getChannelConversation(ctx.channelId);
      conversationId = mapping.conversationId;
    } catch {
      // No existing conversation
    }

    const result = await client.runAgent({
      message,
      userId: ctx.userId,
      platform: ctx.platform,
      conversationId,
    });

    try {
      await client.setChannelConversation(ctx.channelId, result.conversationId, ctx.platform);
    } catch {
      // Non-fatal — conversation mapping persistence failure
    }

    return {
      type: "ask",
      data: {
        response: result.response,
        agentRole: result.agentRole,
        model: result.model,
        usage: result.usage,
        conversationId: result.conversationId,
      },
    };
  } catch {
    return { type: "error", message: "Something went wrong talking to the AI Cofounder. Is the agent server running?" };
  }
}

export async function handleAskStreaming(
  client: ApiClient,
  ctx: CommandContext,
  message: string,
  onChunk: (text: string) => void | Promise<void>,
): Promise<HandlerResult> {
  try {
    let conversationId: string | undefined;
    try {
      const mapping = await client.getChannelConversation(ctx.channelId);
      conversationId = mapping.conversationId;
    } catch {
      // No existing conversation
    }

    let accumulated = "";
    let model: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let resultConversationId = conversationId ?? "";

    const stream = client.streamChat({
      message,
      userId: ctx.userId,
      platform: ctx.platform,
      conversationId,
    });

    for await (const event of stream) {
      if (event.type === "text_delta" && typeof event.data.text === "string") {
        accumulated += event.data.text;
        await onChunk(accumulated);
      } else if (event.type === "done") {
        if (typeof event.data.response === "string") accumulated = event.data.response;
        if (typeof event.data.model === "string") model = event.data.model;
        if (event.data.usage) usage = event.data.usage as { inputTokens: number; outputTokens: number };
        if (typeof event.data.conversationId === "string") resultConversationId = event.data.conversationId;
      } else if (event.type === "error") {
        return { type: "error", message: String(event.data.error ?? "Stream error") };
      }
    }

    try {
      if (resultConversationId) {
        await client.setChannelConversation(ctx.channelId, resultConversationId, ctx.platform);
      }
    } catch {
      // Non-fatal
    }

    return {
      type: "ask_streaming",
      data: {
        response: accumulated,
        agentRole: "orchestrator",
        model,
        usage,
        conversationId: resultConversationId,
      },
    };
  } catch {
    return { type: "error", message: "Something went wrong talking to the AI Cofounder. Is the agent server running?" };
  }
}

export async function handleStatus(client: ApiClient): Promise<HandlerResult> {
  try {
    const health = await client.health();
    return {
      type: "status",
      data: {
        status: health.status,
        uptimeMinutes: Math.floor(health.uptime / 60),
      },
    };
  } catch {
    return { type: "error", message: "Agent server unreachable." };
  }
}

export async function handleGoals(client: ApiClient, ctx: CommandContext): Promise<HandlerResult> {
  try {
    let conversationId: string;
    try {
      const mapping = await client.getChannelConversation(ctx.channelId);
      conversationId = mapping.conversationId;
    } catch {
      return { type: "info", message: "No conversation in this channel yet. Use `/ask` first." };
    }

    const result = await client.listGoals(conversationId);
    const goals = result.data;

    if (goals.length === 0) {
      return { type: "info", message: "No goals yet for this channel." };
    }

    return {
      type: "goals",
      data: {
        goals: goals.map((g) => ({
          title: g.title,
          status: g.status,
          priority: g.priority,
          icon: STATUS_ICON[g.status] ?? "⚪",
        })),
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch goals." };
  }
}

export async function handleTasks(client: ApiClient): Promise<HandlerResult> {
  try {
    const tasks = await client.listPendingTasks();

    if (tasks.length === 0) {
      return { type: "info", message: "No pending tasks." };
    }

    return {
      type: "tasks",
      data: {
        tasks: tasks.slice(0, 15).map((t) => ({
          title: t.title,
          assignedAgent: t.assignedAgent ?? "unassigned",
        })),
        totalCount: tasks.length,
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch tasks." };
  }
}

export async function handleMemory(
  client: ApiClient,
  ctx: CommandContext,
): Promise<HandlerResult> {
  try {
    let userId: string;
    try {
      const user = await client.getUserByPlatform(ctx.platform, ctx.userId);
      userId = user.id;
    } catch {
      return { type: "info", message: "I don't have any memories of you yet. Start a conversation with `/ask` first!" };
    }

    const result = await client.listMemories(userId);
    const memories = result.data;

    if (memories.length === 0) {
      return {
        type: "info",
        message: "I know who you are, but I haven't saved any memories yet. Chat with me via `/ask` and I'll start remembering!",
      };
    }

    const grouped = new Map<string, Array<{ key: string; content: string }>>();
    for (const m of memories) {
      const list = grouped.get(m.category) ?? [];
      list.push({ key: m.key, content: m.content });
      grouped.set(m.category, list);
    }

    return {
      type: "memory",
      data: {
        sections: [...grouped.entries()].map(([category, items]) => ({ category, items })),
        totalCount: memories.length,
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch memories." };
  }
}

export async function handleClear(client: ApiClient, ctx: CommandContext): Promise<HandlerResult> {
  try {
    await client.deleteChannelConversation(ctx.channelId);
    return { type: "clear" };
  } catch {
    return { type: "error", message: "Failed to clear conversation." };
  }
}

export async function handleExecute(
  client: ApiClient,
  ctx: CommandContext,
  goalId: string,
): Promise<HandlerResult> {
  try {
    const data = await client.executeGoal(goalId, { userId: ctx.userId });

    return {
      type: "execute",
      data: {
        goalTitle: data.goalTitle,
        status: data.status,
        completedTasks: data.completedTasks,
        totalTasks: data.totalTasks,
        tasks: data.tasks.map((t) => ({
          title: t.title,
          agent: t.agent,
          status: t.status,
          icon: STATUS_ICON[t.status] ?? "⚪",
        })),
      },
    };
  } catch {
    return { type: "error", message: `Failed to execute goal: ${goalId}` };
  }
}

export async function handleExecuteStreaming(
  client: ApiClient,
  ctx: CommandContext,
  goalId: string,
  onProgress: (text: string) => void | Promise<void>,
): Promise<HandlerResult> {
  try {
    let completedCount = 0;
    let totalCount = 0;
    let goalTitle = "";
    const taskStatuses: Array<{ title: string; agent: string; status: string; icon: string }> = [];

    const stream = client.streamExecute(goalId, { userId: ctx.userId });

    for await (const event of stream) {
      if (event.type === "started") {
        await onProgress("Starting execution...");
      } else if (event.type === "progress") {
        const d = event.data as Record<string, unknown>;
        const taskTitle = String(d.taskTitle ?? d.title ?? "");
        const agent = String(d.agent ?? "");
        const status = String(d.status ?? "running");
        goalTitle = String(d.goalTitle ?? goalTitle);
        totalCount = Number(d.totalTasks ?? totalCount);
        completedCount = Number(d.completedTasks ?? completedCount);

        const icon = STATUS_ICON[status] ?? "\u26aa";
        taskStatuses.push({ title: taskTitle, agent, status, icon });

        const lines = taskStatuses
          .map((t) => `${t.icon} ${t.title} (${t.agent})`)
          .join("\n");
        await onProgress(`**Executing:** ${goalTitle}\n${completedCount}/${totalCount} tasks\n\n${lines}`);
      } else if (event.type === "completed") {
        const d = event.data as Record<string, unknown>;
        return {
          type: "execute",
          data: {
            goalTitle: String(d.goalTitle ?? goalTitle),
            status: String(d.status ?? "completed"),
            completedTasks: Number(d.completedTasks ?? completedCount),
            totalTasks: Number(d.totalTasks ?? totalCount),
            tasks: taskStatuses,
          },
        };
      } else if (event.type === "error") {
        return { type: "error", message: `Execution failed: ${String(event.data.error ?? "unknown")}` };
      }
    }

    return {
      type: "execute",
      data: {
        goalTitle,
        status: "completed",
        completedTasks: completedCount,
        totalTasks: totalCount,
        tasks: taskStatuses,
      },
    };
  } catch {
    return { type: "error", message: `Failed to execute goal: ${goalId}` };
  }
}

export async function handleApprove(
  client: ApiClient,
  ctx: CommandContext,
  approvalId: string,
): Promise<HandlerResult> {
  try {
    await client.resolveApproval(approvalId, {
      status: "approved",
      decision: `Approved by ${ctx.userName} via ${ctx.platform}`,
    });

    return { type: "approve", data: { approvalId } };
  } catch {
    return { type: "error", message: `Failed to approve: ${approvalId}` };
  }
}

export async function handleReject(
  client: ApiClient,
  ctx: CommandContext,
  approvalId: string,
): Promise<HandlerResult> {
  try {
    await client.resolveApproval(approvalId, {
      status: "rejected",
      decision: `Rejected by ${ctx.userName} via ${ctx.platform}`,
    });

    return { type: "reject", data: { approvalId } };
  } catch {
    return { type: "error", message: `Failed to reject: ${approvalId}` };
  }
}

const COMMAND_LIST = [
  { name: "/ask", description: "Ask the AI Cofounder a question" },
  { name: "/status", description: "Check system health and uptime" },
  { name: "/goals", description: "List goals for this channel" },
  { name: "/tasks", description: "List pending tasks" },
  { name: "/memory", description: "Show your stored memories" },
  { name: "/clear", description: "Clear conversation in this channel" },
  { name: "/execute", description: "Execute a goal by ID" },
  { name: "/approve", description: "Approve a pending approval" },
  { name: "/schedule", description: "List or create scheduled tasks" },
  { name: "/register", description: "Register yourself with AI Cofounder" },
  { name: "/help", description: "Show this help message" },
];

export function handleHelp(): HandlerResult {
  return {
    type: "help",
    data: { commands: COMMAND_LIST },
  };
}

export async function handleScheduleList(client: ApiClient): Promise<HandlerResult> {
  try {
    const schedules = await client.listSchedules();

    if (schedules.length === 0) {
      return { type: "info", message: "No schedules configured. Use `/schedule create <cron> <task>` to create one." };
    }

    return {
      type: "schedule_list",
      data: {
        schedules: schedules.map((s) => ({
          id: s.id,
          cronExpression: s.cronExpression,
          description: s.description ?? s.actionPrompt,
          enabled: s.enabled,
          nextRunAt: s.nextRunAt,
        })),
        totalCount: schedules.length,
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch schedules." };
  }
}

export async function handleScheduleCreate(
  client: ApiClient,
  cronExpression: string,
  actionPrompt: string,
  userId?: string,
): Promise<HandlerResult> {
  try {
    const schedule = await client.createSchedule({
      cronExpression,
      actionPrompt,
      description: actionPrompt,
      userId,
    });

    return {
      type: "schedule_create",
      data: {
        id: schedule.id,
        cronExpression: schedule.cronExpression,
        description: schedule.description,
      },
    };
  } catch {
    return { type: "error", message: "Failed to create schedule. Check that your cron expression is valid." };
  }
}

export async function handleGmailInbox(client: ApiClient): Promise<HandlerResult> {
  try {
    const [inbox, unread] = await Promise.all([
      client.listGmailMessages({ maxResults: 10 }),
      client.getGmailUnreadCount(),
    ]);

    if (inbox.messages.length === 0) {
      return { type: "info", message: "Your inbox is empty." };
    }

    return {
      type: "gmail_inbox",
      data: {
        messages: inbox.messages.map((m) => ({
          from: m.from,
          subject: m.subject,
          date: m.date,
          isUnread: m.isUnread,
        })),
        unreadCount: unread.unreadCount,
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch Gmail inbox. Is your Google account connected?" };
  }
}

export async function handleGmailSend(
  client: ApiClient,
  input: { to: string; subject: string; body: string },
): Promise<HandlerResult> {
  try {
    await client.sendGmailMessage(input);
    return {
      type: "gmail_send",
      data: { to: input.to, subject: input.subject },
    };
  } catch {
    return { type: "error", message: "Failed to send email. Is your Google account connected?" };
  }
}

export async function handleRegister(
  client: ApiClient,
  ctx: CommandContext,
): Promise<HandlerResult> {
  try {
    let isNew = true;
    try {
      await client.getUserByPlatform(ctx.platform, ctx.userId);
      isNew = false;
    } catch {
      // 404 means new user
    }

    const user = await client.registerUser(ctx.platform, ctx.userId, ctx.userName);
    return {
      type: "register",
      data: { userId: user.id, displayName: user.displayName, isNew },
    };
  } catch {
    return { type: "error", message: "Failed to register. Please try again later." };
  }
}

export async function handleListApprovals(client: ApiClient): Promise<HandlerResult> {
  try {
    const approvals = await client.listPendingApprovals();

    if (approvals.length === 0) {
      return { type: "info", message: "No pending approvals." };
    }

    return {
      type: "approvals",
      data: {
        approvals: approvals.map((a) => ({
          id: a.id,
          taskId: a.taskId,
          requestedBy: a.requestedBy,
          reason: a.reason,
          createdAt: a.createdAt,
        })),
        totalCount: approvals.length,
      },
    };
  } catch {
    return { type: "error", message: "Failed to fetch pending approvals." };
  }
}
