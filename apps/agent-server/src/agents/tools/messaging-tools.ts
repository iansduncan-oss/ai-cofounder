// Tool definitions for agent-to-agent messaging.
// Agents can send messages to other agents, check their inbox, and broadcast updates.

import type { LlmTool } from "@ai-cofounder/llm";

export const SEND_MESSAGE_TOOL: LlmTool = {
  name: "send_message",
  description:
    "Send a message to another agent or reply to a received message. " +
    "Use 'request' type to ask another agent for information, 'response' to reply, " +
    "'notification' to inform, 'handoff' to transfer work context. " +
    "For broadcasts to multiple agents, use broadcast_update instead.",
  input_schema: {
    type: "object",
    properties: {
      target_role: {
        type: "string",
        enum: ["orchestrator", "researcher", "coder", "reviewer", "planner", "debugger", "doc_writer", "verifier", "subagent"],
        description: "Which agent role should receive this message",
      },
      message_type: {
        type: "string",
        enum: ["request", "response", "notification", "handoff"],
        description:
          "request: ask for info/action (auto-generates correlationId), " +
          "response: reply to a request (requires in_reply_to), " +
          "notification: FYI, no response expected, " +
          "handoff: transfer work context to another agent",
      },
      subject: {
        type: "string",
        description: "Brief subject line (2-10 words)",
      },
      body: {
        type: "string",
        description: "Full message content — be specific about what you need or are sharing",
      },
      in_reply_to: {
        type: "string",
        description: "Message ID being replied to (required for 'response' type)",
      },
      correlation_id: {
        type: "string",
        description: "Correlation ID to link this response to its original request",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Message priority (default: medium)",
      },
    },
    required: ["target_role", "message_type", "subject", "body"],
  },
};

export const CHECK_MESSAGES_TOOL: LlmTool = {
  name: "check_messages",
  description:
    "Check your inbox for messages from other agents. " +
    "Use correlation_id to check for a specific response to a previous request. " +
    "Use sender_role to filter by who sent the message. " +
    "By default only returns unread messages (max 5).",
  input_schema: {
    type: "object",
    properties: {
      correlation_id: {
        type: "string",
        description: "Check for a response to a specific request (by correlation ID)",
      },
      sender_role: {
        type: "string",
        enum: ["orchestrator", "researcher", "coder", "reviewer", "planner", "debugger", "doc_writer", "verifier", "subagent"],
        description: "Only show messages from this agent role",
      },
      message_type: {
        type: "string",
        enum: ["request", "response", "notification", "handoff", "broadcast"],
        description: "Only show messages of this type",
      },
      channel: {
        type: "string",
        description: "Check a broadcast channel instead of personal inbox",
      },
      unread_only: {
        type: "boolean",
        description: "Only return unread messages (default: true)",
      },
    },
    required: [],
  },
};

export const BROADCAST_UPDATE_TOOL: LlmTool = {
  name: "broadcast_update",
  description:
    "Broadcast a status update or finding to a named channel that any agent can subscribe to. " +
    "Use for sharing discoveries, progress updates, or findings that multiple agents may need. " +
    "Common channels: 'progress', 'findings', 'blockers'.",
  input_schema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel name (e.g. 'progress', 'findings', 'blockers', or a goal-specific channel)",
      },
      subject: {
        type: "string",
        description: "Brief subject line (2-10 words)",
      },
      body: {
        type: "string",
        description: "Full update content",
      },
    },
    required: ["channel", "subject", "body"],
  },
};
