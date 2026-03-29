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
  DELEGATE_TO_SUBAGENT_TOOL,
  DELEGATE_PARALLEL_TOOL,
  CHECK_SUBAGENT_TOOL,
} = await import("../agents/tools/subagent-tools.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── DELEGATE_TO_SUBAGENT_TOOL ──────────────────────────────────────────────

describe("DELEGATE_TO_SUBAGENT_TOOL", () => {
  it("has the correct name", () => {
    expect(DELEGATE_TO_SUBAGENT_TOOL.name).toBe("delegate_to_subagent");
  });

  it("has a non-empty description", () => {
    expect(DELEGATE_TO_SUBAGENT_TOOL.description).toBeTruthy();
    expect(DELEGATE_TO_SUBAGENT_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(DELEGATE_TO_SUBAGENT_TOOL.input_schema.type).toBe("object");
  });

  it("requires title and instruction", () => {
    expect(DELEGATE_TO_SUBAGENT_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["title", "instruction"]),
    );
  });

  it("defines title as a string property", () => {
    const prop = DELEGATE_TO_SUBAGENT_TOOL.input_schema.properties.title;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("string");
  });

  it("defines instruction as a string property", () => {
    const prop = DELEGATE_TO_SUBAGENT_TOOL.input_schema.properties.instruction;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("string");
  });

  it("defines wait_for_result as an optional boolean", () => {
    const prop = DELEGATE_TO_SUBAGENT_TOOL.input_schema.properties.wait_for_result;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("boolean");
    expect(DELEGATE_TO_SUBAGENT_TOOL.input_schema.required).not.toContain("wait_for_result");
  });
});

// ─── DELEGATE_PARALLEL_TOOL ─────────────────────────────────────────────────

describe("DELEGATE_PARALLEL_TOOL", () => {
  it("has the correct name", () => {
    expect(DELEGATE_PARALLEL_TOOL.name).toBe("delegate_parallel");
  });

  it("has a non-empty description", () => {
    expect(DELEGATE_PARALLEL_TOOL.description).toBeTruthy();
    expect(DELEGATE_PARALLEL_TOOL.description.length).toBeGreaterThan(20);
  });

  it("requires tasks array", () => {
    expect(DELEGATE_PARALLEL_TOOL.input_schema.required).toContain("tasks");
  });

  it("defines tasks as an array with object items", () => {
    const prop = DELEGATE_PARALLEL_TOOL.input_schema.properties.tasks;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("array");
    expect(prop.items.type).toBe("object");
    expect(prop.items.required).toEqual(
      expect.arrayContaining(["title", "instruction"]),
    );
  });
});

// ─── CHECK_SUBAGENT_TOOL ────────────────────────────────────────────────────

describe("CHECK_SUBAGENT_TOOL", () => {
  it("has the correct name", () => {
    expect(CHECK_SUBAGENT_TOOL.name).toBe("check_subagent");
  });

  it("has a non-empty description", () => {
    expect(CHECK_SUBAGENT_TOOL.description).toBeTruthy();
    expect(CHECK_SUBAGENT_TOOL.description.length).toBeGreaterThan(20);
  });

  it("requires subagent_run_id", () => {
    expect(CHECK_SUBAGENT_TOOL.input_schema.required).toContain("subagent_run_id");
  });

  it("defines subagent_run_id as a string property", () => {
    const prop = CHECK_SUBAGENT_TOOL.input_schema.properties.subagent_run_id;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("string");
  });
});

// ─── Cross-tool consistency ─────────────────────────────────────────────────

describe("subagent tool definitions consistency", () => {
  const allTools = [
    DELEGATE_TO_SUBAGENT_TOOL,
    DELEGATE_PARALLEL_TOOL,
    CHECK_SUBAGENT_TOOL,
  ];

  it("all tools have unique names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tools have the standard LlmTool shape", () => {
    for (const tool of allTools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("input_schema");
      expect(tool.input_schema).toHaveProperty("type", "object");
      expect(tool.input_schema).toHaveProperty("properties");
      expect(tool.input_schema).toHaveProperty("required");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
    }
  });

  it("all tool names use snake_case", () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
