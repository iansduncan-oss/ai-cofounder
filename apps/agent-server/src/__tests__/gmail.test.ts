import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockGetValidGoogleToken = vi.fn();

vi.mock("../services/google-auth.js", () => ({
  getValidGoogleToken: (...args: unknown[]) => mockGetValidGoogleToken(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockFetch = vi.fn();

const { GmailService } = await import("../services/gmail.js");

const fakeDb = {} as any;
const adminUserId = "admin-1";

// --- Helpers ---

function makeGmailMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    threadId: "thread-1",
    labelIds: ["INBOX"],
    snippet: "Hello world snippet",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "alice@example.com" },
        { name: "To", value: "bob@example.com" },
        { name: "Subject", value: "Test Subject" },
        { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
        { name: "Cc", value: "" },
      ],
      body: {
        data: Buffer.from("Hello, world!").toString("base64url"),
      },
      parts: [],
    },
    ...overrides,
  };
}

/** Mock fetch to return JSON for a given URL pattern */
function mockFetchJson(response: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

function mockFetchSequence(responses: unknown[]) {
  for (const resp of responses) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => resp,
      text: async () => JSON.stringify(resp),
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockGetValidGoogleToken.mockResolvedValue("test-access-token");
});

describe("GmailService", () => {
  let service: InstanceType<typeof GmailService>;

  beforeEach(() => {
    service = new GmailService(fakeDb, adminUserId);
  });

  // --- getToken ---

  describe("getToken (via any method)", () => {
    it("throws when Google account is not connected", async () => {
      mockGetValidGoogleToken.mockResolvedValue(null);
      await expect(service.listInbox()).rejects.toThrow("Google account not connected");
    });
  });

  // --- listInbox ---

  describe("listInbox", () => {
    it("returns email summaries", async () => {
      const msg = makeGmailMessage();
      mockFetchSequence([
        { messages: [{ id: "msg-1" }] },
        msg,
      ]);

      const result = await service.listInbox(5);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "msg-1",
        from: "alice@example.com",
        subject: "Test Subject",
        isUnread: false,
      });
    });

    it("returns empty array for empty inbox", async () => {
      mockFetchJson({ messages: [] });
      const result = await service.listInbox();
      expect(result).toEqual([]);
    });

    it("returns empty array when messages field is missing", async () => {
      mockFetchJson({});
      const result = await service.listInbox();
      expect(result).toEqual([]);
    });

    it("skips messages that fail to fetch individually", async () => {
      // First call: message list with 2 IDs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: "msg-1" }, { id: "msg-2" }] }),
      });
      // Second call (msg-1): fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });
      // Third call (msg-2): succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeGmailMessage({ id: "msg-2" }),
      });

      const result = await service.listInbox();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-2");
    });
  });

  // --- getMessage ---

  describe("getMessage", () => {
    it("parses single-part text/plain body", async () => {
      const msg = makeGmailMessage();
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.body).toBe("Hello, world!");
      expect(result.bodyHtml).toBe("");
    });

    it("parses single-part text/html body and strips tags for body field", async () => {
      const htmlContent = "<p>Hello <b>world</b></p>";
      const msg = makeGmailMessage({
        payload: {
          mimeType: "text/html",
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "HTML Email" },
            { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
          ],
          body: { data: Buffer.from(htmlContent).toString("base64url") },
          parts: [],
        },
      });
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.bodyHtml).toBe(htmlContent);
      // body should be tag-stripped version
      expect(result.body).toContain("Hello");
      expect(result.body).toContain("world");
      expect(result.body).not.toContain("<p>");
    });

    it("parses multipart text+html message", async () => {
      const textContent = "Plain text version";
      const htmlContent = "<p>HTML version</p>";
      const msg = makeGmailMessage({
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "Multipart" },
            { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
          ],
          body: {},
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from(textContent).toString("base64url") },
            },
            {
              mimeType: "text/html",
              body: { data: Buffer.from(htmlContent).toString("base64url") },
            },
          ],
        },
      });
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.body).toBe(textContent);
      expect(result.bodyHtml).toBe(htmlContent);
    });

    it("handles nested multipart (mixed wrapping alternative)", async () => {
      const textContent = "Nested plain";
      const htmlContent = "<p>Nested HTML</p>";
      const msg = makeGmailMessage({
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "Nested" },
            { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
          ],
          body: {},
          parts: [
            {
              mimeType: "multipart/alternative",
              body: {},
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: Buffer.from(textContent).toString("base64url") },
                },
                {
                  mimeType: "text/html",
                  body: { data: Buffer.from(htmlContent).toString("base64url") },
                },
              ],
            },
          ],
        },
      });
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.body).toBe(textContent);
      expect(result.bodyHtml).toBe(htmlContent);
    });

    it("extracts attachments", async () => {
      const msg = makeGmailMessage({
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "With Attachment" },
            { name: "Date", value: "Mon, 1 Jan 2025 00:00:00 +0000" },
          ],
          body: {},
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("Body text").toString("base64url") },
            },
            {
              mimeType: "application/pdf",
              filename: "report.pdf",
              body: { attachmentId: "att-1", size: 12345 },
            },
          ],
        },
      });
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toEqual({
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 12345,
      });
    });

    it("detects unread message via UNREAD label", async () => {
      const msg = makeGmailMessage({ labelIds: ["INBOX", "UNREAD"] });
      mockFetchJson(msg);

      const result = await service.getMessage("msg-1");
      expect(result.isUnread).toBe(true);
    });
  });

  // --- getThread ---

  describe("getThread", () => {
    it("returns all messages and deduped participants", async () => {
      mockFetchJson({
        id: "thread-1",
        messages: [
          makeGmailMessage({ id: "msg-1" }),
          makeGmailMessage({
            id: "msg-2",
            payload: {
              ...makeGmailMessage().payload,
              headers: [
                { name: "From", value: "bob@example.com" },
                { name: "To", value: "alice@example.com" },
                { name: "Subject", value: "Re: Test Subject" },
                { name: "Date", value: "Tue, 2 Jan 2025 00:00:00 +0000" },
              ],
            },
          }),
        ],
      });

      const result = await service.getThread("thread-1");
      expect(result.messages).toHaveLength(2);
      expect(result.messageCount).toBe(2);
      expect(result.subject).toBe("Test Subject");
      // Participants should include alice and bob (deduped)
      expect(result.participants).toContain("alice@example.com");
      expect(result.participants).toContain("bob@example.com");
    });
  });

  // --- searchEmails ---

  describe("searchEmails", () => {
    it("encodes query parameter correctly", async () => {
      mockFetchSequence([{ messages: [] }, makeGmailMessage()]);

      await service.searchEmails("from:alice subject:meeting");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=from%3Aalice%20subject%3Ameeting");
    });

    it("returns empty array when no results", async () => {
      mockFetchJson({});
      const result = await service.searchEmails("nonexistent");
      expect(result).toEqual([]);
    });
  });

  // --- createDraft ---

  describe("createDraft", () => {
    it("sends correct base64url raw message", async () => {
      mockFetchJson({ id: "draft-1", message: { id: "msg-1" } });

      await service.createDraft({
        to: "bob@example.com",
        subject: "Test Draft",
        body: "Draft body",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/drafts");
      const body = JSON.parse(init.body);
      const decoded = Buffer.from(body.message.raw, "base64url").toString("utf-8");
      expect(decoded).toContain("To: bob@example.com");
      expect(decoded).toContain("Subject: Test Draft");
      expect(decoded).toContain("Draft body");
    });

    it("includes cc and inReplyTo headers when provided", async () => {
      mockFetchJson({ id: "draft-1", message: { id: "msg-1" } });

      await service.createDraft({
        to: "bob@example.com",
        subject: "Reply",
        body: "Reply body",
        cc: "carol@example.com",
        inReplyTo: "<original-msg-id@mail.example.com>",
        threadId: "thread-1",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const decoded = Buffer.from(body.message.raw, "base64url").toString("utf-8");
      expect(decoded).toContain("Cc: carol@example.com");
      expect(decoded).toContain("In-Reply-To: <original-msg-id@mail.example.com>");
      expect(body.message.threadId).toBe("thread-1");
    });
  });

  // --- sendEmail ---

  describe("sendEmail", () => {
    it("POSTs to /messages/send", async () => {
      mockFetchJson({ id: "msg-sent", threadId: "thread-1" });

      await service.sendEmail({
        to: "bob@example.com",
        subject: "Sent Email",
        body: "Sent body",
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/messages/send");
      const init = mockFetch.mock.calls[0][1];
      expect(init.method).toBe("POST");
    });
  });

  // --- sendDraft ---

  describe("sendDraft", () => {
    it("POSTs to /drafts/send", async () => {
      mockFetchJson({ id: "msg-sent", threadId: "thread-1" });

      await service.sendDraft("draft-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/drafts/send");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.id).toBe("draft-1");
    });
  });

  // --- markAsRead ---

  describe("markAsRead", () => {
    it("POSTs removeLabelIds with UNREAD", async () => {
      mockFetchJson({});

      await service.markAsRead("msg-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/messages/msg-1/modify");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.removeLabelIds).toEqual(["UNREAD"]);
    });
  });

  // --- getUnreadCount ---

  describe("getUnreadCount", () => {
    it("returns resultSizeEstimate", async () => {
      mockFetchJson({ resultSizeEstimate: 42 });
      const count = await service.getUnreadCount();
      expect(count).toBe(42);
    });

    it("returns 0 when resultSizeEstimate is missing", async () => {
      mockFetchJson({});
      const count = await service.getUnreadCount();
      expect(count).toBe(0);
    });
  });

  // --- API error handling ---

  describe("API error handling", () => {
    it("throws with status code and body text on API error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden: insufficient scopes",
      });

      await expect(service.getUnreadCount()).rejects.toThrow("Gmail API error 403: Forbidden: insufficient scopes");
    });
  });
});
