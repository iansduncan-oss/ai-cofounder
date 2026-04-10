import type { LlmTool } from "@ai-cofounder/llm";

export const LIST_CALENDAR_EVENTS_TOOL: LlmTool = {
  name: "list_calendar_events",
  description:
    "List upcoming events from the user's Google Calendar. " +
    "Returns event summary, start/end times, location, and attendee count for the next 7 days by default.",
  input_schema: {
    type: "object",
    properties: {
      timeMin: {
        type: "string",
        description: "Start of time range (ISO 8601, default: now)",
      },
      timeMax: {
        type: "string",
        description: "End of time range (ISO 8601, default: now + 7 days)",
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of events to return (default 25, max 50)",
      },
    },
    required: [],
  },
};

export const GET_CALENDAR_EVENT_TOOL: LlmTool = {
  name: "get_calendar_event",
  description:
    "Get full details of a specific calendar event by its ID. " +
    "Returns summary, description, location, start/end, attendees, organizer, and recurrence info.",
  input_schema: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The Google Calendar event ID",
      },
    },
    required: ["eventId"],
  },
};

export const SEARCH_CALENDAR_EVENTS_TOOL: LlmTool = {
  name: "search_calendar_events",
  description:
    "Search the user's Google Calendar for events matching a text query. " +
    "Searches event summaries, descriptions, and locations.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text to search for in calendar events",
      },
      maxResults: {
        type: "integer",
        description: "Maximum results to return (default 10)",
      },
    },
    required: ["query"],
  },
};

export const GET_FREE_BUSY_TOOL: LlmTool = {
  name: "get_free_busy",
  description:
    "Check the user's free/busy status for a given time range. " +
    "Returns busy time blocks so you can find available slots for scheduling.",
  input_schema: {
    type: "object",
    properties: {
      timeMin: {
        type: "string",
        description: "Start of time range to check (ISO 8601)",
      },
      timeMax: {
        type: "string",
        description: "End of time range to check (ISO 8601)",
      },
    },
    required: ["timeMin", "timeMax"],
  },
};

export const GET_CALENDAR_DAY_MAP_TOOL: LlmTool = {
  name: "get_calendar_day_map",
  description:
    "Get a unified timeline showing both calendar events and free time slots for a given day. " +
    "Returns a structured day map with event and free slots, total busy/free minutes, and event details. " +
    "Useful for understanding the user's schedule at a glance and finding available time.",
  input_schema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Target date in YYYY-MM-DD format (default: today)",
      },
      timeMin: {
        type: "string",
        description: "Custom range start (ISO 8601, overrides date if set with timeMax)",
      },
      timeMax: {
        type: "string",
        description: "Custom range end (ISO 8601, overrides date if set with timeMin)",
      },
    },
    required: [],
  },
};

export const CREATE_CALENDAR_EVENT_TOOL: LlmTool = {
  name: "create_calendar_event",
  description:
    "Create a new event on the user's Google Calendar. " +
    "IMPORTANT: This requires approval before executing.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title",
      },
      start: {
        type: "string",
        description: "Event start time (ISO 8601 datetime or YYYY-MM-DD for all-day)",
      },
      end: {
        type: "string",
        description: "Event end time (ISO 8601 datetime or YYYY-MM-DD for all-day)",
      },
      description: {
        type: "string",
        description: "Event description (optional)",
      },
      location: {
        type: "string",
        description: "Event location (optional)",
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Email addresses of attendees (optional)",
      },
      timeZone: {
        type: "string",
        description: "IANA time zone (e.g. 'America/New_York', optional)",
      },
    },
    required: ["summary", "start", "end"],
  },
};

export const UPDATE_CALENDAR_EVENT_TOOL: LlmTool = {
  name: "update_calendar_event",
  description:
    "Update an existing event on the user's Google Calendar. " +
    "Only include fields you want to change. IMPORTANT: This requires approval before executing.",
  input_schema: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID to update",
      },
      summary: {
        type: "string",
        description: "New event title (optional)",
      },
      start: {
        type: "string",
        description: "New start time (ISO 8601 or YYYY-MM-DD, optional)",
      },
      end: {
        type: "string",
        description: "New end time (ISO 8601 or YYYY-MM-DD, optional)",
      },
      description: {
        type: "string",
        description: "New description (optional)",
      },
      location: {
        type: "string",
        description: "New location (optional)",
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Updated attendee email list (optional, replaces existing)",
      },
      timeZone: {
        type: "string",
        description: "IANA time zone (optional)",
      },
    },
    required: ["eventId"],
  },
};

export const DELETE_CALENDAR_EVENT_TOOL: LlmTool = {
  name: "delete_calendar_event",
  description:
    "Delete an event from the user's Google Calendar. " +
    "This is irreversible. IMPORTANT: This requires approval before executing.",
  input_schema: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID to delete",
      },
    },
    required: ["eventId"],
  },
};

export const RESPOND_TO_CALENDAR_EVENT_TOOL: LlmTool = {
  name: "respond_to_calendar_event",
  description:
    "RSVP to a calendar event invitation (accept, decline, or tentatively accept). " +
    "IMPORTANT: This requires approval before executing.",
  input_schema: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID to respond to",
      },
      responseStatus: {
        type: "string",
        enum: ["accepted", "declined", "tentative"],
        description: "Your RSVP response",
      },
    },
    required: ["eventId", "responseStatus"],
  },
};

/** Tool tier assignments: read/search = green, create/update/delete/respond = yellow */
export const CALENDAR_TOOL_TIERS: Record<string, "green" | "yellow"> = {
  list_calendar_events: "green",
  get_calendar_event: "green",
  search_calendar_events: "green",
  get_free_busy: "green",
  get_calendar_day_map: "green",
  create_calendar_event: "yellow",
  update_calendar_event: "yellow",
  delete_calendar_event: "yellow",
  respond_to_calendar_event: "yellow",
};
