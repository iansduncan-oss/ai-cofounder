import { describe, it, expect } from "vitest";
import {
  LIST_CALENDAR_EVENTS_TOOL,
  GET_CALENDAR_EVENT_TOOL,
  SEARCH_CALENDAR_EVENTS_TOOL,
  GET_FREE_BUSY_TOOL,
  CREATE_CALENDAR_EVENT_TOOL,
  UPDATE_CALENDAR_EVENT_TOOL,
  DELETE_CALENDAR_EVENT_TOOL,
  RESPOND_TO_CALENDAR_EVENT_TOOL,
  CALENDAR_TOOL_TIERS,
} from "../agents/tools/calendar-tools.js";

describe("calendar tool definitions", () => {
  const allTools = [
    LIST_CALENDAR_EVENTS_TOOL,
    GET_CALENDAR_EVENT_TOOL,
    SEARCH_CALENDAR_EVENTS_TOOL,
    GET_FREE_BUSY_TOOL,
    CREATE_CALENDAR_EVENT_TOOL,
    UPDATE_CALENDAR_EVENT_TOOL,
    DELETE_CALENDAR_EVENT_TOOL,
    RESPOND_TO_CALENDAR_EVENT_TOOL,
  ];

  it("all 8 tools have the expected names", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toEqual([
      "list_calendar_events",
      "get_calendar_event",
      "search_calendar_events",
      "get_free_busy",
      "create_calendar_event",
      "update_calendar_event",
      "delete_calendar_event",
      "respond_to_calendar_event",
    ]);
  });

  it("all 8 tools have non-empty descriptions", () => {
    for (const tool of allTools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
    }
  });

  it("list_calendar_events: all properties are optional", () => {
    const schema = LIST_CALENDAR_EVENTS_TOOL.input_schema;
    expect(schema.required).toEqual([]);
    expect(schema.properties.timeMin.type).toBe("string");
    expect(schema.properties.timeMax.type).toBe("string");
    expect(schema.properties.maxResults.type).toBe("integer");
  });

  it("get_calendar_event: eventId is required string", () => {
    const schema = GET_CALENDAR_EVENT_TOOL.input_schema;
    expect(schema.properties.eventId.type).toBe("string");
    expect(schema.required).toContain("eventId");
  });

  it("search_calendar_events: query required, maxResults optional", () => {
    const schema = SEARCH_CALENDAR_EVENTS_TOOL.input_schema;
    expect(schema.required).toContain("query");
    expect(schema.required).not.toContain("maxResults");
    expect(schema.properties.query.type).toBe("string");
    expect(schema.properties.maxResults.type).toBe("integer");
  });

  it("get_free_busy: timeMin and timeMax required", () => {
    const schema = GET_FREE_BUSY_TOOL.input_schema;
    expect(schema.required).toEqual(expect.arrayContaining(["timeMin", "timeMax"]));
  });

  it("create_calendar_event: summary/start/end required, others optional", () => {
    const schema = CREATE_CALENDAR_EVENT_TOOL.input_schema;
    expect(schema.required).toEqual(expect.arrayContaining(["summary", "start", "end"]));
    expect(schema.required).not.toContain("description");
    expect(schema.required).not.toContain("location");
    expect(schema.required).not.toContain("attendees");
    expect(schema.required).not.toContain("timeZone");
  });

  it("update_calendar_event: eventId required, all others optional", () => {
    const schema = UPDATE_CALENDAR_EVENT_TOOL.input_schema;
    expect(schema.required).toEqual(["eventId"]);
    expect(schema.properties.summary.type).toBe("string");
    expect(schema.properties.start.type).toBe("string");
  });

  it("delete_calendar_event: eventId required", () => {
    const schema = DELETE_CALENDAR_EVENT_TOOL.input_schema;
    expect(schema.required).toEqual(["eventId"]);
  });

  it("respond_to_calendar_event: eventId and responseStatus required", () => {
    const schema = RESPOND_TO_CALENDAR_EVENT_TOOL.input_schema;
    expect(schema.required).toEqual(expect.arrayContaining(["eventId", "responseStatus"]));
    expect(schema.properties.responseStatus.enum).toEqual(["accepted", "declined", "tentative"]);
  });

  it("tier assignments: green for read/search/free-busy, yellow for create/update/delete/respond", () => {
    expect(CALENDAR_TOOL_TIERS.list_calendar_events).toBe("green");
    expect(CALENDAR_TOOL_TIERS.get_calendar_event).toBe("green");
    expect(CALENDAR_TOOL_TIERS.search_calendar_events).toBe("green");
    expect(CALENDAR_TOOL_TIERS.get_free_busy).toBe("green");
    expect(CALENDAR_TOOL_TIERS.create_calendar_event).toBe("yellow");
    expect(CALENDAR_TOOL_TIERS.update_calendar_event).toBe("yellow");
    expect(CALENDAR_TOOL_TIERS.delete_calendar_event).toBe("yellow");
    expect(CALENDAR_TOOL_TIERS.respond_to_calendar_event).toBe("yellow");
  });

  it("all tool names have corresponding tier entries", () => {
    for (const tool of allTools) {
      expect(["green", "yellow", "red"]).toContain(CALENDAR_TOOL_TIERS[tool.name]);
    }
  });
});
