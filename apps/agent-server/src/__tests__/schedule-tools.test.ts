import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: vi.fn(),
}));

const {
  CREATE_SCHEDULE_TOOL,
  LIST_SCHEDULES_TOOL,
  DELETE_SCHEDULE_TOOL,
} = await import("../agents/tools/schedule-tools.js");

describe("Schedule Tool Definitions", () => {
  describe("CREATE_SCHEDULE_TOOL", () => {
    it("has the correct name", () => {
      expect(CREATE_SCHEDULE_TOOL.name).toBe("create_schedule");
    });

    it("has a non-empty description", () => {
      expect(CREATE_SCHEDULE_TOOL.description.length).toBeGreaterThan(20);
    });

    it("requires cron_expression and action_prompt", () => {
      expect(CREATE_SCHEDULE_TOOL.input_schema.required).toContain("cron_expression");
      expect(CREATE_SCHEDULE_TOOL.input_schema.required).toContain("action_prompt");
    });

    it("defines cron_expression as string", () => {
      expect(CREATE_SCHEDULE_TOOL.input_schema.properties.cron_expression.type).toBe("string");
    });

    it("defines action_prompt as string", () => {
      expect(CREATE_SCHEDULE_TOOL.input_schema.properties.action_prompt.type).toBe("string");
    });

    it("has optional description field", () => {
      expect(CREATE_SCHEDULE_TOOL.input_schema.properties.description).toBeDefined();
      expect(CREATE_SCHEDULE_TOOL.input_schema.required).not.toContain("description");
    });
  });

  describe("LIST_SCHEDULES_TOOL", () => {
    it("has the correct name", () => {
      expect(LIST_SCHEDULES_TOOL.name).toBe("list_schedules");
    });

    it("has no required parameters", () => {
      expect(LIST_SCHEDULES_TOOL.input_schema.required).toEqual([]);
    });
  });

  describe("DELETE_SCHEDULE_TOOL", () => {
    it("has the correct name", () => {
      expect(DELETE_SCHEDULE_TOOL.name).toBe("delete_schedule");
    });

    it("requires schedule_id", () => {
      expect(DELETE_SCHEDULE_TOOL.input_schema.required).toContain("schedule_id");
    });

    it("defines schedule_id as string", () => {
      expect(DELETE_SCHEDULE_TOOL.input_schema.properties.schedule_id.type).toBe("string");
    });
  });
});
