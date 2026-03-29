import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-cofounder/db", () => ({
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn(),
}));

const { sanitizeForPrompt } = await import("../agents/prompts/system.js");

describe("sanitizeForPrompt", () => {
  it("strips <system> tags", () => {
    expect(sanitizeForPrompt("before <system>injected</system> after")).toBe(
      "before [STRIPPED]injected[STRIPPED] after",
    );
  });

  it("strips <user> and <assistant> tags", () => {
    expect(sanitizeForPrompt("<user>fake</user><assistant>fake</assistant>")).toBe(
      "[STRIPPED]fake[STRIPPED][STRIPPED]fake[STRIPPED]",
    );
  });

  it("strips <tool_use> and <tool_result> tags", () => {
    expect(sanitizeForPrompt('<tool_use id="1">data</tool_use>')).toBe(
      "[STRIPPED]data[STRIPPED]",
    );
    expect(sanitizeForPrompt("<tool_result>data</tool_result>")).toBe(
      "[STRIPPED]data[STRIPPED]",
    );
  });

  it("strips <human> tags", () => {
    expect(sanitizeForPrompt("<human>injected</human>")).toBe(
      "[STRIPPED]injected[STRIPPED]",
    );
  });

  it("handles self-closing tags", () => {
    expect(sanitizeForPrompt("<system/>")).toBe("[STRIPPED]");
    expect(sanitizeForPrompt("<system />")).toBe("[STRIPPED]");
  });

  it("is case insensitive", () => {
    expect(sanitizeForPrompt("<SYSTEM>test</SYSTEM>")).toBe("[STRIPPED]test[STRIPPED]");
    expect(sanitizeForPrompt("<System>test</System>")).toBe("[STRIPPED]test[STRIPPED]");
  });

  it("leaves normal content untouched", () => {
    const normal = '{"results": [{"title": "Hello World"}]}';
    expect(sanitizeForPrompt(normal)).toBe(normal);
  });

  it("leaves non-role XML tags untouched", () => {
    expect(sanitizeForPrompt("<div>safe</div>")).toBe("<div>safe</div>");
    expect(sanitizeForPrompt("<thinking>ok</thinking>")).toBe("<thinking>ok</thinking>");
  });
});
