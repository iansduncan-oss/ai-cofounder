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

    const goals = await client.listGoals(conversationId);

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

    const memories = await client.listMemories(userId);

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
