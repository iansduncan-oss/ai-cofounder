import type { LlmTool } from "@ai-cofounder/llm";

export const LIST_EMAILS_TOOL: LlmTool = {
  name: "list_emails",
  description:
    "List recent emails from the user's Gmail inbox. " +
    "Returns subject, from, date, and unread status for up to 20 messages.",
  input_schema: {
    type: "object",
    properties: {
      maxResults: {
        type: "integer",
        description: "Maximum number of emails to return (default 10, max 20)",
      },
    },
    required: [],
  },
};

export const READ_EMAIL_TOOL: LlmTool = {
  name: "read_email",
  description:
    "Read the full content of a specific email by its message ID. " +
    "Returns from, to, subject, body text, date, and attachment info.",
  input_schema: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The Gmail message ID to read",
      },
    },
    required: ["messageId"],
  },
};

export const SEARCH_EMAILS_TOOL: LlmTool = {
  name: "search_emails",
  description:
    "Search the user's Gmail using Gmail search syntax. " +
    "Supports queries like 'from:person@example.com', 'subject:meeting', 'is:unread', etc.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Gmail search query (same syntax as Gmail search bar)",
      },
      maxResults: {
        type: "integer",
        description: "Maximum results to return (default 10)",
      },
    },
    required: ["query"],
  },
};

export const DRAFT_REPLY_TOOL: LlmTool = {
  name: "draft_reply",
  description:
    "Create a draft email reply. The draft is saved in Gmail but NOT sent. " +
    "Use send_email for sending. Use this when you want the user to review before sending.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body text" },
      cc: { type: "string", description: "CC recipients (optional)" },
      threadId: { type: "string", description: "Thread ID to reply to (optional)" },
      inReplyTo: { type: "string", description: "Message-ID header of message being replied to (optional)" },
    },
    required: ["to", "subject", "body"],
  },
};

export const SEND_EMAIL_TOOL: LlmTool = {
  name: "send_email",
  description:
    "Send an email directly from the user's Gmail account. " +
    "This actually sends the email — use draft_reply if you want the user to review first. " +
    "IMPORTANT: This requires approval before executing.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body text" },
      cc: { type: "string", description: "CC recipients (optional)" },
      threadId: { type: "string", description: "Thread ID to reply within (optional)" },
    },
    required: ["to", "subject", "body"],
  },
};

/** Tool tier assignments: read/search/draft = green, send = yellow */
export const GMAIL_TOOL_TIERS: Record<string, "green" | "yellow"> = {
  list_emails: "green",
  read_email: "green",
  search_emails: "green",
  draft_reply: "green",
  send_email: "yellow",
};
