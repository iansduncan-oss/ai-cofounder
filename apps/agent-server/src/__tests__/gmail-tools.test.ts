import { describe, it, expect } from "vitest";
import {
  LIST_EMAILS_TOOL,
  READ_EMAIL_TOOL,
  SEARCH_EMAILS_TOOL,
  DRAFT_REPLY_TOOL,
  SEND_EMAIL_TOOL,
  GMAIL_TOOL_TIERS,
} from "../agents/tools/gmail-tools.js";

describe("gmail tool definitions", () => {
  const allTools = [LIST_EMAILS_TOOL, READ_EMAIL_TOOL, SEARCH_EMAILS_TOOL, DRAFT_REPLY_TOOL, SEND_EMAIL_TOOL];

  it("all 5 tools have the expected names", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toEqual(["list_emails", "read_email", "search_emails", "draft_reply", "send_email"]);
  });

  it("all 5 tools have non-empty descriptions", () => {
    for (const tool of allTools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
    }
  });

  it("list_emails: maxResults is optional integer", () => {
    const schema = LIST_EMAILS_TOOL.input_schema;
    expect(schema.properties.maxResults.type).toBe("integer");
    expect(schema.required).toEqual([]);
  });

  it("read_email: messageId is required string", () => {
    const schema = READ_EMAIL_TOOL.input_schema;
    expect(schema.properties.messageId.type).toBe("string");
    expect(schema.required).toContain("messageId");
  });

  it("search_emails: query required, maxResults optional", () => {
    const schema = SEARCH_EMAILS_TOOL.input_schema;
    expect(schema.required).toContain("query");
    expect(schema.required).not.toContain("maxResults");
    expect(schema.properties.query.type).toBe("string");
    expect(schema.properties.maxResults.type).toBe("integer");
  });

  it("draft_reply: to/subject/body required, cc/threadId/inReplyTo optional", () => {
    const schema = DRAFT_REPLY_TOOL.input_schema;
    expect(schema.required).toEqual(expect.arrayContaining(["to", "subject", "body"]));
    expect(schema.required).not.toContain("cc");
    expect(schema.required).not.toContain("threadId");
    expect(schema.required).not.toContain("inReplyTo");
  });

  it("send_email: to/subject/body required, cc/threadId optional", () => {
    const schema = SEND_EMAIL_TOOL.input_schema;
    expect(schema.required).toEqual(expect.arrayContaining(["to", "subject", "body"]));
    expect(schema.required).not.toContain("cc");
    expect(schema.required).not.toContain("threadId");
  });

  it("tier assignments: green for read/list/search/draft, yellow for send", () => {
    expect(GMAIL_TOOL_TIERS.list_emails).toBe("green");
    expect(GMAIL_TOOL_TIERS.read_email).toBe("green");
    expect(GMAIL_TOOL_TIERS.search_emails).toBe("green");
    expect(GMAIL_TOOL_TIERS.draft_reply).toBe("green");
    expect(GMAIL_TOOL_TIERS.send_email).toBe("yellow");
  });
});
