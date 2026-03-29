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

const { CalendarService } = await import("../services/calendar.js");

const fakeDb = {} as any;
const adminUserId = "admin-1";

// --- Helpers ---

function makeCalendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    summary: "Team Standup",
    description: "Daily standup meeting",
    location: "Conference Room A",
    start: { dateTime: "2026-03-18T09:00:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-03-18T09:30:00-04:00", timeZone: "America/New_York" },
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    attendees: [
      { email: "alice@example.com", responseStatus: "accepted", self: true },
      { email: "bob@example.com", responseStatus: "needsAction" },
    ],
    organizer: { email: "alice@example.com", self: true },
    created: "2026-03-15T12:00:00Z",
    updated: "2026-03-15T12:00:00Z",
    ...overrides,
  };
}

function mockFetchJson(response: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

function mockFetch204() {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => undefined,
    text: async () => "",
  });
}

function mockFetchSequence(responses: Array<{ status?: number; body: unknown }>) {
  for (const resp of responses) {
    if (resp.status === 204) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined,
        text: async () => "",
      });
    } else {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: resp.status ?? 200,
        json: async () => resp.body,
        text: async () => JSON.stringify(resp.body),
      });
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockGetValidGoogleToken.mockResolvedValue("test-access-token");
});

describe("CalendarService", () => {
  let service: InstanceType<typeof CalendarService>;

  beforeEach(() => {
    service = new CalendarService(fakeDb, adminUserId);
  });

  // --- getToken ---

  describe("getToken (via any method)", () => {
    it("throws when Google account is not connected", async () => {
      mockGetValidGoogleToken.mockResolvedValue(null);
      await expect(service.listEvents()).rejects.toThrow("Google account not connected");
    });
  });

  // --- listEvents ---

  describe("listEvents", () => {
    it("returns event summaries", async () => {
      const evt = makeCalendarEvent();
      mockFetchJson({ items: [evt] });

      const result = await service.listEvents();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "evt-1",
        summary: "Team Standup",
        isAllDay: false,
        attendeeCount: 2,
      });
    });

    it("returns empty array for no events", async () => {
      mockFetchJson({ items: [] });
      const result = await service.listEvents();
      expect(result).toEqual([]);
    });

    it("returns empty array when items field is missing", async () => {
      mockFetchJson({});
      const result = await service.listEvents();
      expect(result).toEqual([]);
    });

    it("passes timeMin, timeMax, maxResults to API", async () => {
      mockFetchJson({ items: [] });

      await service.listEvents({
        timeMin: "2026-03-18T00:00:00Z",
        timeMax: "2026-03-25T00:00:00Z",
        maxResults: 10,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("timeMin=2026-03-18T00%3A00%3A00Z");
      expect(url).toContain("timeMax=2026-03-25T00%3A00%3A00Z");
      expect(url).toContain("maxResults=10");
      expect(url).toContain("singleEvents=true");
      expect(url).toContain("orderBy=startTime");
    });

    it("handles all-day events", async () => {
      const evt = makeCalendarEvent({
        start: { date: "2026-03-18" },
        end: { date: "2026-03-19" },
      });
      mockFetchJson({ items: [evt] });

      const result = await service.listEvents();
      expect(result[0].isAllDay).toBe(true);
      expect(result[0].start).toBe("2026-03-18");
    });
  });

  // --- getEvent ---

  describe("getEvent", () => {
    it("returns full event details", async () => {
      const evt = makeCalendarEvent();
      mockFetchJson(evt);

      const result = await service.getEvent("evt-1");
      expect(result.summary).toBe("Team Standup");
      expect(result.attendees).toHaveLength(2);
      expect(result.location).toBe("Conference Room A");
    });
  });

  // --- searchEvents ---

  describe("searchEvents", () => {
    it("encodes query parameter correctly", async () => {
      mockFetchJson({ items: [] });

      await service.searchEvents("team meeting");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=team+meeting");
    });

    it("returns empty array when no results", async () => {
      mockFetchJson({});
      const result = await service.searchEvents("nonexistent");
      expect(result).toEqual([]);
    });

    it("passes maxResults", async () => {
      mockFetchJson({ items: [] });
      await service.searchEvents("test", 5);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("maxResults=5");
    });
  });

  // --- createEvent ---

  describe("createEvent", () => {
    it("sends correct body for timed event", async () => {
      const evt = makeCalendarEvent();
      mockFetchJson(evt);

      await service.createEvent({
        summary: "Team Standup",
        start: "2026-03-18T09:00:00-04:00",
        end: "2026-03-18T09:30:00-04:00",
        description: "Daily standup",
        location: "Room A",
        timeZone: "America/New_York",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/calendars/primary/events");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.summary).toBe("Team Standup");
      expect(body.start.dateTime).toBe("2026-03-18T09:00:00-04:00");
      expect(body.start.timeZone).toBe("America/New_York");
    });

    it("sends date-only for all-day event", async () => {
      const evt = makeCalendarEvent({ start: { date: "2026-03-18" }, end: { date: "2026-03-19" } });
      mockFetchJson(evt);

      await service.createEvent({
        summary: "All Day",
        start: "2026-03-18",
        end: "2026-03-19",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.start.date).toBe("2026-03-18");
      expect(body.start.dateTime).toBeUndefined();
      expect(body.end.date).toBe("2026-03-19");
    });

    it("includes attendees as email objects", async () => {
      mockFetchJson(makeCalendarEvent());

      await service.createEvent({
        summary: "Meeting",
        start: "2026-03-18T09:00:00Z",
        end: "2026-03-18T10:00:00Z",
        attendees: ["bob@example.com", "carol@example.com"],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attendees).toEqual([
        { email: "bob@example.com" },
        { email: "carol@example.com" },
      ]);
    });
  });

  // --- updateEvent ---

  describe("updateEvent", () => {
    it("PATCHes only provided fields", async () => {
      mockFetchJson(makeCalendarEvent({ summary: "Updated Standup" }));

      await service.updateEvent("evt-1", { summary: "Updated Standup" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/calendars/primary/events/evt-1");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(init.body);
      expect(body.summary).toBe("Updated Standup");
      expect(body.start).toBeUndefined();
    });
  });

  // --- deleteEvent ---

  describe("deleteEvent", () => {
    it("DELETEs the event and handles 204", async () => {
      mockFetch204();

      await service.deleteEvent("evt-1");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/calendars/primary/events/evt-1");
      expect(init.method).toBe("DELETE");
    });
  });

  // --- respondToEvent ---

  describe("respondToEvent", () => {
    it("GETs event then PATCHes self attendee status", async () => {
      const evt = makeCalendarEvent();
      mockFetchSequence([
        { body: evt },
        { body: { ...evt, attendees: [{ email: "alice@example.com", responseStatus: "declined", self: true }, { email: "bob@example.com", responseStatus: "needsAction" }] } },
      ]);

      const _result = await service.respondToEvent("evt-1", "declined");

      // First call is GET, second is PATCH
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, patchInit] = mockFetch.mock.calls[1];
      expect(patchInit.method).toBe("PATCH");
      const body = JSON.parse(patchInit.body);
      expect(body.attendees[0].responseStatus).toBe("declined");
      expect(body.attendees[1].responseStatus).toBe("needsAction"); // unchanged
    });
  });

  // --- getFreeBusy ---

  describe("getFreeBusy", () => {
    it("returns busy blocks for primary calendar", async () => {
      mockFetchJson({
        calendars: {
          primary: {
            busy: [
              { start: "2026-03-18T09:00:00Z", end: "2026-03-18T10:00:00Z" },
            ],
          },
        },
      });

      const result = await service.getFreeBusy("2026-03-18T00:00:00Z", "2026-03-19T00:00:00Z");
      expect(result.busy).toHaveLength(1);
      expect(result.timeMin).toBe("2026-03-18T00:00:00Z");
      expect(result.timeMax).toBe("2026-03-19T00:00:00Z");
    });

    it("returns empty busy array when no data", async () => {
      mockFetchJson({ calendars: {} });
      const result = await service.getFreeBusy("2026-03-18T00:00:00Z", "2026-03-19T00:00:00Z");
      expect(result.busy).toEqual([]);
    });

    it("POSTs to /freeBusy with primary item", async () => {
      mockFetchJson({ calendars: {} });
      await service.getFreeBusy("2026-03-18T00:00:00Z", "2026-03-19T00:00:00Z");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/freeBusy");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.items).toEqual([{ id: "primary" }]);
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

      await expect(service.listEvents()).rejects.toThrow("Calendar API error 403: Forbidden: insufficient scopes");
    });
  });
});
