import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

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

const { optionalEnv } = await import("@ai-cofounder/shared");
const mockOptionalEnv = optionalEnv as ReturnType<typeof vi.fn>;

const { SEARCH_WEB_TOOL, executeWebSearch } = await import(
  "../agents/tools/web-search.js"
);
const { SAVE_MEMORY_TOOL, RECALL_MEMORIES_TOOL } = await import(
  "../agents/tools/memory-tools.js"
);
const { TRIGGER_N8N_WORKFLOW_TOOL, LIST_N8N_WORKFLOWS_TOOL } = await import(
  "../agents/tools/n8n-tools.js"
);
const { EXECUTE_CODE_TOOL } = await import("../agents/tools/sandbox-tools.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Web Search Tool Definition ─────────────────────────────────────────────

describe("SEARCH_WEB_TOOL", () => {
  it("has the correct name", () => {
    expect(SEARCH_WEB_TOOL.name).toBe("search_web");
  });

  it("has a non-empty description", () => {
    expect(SEARCH_WEB_TOOL.description).toBeTruthy();
    expect(SEARCH_WEB_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(SEARCH_WEB_TOOL.input_schema.type).toBe("object");
  });

  it("requires 'query' parameter", () => {
    expect(SEARCH_WEB_TOOL.input_schema.required).toContain("query");
  });

  it("defines 'query' as a string property", () => {
    const queryProp = SEARCH_WEB_TOOL.input_schema.properties.query;
    expect(queryProp).toBeDefined();
    expect(queryProp.type).toBe("string");
  });

  it("defines 'max_results' as a number property", () => {
    const maxResultsProp = SEARCH_WEB_TOOL.input_schema.properties.max_results;
    expect(maxResultsProp).toBeDefined();
    expect(maxResultsProp.type).toBe("number");
  });

  it("does not require max_results", () => {
    expect(SEARCH_WEB_TOOL.input_schema.required).not.toContain("max_results");
  });
});

// ─── executeWebSearch ───────────────────────────────────────────────────────

describe("executeWebSearch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error when TAVILY_API_KEY is not set", async () => {
    mockOptionalEnv.mockReturnValue("");

    const result = await executeWebSearch("test query");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("not configured");
  });

  it("calls Tavily API with correct parameters", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "Result 1", url: "https://example.com", content: "Content", score: 0.9 },
        ],
        answer: "An answer",
      }),
    });
    globalThis.fetch = mockFetch;

    await executeWebSearch("test query", 3);

    expect(mockFetch).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: "test-tavily-key",
        query: "test query",
        max_results: 3,
        include_answer: true,
        search_depth: "advanced",
      }),
    }));
  });

  it("returns results and answer on success", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "Title A", url: "https://a.com", content: "Content A", score: 0.95 },
          { title: "Title B", url: "https://b.com", content: "Content B", score: 0.85 },
        ],
        answer: "Summary answer",
      }),
    });

    const result = await executeWebSearch("search term");

    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("answer", "Summary answer");
    const { results } = result as { results: any[]; answer: string };
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Title A",
      url: "https://a.com",
      content: "Content A",
      score: 0.95,
    });
  });

  it("caps max_results at 10", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], answer: undefined }),
    });
    globalThis.fetch = mockFetch;

    await executeWebSearch("query", 50);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_results).toBe(10);
  });

  it("defaults max_results to 5", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], answer: undefined }),
    });
    globalThis.fetch = mockFetch;

    await executeWebSearch("query");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_results).toBe(5);
  });

  it("returns error on non-ok response", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const result = await executeWebSearch("query");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("429");
  });

  it("returns error on fetch exception", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    const result = await executeWebSearch("query");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Web search request failed");
  });

  it("strips extra fields from results", async () => {
    mockOptionalEnv.mockReturnValue("test-tavily-key");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "T",
            url: "https://t.com",
            content: "C",
            score: 0.5,
            extra_field: "should not appear",
            raw_html: "<p>raw</p>",
          },
        ],
      }),
    });

    const result = await executeWebSearch("query");
    const { results } = result as { results: any[] };
    expect(results[0]).toEqual({ title: "T", url: "https://t.com", content: "C", score: 0.5 });
    expect(results[0]).not.toHaveProperty("extra_field");
    expect(results[0]).not.toHaveProperty("raw_html");
  });
});

// ─── Memory Tool Definitions ────────────────────────────────────────────────

describe("SAVE_MEMORY_TOOL", () => {
  it("has the correct name", () => {
    expect(SAVE_MEMORY_TOOL.name).toBe("save_memory");
  });

  it("has a non-empty description", () => {
    expect(SAVE_MEMORY_TOOL.description).toBeTruthy();
    expect(SAVE_MEMORY_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(SAVE_MEMORY_TOOL.input_schema.type).toBe("object");
  });

  it("requires category, key, and content", () => {
    expect(SAVE_MEMORY_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["category", "key", "content"]),
    );
  });

  it("defines category with valid enum values", () => {
    const categoryProp = SAVE_MEMORY_TOOL.input_schema.properties.category;
    expect(categoryProp).toBeDefined();
    expect(categoryProp.type).toBe("string");
    expect(categoryProp.enum).toEqual(
      expect.arrayContaining([
        "user_info",
        "preferences",
        "projects",
        "decisions",
        "goals",
        "technical",
        "business",
        "other",
      ]),
    );
  });

  it("defines key as a string property", () => {
    const keyProp = SAVE_MEMORY_TOOL.input_schema.properties.key;
    expect(keyProp).toBeDefined();
    expect(keyProp.type).toBe("string");
  });

  it("defines content as a string property", () => {
    const contentProp = SAVE_MEMORY_TOOL.input_schema.properties.content;
    expect(contentProp).toBeDefined();
    expect(contentProp.type).toBe("string");
  });
});

