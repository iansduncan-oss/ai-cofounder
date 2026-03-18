import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getValidGoogleToken } from "./google-auth.js";

const logger = createLogger("calendar");

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/* ── Types ── */

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: string;
  htmlLink: string;
  attendees?: CalendarAttendee[];
  organizer?: { email: string; displayName?: string; self?: boolean };
  created: string;
  updated: string;
  recurrence?: string[];
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  status: string;
  attendeeCount: number;
}

export interface CreateEventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export interface UpdateEventInput {
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export interface FreeBusyResponse {
  timeMin: string;
  timeMax: string;
  busy: Array<{ start: string; end: string }>;
}

/* ── Helpers ── */

function toSummary(event: CalendarEvent): CalendarEventSummary {
  const isAllDay = !!event.start.date && !event.start.dateTime;
  return {
    id: event.id,
    summary: event.summary ?? "(No title)",
    start: event.start.dateTime ?? event.start.date ?? "",
    end: event.end.dateTime ?? event.end.date ?? "",
    isAllDay,
    location: event.location,
    status: event.status,
    attendeeCount: event.attendees?.length ?? 0,
  };
}

function buildDateTimeBody(dateStr: string, timeZone?: string): { dateTime: string; timeZone?: string } | { date: string } {
  // If it's a date-only string (YYYY-MM-DD), treat as all-day
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { date: dateStr };
  }
  const body: { dateTime: string; timeZone?: string } = { dateTime: dateStr };
  if (timeZone) body.timeZone = timeZone;
  return body;
}

/* ── Service ── */

async function calendarFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  // DELETE returns 204 with no body
  if (res.status === 204) return undefined;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API error ${res.status}: ${text}`);
  }
  return res.json();
}

export class CalendarService {
  constructor(
    private db: Db,
    private adminUserId: string,
  ) {}

  private async getToken(): Promise<string> {
    const token = await getValidGoogleToken(this.db, this.adminUserId);
    if (!token) throw new Error("Google account not connected");
    return token;
  }

  async listEvents(opts?: { timeMin?: string; timeMax?: string; maxResults?: number }): Promise<CalendarEventSummary[]> {
    const token = await this.getToken();
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: opts?.timeMin ?? now.toISOString(),
      timeMax: opts?.timeMax ?? weekLater.toISOString(),
      maxResults: String(opts?.maxResults ?? 25),
    });

    const data = (await calendarFetch(
      token,
      `/calendars/primary/events?${params}`,
    )) as { items?: CalendarEvent[] };

    return (data.items ?? []).map(toSummary);
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const token = await this.getToken();
    return calendarFetch(token, `/calendars/primary/events/${eventId}`) as Promise<CalendarEvent>;
  }

  async searchEvents(query: string, maxResults = 10): Promise<CalendarEventSummary[]> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      q: query,
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
      maxResults: String(maxResults),
    });

    const data = (await calendarFetch(
      token,
      `/calendars/primary/events?${params}`,
    )) as { items?: CalendarEvent[] };

    return (data.items ?? []).map(toSummary);
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const token = await this.getToken();
    const body: Record<string, unknown> = {
      summary: input.summary,
      start: buildDateTimeBody(input.start, input.timeZone),
      end: buildDateTimeBody(input.end, input.timeZone),
    };
    if (input.description) body.description = input.description;
    if (input.location) body.location = input.location;
    if (input.attendees?.length) {
      body.attendees = input.attendees.map((email) => ({ email }));
    }

    return calendarFetch(token, "/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<CalendarEvent>;
  }

  async updateEvent(eventId: string, input: UpdateEventInput): Promise<CalendarEvent> {
    const token = await this.getToken();
    const body: Record<string, unknown> = {};
    if (input.summary !== undefined) body.summary = input.summary;
    if (input.description !== undefined) body.description = input.description;
    if (input.location !== undefined) body.location = input.location;
    if (input.start) body.start = buildDateTimeBody(input.start, input.timeZone);
    if (input.end) body.end = buildDateTimeBody(input.end, input.timeZone);
    if (input.attendees) {
      body.attendees = input.attendees.map((email) => ({ email }));
    }

    return calendarFetch(token, `/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<CalendarEvent>;
  }

  async deleteEvent(eventId: string): Promise<void> {
    const token = await this.getToken();
    await calendarFetch(token, `/calendars/primary/events/${eventId}`, {
      method: "DELETE",
    });
  }

  async respondToEvent(eventId: string, responseStatus: "accepted" | "declined" | "tentative"): Promise<CalendarEvent> {
    const token = await this.getToken();
    // First GET the event to find self in attendees
    const event = await this.getEvent(eventId);
    const attendees = (event.attendees ?? []).map((a) => {
      if (a.self) return { ...a, responseStatus };
      return a;
    });

    return calendarFetch(token, `/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify({ attendees }),
    }) as Promise<CalendarEvent>;
  }

  async getFreeBusy(timeMin: string, timeMax: string): Promise<FreeBusyResponse> {
    const token = await this.getToken();
    const data = (await calendarFetch(token, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: "primary" }],
      }),
    })) as { calendars?: Record<string, { busy: Array<{ start: string; end: string }> }> };

    const primaryBusy = data.calendars?.primary?.busy ?? [];
    return { timeMin, timeMax, busy: primaryBusy };
  }
}
