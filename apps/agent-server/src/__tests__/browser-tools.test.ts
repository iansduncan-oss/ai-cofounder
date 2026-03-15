import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { BROWSER_ACTION_TOOL } = await import(
  "../agents/tools/browser-tools.js"
);

describe("BROWSER_ACTION_TOOL definition", () => {
  it("has the correct name", () => {
    expect(BROWSER_ACTION_TOOL.name).toBe("browser_action");
  });

  it("has a non-empty description", () => {
    expect(BROWSER_ACTION_TOOL.description.length).toBeGreaterThan(20);
  });

  it("requires action", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.required).toContain("action");
  });

  it("defines action as string with enum", () => {
    const action = BROWSER_ACTION_TOOL.input_schema.properties.action;
    expect(action.type).toBe("string");
    expect(action.enum).toEqual([
      "navigate",
      "screenshot",
      "extract_text",
      "click",
      "fill",
      "get_elements",
    ]);
  });

  it("defines url as string", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.url.type).toBe("string");
  });

  it("defines selector as string", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.selector.type).toBe("string");
  });

  it("defines fields as array", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.fields.type).toBe("array");
  });

  it("defines full_page as boolean", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.full_page.type).toBe("boolean");
  });

  it("defines max_length as number", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.max_length.type).toBe("number");
  });

  it("defines max_results as number", () => {
    expect(BROWSER_ACTION_TOOL.input_schema.properties.max_results.type).toBe("number");
  });

  it("defines wait_until with valid enum", () => {
    const waitUntil = BROWSER_ACTION_TOOL.input_schema.properties.wait_until;
    expect(waitUntil.type).toBe("string");
    expect(waitUntil.enum).toEqual(["load", "domcontentloaded", "networkidle"]);
  });
});
