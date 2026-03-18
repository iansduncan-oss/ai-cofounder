import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getValidGoogleToken } from "./google-auth.js";

const logger = createLogger("gmail");

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/* ── Types ── */

export interface EmailSummary {
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

export interface EmailMessage {
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

export interface EmailThread {
  id: string;
  messages: EmailMessage[];
  subject: string;
  participants: string[];
  messageCount: number;
}

export interface DraftInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  inReplyTo?: string;
  threadId?: string;
}

/* ── Helpers ── */

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractBody(payload: GmailPayload): { text: string; html: string } {
  // Simple single-part message
  if (payload.body?.data) {
    const decoded = decodeBody(payload.body.data);
    const isHtml = payload.mimeType?.includes("html");
    return { text: isHtml ? "" : decoded, html: isHtml ? decoded : "" };
  }

  // Multipart: search for text/plain and text/html
  let text = "";
  let html = "";
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBody(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBody(part.body.data);
      } else if (part.parts) {
        // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
        const nested = extractBody(part as GmailPayload);
        if (nested.text) text = nested.text;
        if (nested.html) html = nested.html;
      }
    }
  }
  return { text, html };
}

function parseMessage(msg: GmailMessage): EmailMessage {
  const headers = msg.payload?.headers ?? [];
  const { text, html } = extractBody(msg.payload ?? {} as GmailPayload);
  const attachments = (msg.payload?.parts ?? [])
    .filter((p) => p.filename && p.body?.attachmentId)
    .map((p) => ({
      filename: p.filename!,
      mimeType: p.mimeType ?? "application/octet-stream",
      size: p.body?.size ?? 0,
    }));

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    subject: getHeader(headers, "Subject"),
    body: text || html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    bodyHtml: html,
    date: getHeader(headers, "Date"),
    isUnread: (msg.labelIds ?? []).includes("UNREAD"),
    attachments,
    labels: msg.labelIds ?? [],
  };
}

function toSummary(msg: GmailMessage): EmailSummary {
  const headers = msg.payload?.headers ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    snippet: msg.snippet ?? "",
    date: getHeader(headers, "Date"),
    isUnread: (msg.labelIds ?? []).includes("UNREAD"),
    hasAttachments: (msg.payload?.parts ?? []).some((p) => p.filename && p.body?.attachmentId),
    labels: msg.labelIds ?? [],
  };
}

/* ── Gmail API types (simplified) ── */

interface GmailPayload {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
  filename?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPayload;
}

/* ── Service ── */

async function gmailFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${text}`);
  }
  return res.json();
}

export class GmailService {
  constructor(
    private db: Db,
    private adminUserId: string,
  ) {}

  private async getToken(): Promise<string> {
    const token = await getValidGoogleToken(this.db, this.adminUserId);
    if (!token) throw new Error("Google account not connected");
    return token;
  }

  async listInbox(maxResults = 20): Promise<EmailSummary[]> {
    const token = await this.getToken();
    const data = (await gmailFetch(
      token,
      `/messages?maxResults=${maxResults}&labelIds=INBOX`,
    )) as { messages?: Array<{ id: string }> };

    if (!data.messages?.length) return [];

    // Batch-fetch message details
    const summaries: EmailSummary[] = [];
    for (const { id } of data.messages) {
      try {
        const msg = (await gmailFetch(token, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)) as GmailMessage;
        summaries.push(toSummary(msg));
      } catch (err) {
        logger.warn({ err, messageId: id }, "Failed to fetch message summary");
      }
    }
    return summaries;
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const token = await this.getToken();
    const msg = (await gmailFetch(token, `/messages/${messageId}?format=full`)) as GmailMessage;
    return parseMessage(msg);
  }

  async getThread(threadId: string): Promise<EmailThread> {
    const token = await this.getToken();
    const data = (await gmailFetch(token, `/threads/${threadId}?format=full`)) as {
      id: string;
      messages: GmailMessage[];
    };

    const messages = data.messages.map(parseMessage);
    const participants = [...new Set(messages.flatMap((m) => [m.from, m.to, m.cc].filter(Boolean)))];

    return {
      id: data.id,
      messages,
      subject: messages[0]?.subject ?? "",
      participants,
      messageCount: messages.length,
    };
  }

  async searchEmails(query: string, maxResults = 10): Promise<EmailSummary[]> {
    const token = await this.getToken();
    const data = (await gmailFetch(
      token,
      `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
    )) as { messages?: Array<{ id: string }> };

    if (!data.messages?.length) return [];

    const summaries: EmailSummary[] = [];
    for (const { id } of data.messages) {
      try {
        const msg = (await gmailFetch(token, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)) as GmailMessage;
        summaries.push(toSummary(msg));
      } catch (err) {
        logger.warn({ err, messageId: id }, "Failed to fetch message summary");
      }
    }
    return summaries;
  }

  async createDraft(input: DraftInput): Promise<{ id: string; message: { id: string } }> {
    const token = await this.getToken();
    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (input.cc) headers.push(`Cc: ${input.cc}`);
    if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);

    const raw = Buffer.from(
      headers.join("\r\n") + "\r\n\r\n" + input.body,
    ).toString("base64url");

    return gmailFetch(token, "/drafts", {
      method: "POST",
      body: JSON.stringify({
        message: { raw, threadId: input.threadId },
      }),
    }) as Promise<{ id: string; message: { id: string } }>;
  }

  async sendEmail(input: DraftInput): Promise<{ id: string; threadId: string }> {
    const token = await this.getToken();
    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (input.cc) headers.push(`Cc: ${input.cc}`);
    if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);

    const raw = Buffer.from(
      headers.join("\r\n") + "\r\n\r\n" + input.body,
    ).toString("base64url");

    return gmailFetch(token, "/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw, threadId: input.threadId }),
    }) as Promise<{ id: string; threadId: string }>;
  }

  async sendDraft(draftId: string): Promise<{ id: string; threadId: string }> {
    const token = await this.getToken();
    return gmailFetch(token, "/drafts/send", {
      method: "POST",
      body: JSON.stringify({ id: draftId }),
    }) as Promise<{ id: string; threadId: string }>;
  }

  async markAsRead(messageId: string): Promise<void> {
    const token = await this.getToken();
    await gmailFetch(token, `/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  }

  async getUnreadCount(): Promise<number> {
    const token = await this.getToken();
    const data = (await gmailFetch(
      token,
      "/messages?maxResults=1&labelIds=INBOX&labelIds=UNREAD",
    )) as { resultSizeEstimate?: number };
    return data.resultSizeEstimate ?? 0;
  }
}
