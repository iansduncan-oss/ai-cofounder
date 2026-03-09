import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
}));

const mockComplete = vi.fn();

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
  };
});

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: {
    name: "search_web",
    description: "search",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  RECALL_MEMORIES_TOOL: {
    name: "recall_memories",
    description: "recall",
    input_schema: { type: "object", properties: {} },
  },
}));

vi.mock("../agents/tools/filesystem-tools.js", () => ({
  READ_FILE_TOOL: {
    name: "read_file",
    description: "read file",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  WRITE_FILE_TOOL: {
    name: "write_file",
    description: "write file",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  LIST_DIRECTORY_TOOL: {
    name: "list_directory",
    description: "list dir",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  },
}));

const { DocWriterAgent } = await import("../agents/specialists/doc-writer.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");
const { executeWebSearch } = await import("../agents/tools/web-search.js");
const { recallMemories, searchMemoriesByVector } = await import("@ai-cofounder/db");

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

function toolUseResponse(name: string, input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: `tu-${name}`, name, input }],
    model: "test-model",
    stop_reason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 15 },
    provider: "test",
  };
}

const baseContext = {
  taskId: "task-1",
  taskTitle: "Write API documentation",
  taskDescription: "Generate README and API docs for the workspace service",
  goalTitle: "Improve project documentation",
  userId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DocWriterAgent", () => {
  it("has the correct role and taskCategory", () => {
    const agent = new DocWriterAgent(new LlmRegistry());
    expect(agent.role).toBe("doc_writer");
    expect(agent.taskCategory).toBe("code");
  });

  it("returns base tools without workspace", () => {
    const agent = new DocWriterAgent(new LlmRegistry());
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("search_web");
    expect(names).toContain("recall_memories");
    expect(names).not.toContain("read_file");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("list_directory");
  });

  it("includes workspace tools when workspaceService is provided", () => {
    const mockWorkspace = { readFile: vi.fn(), writeFile: vi.fn(), listDirectory: vi.fn() };
    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("search_web");
    expect(names).toContain("recall_memories");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_directory");
  });

  it("executes a simple doc-writing task without tools", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("# Workspace Service\n\nManages file operations."));

    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("Workspace Service");
    expect(result.model).toBe("test-model");
    expect(result.provider).toBe("test");
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("handles read_file tool use", async () => {
    const mockWorkspace = {
      readFile: vi.fn().mockResolvedValue("export function hello() { return 'world'; }"),
      writeFile: vi.fn(),
      listDirectory: vi.fn(),
    };

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "src/index.ts" }))
      .mockResolvedValueOnce(textResponse("## API\n\n`hello()` - Returns 'world'"));

    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("hello()");
    expect(mockWorkspace.readFile).toHaveBeenCalledWith("src/index.ts");
  });

  it("handles write_file tool use", async () => {
    const mockWorkspace = {
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      listDirectory: vi.fn(),
    };

    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("write_file", { path: "README.md", content: "# Project\nDocs here." }),
      )
      .mockResolvedValueOnce(textResponse("Documentation written to README.md"));

    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("README.md");
    expect(mockWorkspace.writeFile).toHaveBeenCalledWith("README.md", "# Project\nDocs here.");
  });

  it("handles list_directory tool use", async () => {
    const mockWorkspace = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      listDirectory: vi.fn().mockResolvedValue([
        { name: "index.ts", type: "file" },
        { name: "utils", type: "directory" },
      ]),
    };

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("list_directory", { path: "src" }))
      .mockResolvedValueOnce(textResponse("Found index.ts and utils/ directory"));

    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("index.ts");
    expect(mockWorkspace.listDirectory).toHaveBeenCalledWith("src");
  });

  it("handles list_directory without path param", async () => {
    const mockWorkspace = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      listDirectory: vi.fn().mockResolvedValue([{ name: "src", type: "directory" }]),
    };

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("list_directory", {}))
      .mockResolvedValueOnce(textResponse("Root contains src/"));

    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    await agent.execute(baseContext);

    expect(mockWorkspace.listDirectory).toHaveBeenCalledWith(".");
  });

  it("handles search_web tool use", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("search_web", { query: "JSDoc best practices TypeScript" }),
      )
      .mockResolvedValueOnce(textResponse("Based on best practices: use @param tags"));

    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("@param");
    expect(executeWebSearch).toHaveBeenCalledWith("JSDoc best practices TypeScript", undefined);
  });

  it("handles recall_memories tool use with text fallback", async () => {
    (recallMemories as any).mockResolvedValueOnce([
      { key: "arch-decision", category: "technical", content: "We use Fastify for the API server" },
    ]);

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("recall_memories", { query: "architecture" }))
      .mockResolvedValueOnce(textResponse("Architecture uses Fastify for API server"));

    const db = {} as any;
    const agent = new DocWriterAgent(new LlmRegistry(), db);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("Fastify");
    expect(recallMemories).toHaveBeenCalled();
  });

  it("handles recall_memories with vector search", async () => {
    const mockEmbeddingService = {
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
    };

    (searchMemoriesByVector as any).mockResolvedValueOnce([
      { key: "docs-style", category: "technical", content: "Use markdown for docs", distance: 0.1 },
    ]);

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("recall_memories", { query: "doc style" }))
      .mockResolvedValueOnce(textResponse("Following markdown style"));

    const db = {} as any;
    const agent = new DocWriterAgent(new LlmRegistry(), db, mockEmbeddingService as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("markdown");
    expect(mockEmbeddingService.embed).toHaveBeenCalledWith("doc style");
    expect(searchMemoriesByVector).toHaveBeenCalled();
  });

  it("returns error for recall_memories without user context", async () => {
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("recall_memories", { query: "test" }))
      .mockResolvedValueOnce(textResponse("No memories available"));

    const contextNoUser = { ...baseContext, userId: undefined };
    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(contextNoUser);

    expect(result.output).toBe("No memories available");
  });

  it("returns error for workspace tools without workspace", async () => {
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "test.ts" }))
      .mockResolvedValueOnce(textResponse("Workspace not available"));

    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("Workspace not available");
  });

  it("handles read_file error gracefully", async () => {
    const mockWorkspace = {
      readFile: vi.fn().mockRejectedValue(new Error("File not found")),
      writeFile: vi.fn(),
      listDirectory: vi.fn(),
    };

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "nonexistent.ts" }))
      .mockResolvedValueOnce(textResponse("File not found, skipping"));

    const agent = new DocWriterAgent(new LlmRegistry(), undefined, undefined, mockWorkspace as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("skipping");
  });

  it("handles unknown tool gracefully", async () => {
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("unknown_tool", {}))
      .mockResolvedValueOnce(textResponse("Proceeding without tool"));

    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toBe("Proceeding without tool");
  });

  it("includes previous outputs in context", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Building on research findings"));

    const contextWithOutputs = {
      ...baseContext,
      previousOutputs: ["Research: the codebase uses Fastify + TypeScript"],
    };

    const agent = new DocWriterAgent(new LlmRegistry());
    await agent.execute(contextWithOutputs);

    const callArgs = mockComplete.mock.calls[0];
    const messages = callArgs[1].messages;
    expect(messages[0].content).toContain("Previous Task Outputs");
    expect(messages[0].content).toContain("Fastify");
  });

  it("accumulates token usage across tool rounds", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("search_web", { query: "doc standards" }),
      )
      .mockResolvedValueOnce(textResponse("Final documentation output"));

    const agent = new DocWriterAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.usage.inputTokens).toBe(20); // 10 + 10
    expect(result.usage.outputTokens).toBe(35); // 15 + 20
  });
});
