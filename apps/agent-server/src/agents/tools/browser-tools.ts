import type { LlmTool } from "@ai-cofounder/llm";

export const BROWSER_ACTION_TOOL: LlmTool = {
  name: "browser_action",
  description:
    "Interact with web pages using a real browser (Playwright). Supports navigating to URLs, taking screenshots, " +
    "extracting text, clicking elements, filling forms, and querying DOM elements. Use this instead of browse_web " +
    "when you need to interact with JavaScript-rendered SPAs, fill forms, click buttons, or take screenshots.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["navigate", "screenshot", "extract_text", "click", "fill", "get_elements"],
        description:
          "The browser action to perform: " +
          "navigate (go to a URL), " +
          "screenshot (capture the current page or element), " +
          "extract_text (get visible text from the page or a selector), " +
          "click (click an element by CSS selector), " +
          "fill (fill form fields by CSS selector), " +
          "get_elements (query elements and return their attributes/text)",
      },
      url: {
        type: "string",
        description: "URL to navigate to (required for navigate, optional for others — reuses current page)",
      },
      selector: {
        type: "string",
        description: "CSS selector for click, get_elements, or scoped extract_text",
      },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for the input field" },
            value: { type: "string", description: "Value to fill in" },
          },
          required: ["selector", "value"],
        },
        description: "Array of {selector, value} pairs for the fill action",
      },
      full_page: {
        type: "boolean",
        description: "Whether to capture a full-page screenshot (default: true)",
      },
      max_length: {
        type: "number",
        description: "Maximum character length for extract_text (default: 10000)",
      },
      max_results: {
        type: "number",
        description: "Maximum number of elements to return for get_elements (default: 20)",
      },
      wait_until: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        description: "When to consider navigation complete (default: load)",
      },
    },
    required: ["action"],
  },
};
