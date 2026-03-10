// AgentMessagingService — bidirectional messaging layer for agent-to-agent communication.
// Wraps DB persistence + optional Redis pub/sub notifications.

import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  sendAgentMessage,
  getAgentInbox,
  getChannelMessages,
  getResponseToRequest,
  getMessageThread,
  markMessagesRead,
} from "@ai-cofounder/db";
import type { RedisPubSub, AgentMessageEvent } from "@ai-cofounder/queue";

const logger = createLogger("agent-messaging");

/** TTL defaults (ms) */
const REQUEST_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BROADCAST_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface SendParams {
  senderRole: string;
  senderRunId?: string;
  targetRole?: string;
  targetRunId?: string;
  channel?: string;
  messageType: "request" | "response" | "broadcast" | "notification" | "handoff";
  subject: string;
  body: string;
  inReplyTo?: string;
  correlationId?: string;
  goalId?: string;
  taskId?: string;
  conversationId?: string;
  priority?: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface CheckInboxParams {
  targetRole: string;
  targetRunId?: string;
  correlationId?: string;
  senderRole?: string;
  messageType?: string;
  unreadOnly?: boolean;
  limit?: number;
}

export class AgentMessagingService {
  constructor(
    private db: Db,
    private redisPubSub?: RedisPubSub,
  ) {}

  /**
   * Send a message from one agent to another (or to a channel).
   * For `request` type, auto-generates a correlationId if not provided.
   * Sets TTL based on message type.
   */
  async send(params: SendParams): Promise<{ messageId: string; correlationId?: string }> {
    // Auto-generate correlationId for requests
    let correlationId = params.correlationId;
    if (params.messageType === "request" && !correlationId) {
      correlationId = crypto.randomUUID();
    }

    // Set expiry based on type
    let expiresAt: Date | undefined;
    if (params.messageType === "request") {
      expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
    } else if (params.messageType === "broadcast") {
      expiresAt = new Date(Date.now() + BROADCAST_TTL_MS);
    }

    // Check message depth to prevent infinite chains
    const depth = (params.metadata?.messageDepth as number) ?? 0;
    if (depth > 2) {
      logger.warn({ senderRole: params.senderRole, depth }, "message depth limit reached");
      return { messageId: "", correlationId };
    }

    const message = await sendAgentMessage(this.db, {
      senderRole: params.senderRole,
      senderRunId: params.senderRunId,
      targetRole: params.targetRole,
      targetRunId: params.targetRunId,
      channel: params.channel,
      messageType: params.messageType,
      subject: params.subject,
      body: params.body,
      correlationId,
      inReplyTo: params.inReplyTo,
      goalId: params.goalId,
      taskId: params.taskId,
      conversationId: params.conversationId,
      priority: params.priority,
      expiresAt,
      metadata: {
        ...params.metadata,
        messageDepth: depth,
      },
    });

    // Publish Redis notification
    if (this.redisPubSub) {
      const event: AgentMessageEvent = {
        messageId: message.id,
        senderRole: params.senderRole,
        targetRole: params.targetRole,
        channel: params.channel,
        messageType: params.messageType,
        subject: params.subject,
        correlationId,
        goalId: params.goalId,
        timestamp: Date.now(),
      };

      try {
        if (params.channel) {
          await this.redisPubSub.publishBroadcast(params.channel, event);
        } else if (params.targetRole) {
          await this.redisPubSub.publishAgentMessage(event);
        }
      } catch (err) {
        logger.warn({ err }, "failed to publish agent message notification (non-fatal)");
      }
    }

    logger.info(
      {
        messageId: message.id,
        senderRole: params.senderRole,
        targetRole: params.targetRole,
        channel: params.channel,
        messageType: params.messageType,
      },
      "agent message sent",
    );

    return { messageId: message.id, correlationId };
  }

  /**
   * Check inbox for messages targeted at a specific role/run.
   * Marks retrieved messages as "delivered".
   */
  async checkInbox(params: CheckInboxParams) {
    // If checking by correlationId, get the response directly
    if (params.correlationId) {
      const response = await getResponseToRequest(this.db, params.correlationId);
      if (response) {
        await markMessagesRead(this.db, [response.id]);
        return [response];
      }
      return [];
    }

    const messages = await getAgentInbox(this.db, {
      targetRole: params.targetRole,
      targetRunId: params.targetRunId,
      status: params.unreadOnly !== false ? "pending" : undefined,
      messageType: params.messageType,
      senderRole: params.senderRole,
      limit: params.limit ?? 5,
    });

    // Mark as delivered
    if (messages.length > 0) {
      const ids = messages.map((m) => m.id);
      await markMessagesRead(this.db, ids);
    }

    return messages;
  }

  /**
   * Check broadcast channel messages.
   */
  async checkBroadcast(channel: string, opts?: { goalId?: string; since?: Date; limit?: number }) {
    return getChannelMessages(this.db, {
      channel,
      goalId: opts?.goalId,
      since: opts?.since,
      limit: opts?.limit ?? 20,
    });
  }

  /**
   * Get response to a specific request by correlationId.
   */
  async getResponse(correlationId: string) {
    return getResponseToRequest(this.db, correlationId);
  }

  /**
   * Get full message thread by correlationId.
   */
  async getThread(correlationId: string) {
    return getMessageThread(this.db, correlationId);
  }

  /**
   * Convenience: send a broadcast message to a channel.
   */
  async broadcast(params: {
    senderRole: string;
    senderRunId?: string;
    channel: string;
    subject: string;
    body: string;
    goalId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string }> {
    const result = await this.send({
      ...params,
      messageType: "broadcast",
    });
    return { messageId: result.messageId };
  }
}