describe("RECALL_MEMORIES_TOOL", () => {
  it("has the correct name", () => {
    expect(RECALL_MEMORIES_TOOL.name).toBe("recall_memories");
  });

  it("has a non-empty description", () => {
    expect(RECALL_MEMORIES_TOOL.description).toBeTruthy();
    expect(RECALL_MEMORIES_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(RECALL_MEMORIES_TOOL.input_schema.type).toBe("object");
  });

  it("does not require any parameters", () => {
    expect(RECALL_MEMORIES_TOOL.input_schema.required).toEqual([]);
  });

  it("defines category with the same enum as save_memory", () => {
    const categoryProp = RECALL_MEMORIES_TOOL.input_schema.properties.category;
    expect(categoryProp).toBeDefined();
    expect(categoryProp.type).toBe("string");
    expect(categoryProp.enum).toEqual(
      SAVE_MEMORY_TOOL.input_schema.properties.category.enum,
    );
  });

  it("defines query as a string property", () => {
    const queryProp = RECALL_MEMORIES_TOOL.input_schema.properties.query;
    expect(queryProp).toBeDefined();
    expect(queryProp.type).toBe("string");
  });
});

// ─── N8N Tool Definitions ───────────────────────────────────────────────────

describe("TRIGGER_N8N_WORKFLOW_TOOL", () => {
  it("has the correct name", () => {
    expect(TRIGGER_N8N_WORKFLOW_TOOL.name).toBe("trigger_workflow");
  });

  it("has a non-empty description", () => {
    expect(TRIGGER_N8N_WORKFLOW_TOOL.description).toBeTruthy();
    expect(TRIGGER_N8N_WORKFLOW_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(TRIGGER_N8N_WORKFLOW_TOOL.input_schema.type).toBe("object");
  });

  it("requires workflow_name and payload", () => {
    expect(TRIGGER_N8N_WORKFLOW_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["workflow_name", "payload"]),
    );
  });

  it("defines workflow_name as a string property", () => {
    const prop = TRIGGER_N8N_WORKFLOW_TOOL.input_schema.properties.workflow_name;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("string");
  });

  it("defines payload as an object property", () => {
    const prop = TRIGGER_N8N_WORKFLOW_TOOL.input_schema.properties.payload;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("object");
  });
});

describe("LIST_N8N_WORKFLOWS_TOOL", () => {
  it("has the correct name", () => {
    expect(LIST_N8N_WORKFLOWS_TOOL.name).toBe("list_workflows");
  });

  it("has a non-empty description", () => {
    expect(LIST_N8N_WORKFLOWS_TOOL.description).toBeTruthy();
    expect(LIST_N8N_WORKFLOWS_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(LIST_N8N_WORKFLOWS_TOOL.input_schema.type).toBe("object");
  });

  it("has no required parameters", () => {
    expect(LIST_N8N_WORKFLOWS_TOOL.input_schema.required).toEqual([]);
  });

  it("has empty properties (no input needed)", () => {
    expect(Object.keys(LIST_N8N_WORKFLOWS_TOOL.input_schema.properties)).toHaveLength(0);
  });
});

// ─── Sandbox Tool Definition ────────────────────────────────────────────────

describe("EXECUTE_CODE_TOOL", () => {
  it("has the correct name", () => {
    expect(EXECUTE_CODE_TOOL.name).toBe("execute_code");
  });

  it("has a non-empty description", () => {
    expect(EXECUTE_CODE_TOOL.description).toBeTruthy();
    expect(EXECUTE_CODE_TOOL.description.length).toBeGreaterThan(20);
  });

  it("has type 'object' input_schema", () => {
    expect(EXECUTE_CODE_TOOL.input_schema.type).toBe("object");
  });

  it("requires code and language", () => {
    expect(EXECUTE_CODE_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["code", "language"]),
    );
  });

  it("defines code as a string property", () => {
    const codeProp = EXECUTE_CODE_TOOL.input_schema.properties.code;
    expect(codeProp).toBeDefined();
    expect(codeProp.type).toBe("string");
  });

  it("defines language with valid enum values", () => {
    const langProp = EXECUTE_CODE_TOOL.input_schema.properties.language;
    expect(langProp).toBeDefined();
    expect(langProp.type).toBe("string");
    expect(langProp.enum).toEqual(
      expect.arrayContaining(["typescript", "javascript", "python", "bash"]),
    );
  });

  it("defines timeout_ms as optional number", () => {
    const timeoutProp = EXECUTE_CODE_TOOL.input_schema.properties.timeout_ms;
    expect(timeoutProp).toBeDefined();
    expect(timeoutProp.type).toBe("number");
    expect(EXECUTE_CODE_TOOL.input_schema.required).not.toContain("timeout_ms");
  });
});

// ─── Cross-tool consistency ─────────────────────────────────────────────────

describe("tool definitions consistency", () => {
  const allTools = [
    SEARCH_WEB_TOOL,
    SAVE_MEMORY_TOOL,
    RECALL_MEMORIES_TOOL,
    TRIGGER_N8N_WORKFLOW_TOOL,
    LIST_N8N_WORKFLOWS_TOOL,
    EXECUTE_CODE_TOOL,
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
