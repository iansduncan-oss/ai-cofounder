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

const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});
const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});
const mockSaveMemory = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({}),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
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

vi.mock("../agents/tools/verification-tools.js", () => ({
  VERIFY_RESULT_TOOL: {
    name: "submit_verification",
    description: "submit verification",
    input_schema: { type: "object", properties: {}, required: [] },
  },
}));

vi.mock("../agents/tools/filesystem-tools.js", () => ({
  READ_FILE_TOOL: { name: "read_file", description: "r", input_schema: { type: "object", properties: {} } },
  LIST_DIRECTORY_TOOL: { name: "list_directory", description: "l", input_schema: { type: "object", properties: {} } },
}));

vi.mock("../agents/tools/git-tools.js", () => ({
  GIT_STATUS_TOOL: { name: "git_status", description: "s", input_schema: { type: "object", properties: {} } },
  GIT_LOG_TOOL: { name: "git_log", description: "l", input_schema: { type: "object", properties: {} } },
  GIT_DIFF_TOOL: { name: "git_diff", description: "d", input_schema: { type: "object", properties: {} } },
}));

vi.mock("../agents/tools/workspace-tools.js", () => ({
  RUN_TESTS_TOOL: { name: "run_tests", description: "t", input_schema: { type: "object", properties: {} } },
}));

const { VerificationService } = await import("../services/verification.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

function toolUseResponse(name: string, input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: `tu-${name}`, name, input }],
    model: "test-model",
    stop_reason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 15 },
    provider: "test",
  };
}

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerificationService", () => {
  function createService(notificationService?: any) {
    const registry = new LlmRegistry();
    const db = {} as any;
    return new VerificationService(registry, db, notificationService);
  }

  describe("verify", () => {
    it("skips verification for non-code goals", async () => {
      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Research something",
        taskResults: [
          { id: "t-1", title: "Research", agent: "researcher", status: "completed", output: "findings" },
        ],
      });

      expect(result).toBeNull();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("skips verification when code tasks failed (not completed)", async () => {
      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build feature",
        taskResults: [
          { id: "t-1", title: "Code it", agent: "coder", status: "failed", output: "error" },
        ],
      });

      expect(result).toBeNull();
    });

    it("runs verification for code goals and stores result", async () => {
      const verdict = {
        verdict: "pass",
        confidence: 0.9,
        summary: "All checks passed",
        checks: [{ name: "tests_pass", passed: true }],
      };

      mockComplete
        .mockResolvedValueOnce(toolUseResponse("submit_verification", verdict))
        .mockResolvedValueOnce(textResponse("Verification complete"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build auth",
        taskResults: [
          { id: "t-1", title: "Write code", agent: "coder", status: "completed", output: "code here" },
        ],
        userId: "user-1",
      });

      expect(result).not.toBeNull();
      expect(result!.verdict).toBe("pass");
      expect(result!.confidence).toBe(0.9);
      expect(result!.model).toBe("test-model");
      expect(result!.provider).toBe("test");

      // Should store in metadata
      expect(mockUpdateGoalMetadata).toHaveBeenCalledWith(
        expect.anything(),
        "g-1",
        expect.objectContaining({ verification: expect.objectContaining({ verdict: "pass" }) }),
      );

      // Should NOT set to needs_review on pass
      expect(mockUpdateGoalStatus).not.toHaveBeenCalled();

      // Should save memory
      expect(mockSaveMemory).toHaveBeenCalled();
    });

    it("sets goal to needs_review on failure", async () => {
      const verdict = {
        verdict: "fail",
        confidence: 0.85,
        summary: "Tests failed",
        checks: [{ name: "tests_pass", passed: false, detail: "3 failures" }],
        suggestions: ["Fix the failing tests"],
      };

      mockComplete
        .mockResolvedValueOnce(toolUseResponse("submit_verification", verdict))
        .mockResolvedValueOnce(textResponse("Verification failed"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build auth",
        taskResults: [
          { id: "t-1", title: "Write code", agent: "coder", status: "completed", output: "code" },
        ],
        userId: "user-1",
      });

      expect(result!.verdict).toBe("fail");
      expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), "g-1", "needs_review");
    });

    it("handles agent errors gracefully (returns null)", async () => {
      mockComplete.mockRejectedValueOnce(new Error("LLM unavailable"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build feature",
        taskResults: [
          { id: "t-1", title: "Code", agent: "coder", status: "completed", output: "code" },
        ],
      });

      expect(result).toBeNull();
    });

    it("triggers verification for debugger tasks", async () => {
      mockComplete
        .mockResolvedValueOnce(toolUseResponse("submit_verification", {
          verdict: "pass",
          confidence: 0.8,
          summary: "Bug fix verified",
          checks: [{ name: "regression_check", passed: true }],
        }))
        .mockResolvedValueOnce(textResponse("Done"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Fix bug",
        taskResults: [
          { id: "t-1", title: "Debug issue", agent: "debugger", status: "completed", output: "fixed" },
        ],
      });

      expect(result).not.toBeNull();
      expect(result!.verdict).toBe("pass");
    });

    it("triggers verification for doc_writer tasks", async () => {
      mockComplete
        .mockResolvedValueOnce(toolUseResponse("submit_verification", {
          verdict: "pass",
          confidence: 0.7,
          summary: "Docs verified",
          checks: [{ name: "docs_complete", passed: true }],
        }))
        .mockResolvedValueOnce(textResponse("Done"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Write docs",
        taskResults: [
          { id: "t-1", title: "Write README", agent: "doc_writer", status: "completed", output: "# README" },
        ],
      });

      expect(result).not.toBeNull();
    });

    it("sends notification on verification", async () => {
      const mockNotification = {
        notifyGoalCompleted: vi.fn().mockResolvedValue(undefined),
      };

      mockComplete
        .mockResolvedValueOnce(toolUseResponse("submit_verification", {
          verdict: "pass",
          confidence: 0.9,
          summary: "Passed",
          checks: [],
        }))
        .mockResolvedValueOnce(textResponse("Done"));

      const service = createService(mockNotification);
      await service.verify({
        goalId: "g-1",
        goalTitle: "Feature",
        taskResults: [
          { id: "t-1", title: "Code", agent: "coder", status: "completed", output: "code" },
        ],
      });

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 10));

      expect(mockNotification.notifyGoalCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: "g-1", status: "verified" }),
      );
    });

    it("falls back to text parsing when agent does not call submit_verification", async () => {
      mockComplete.mockResolvedValueOnce(textResponse("Verdict: pass — all tests pass and code compiles"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build feature",
        taskResults: [
          { id: "t-1", title: "Code", agent: "coder", status: "completed", output: "code" },
        ],
      });

      expect(result).not.toBeNull();
      expect(result!.verdict).toBe("pass");
      expect(result!.confidence).toBe(0.5); // fallback confidence
    });

    it("returns null when agent produces no verdict at all", async () => {
      mockComplete.mockResolvedValueOnce(textResponse("I could not determine the result"));

      const service = createService();
      const result = await service.verify({
        goalId: "g-1",
        goalTitle: "Build feature",
        taskResults: [
          { id: "t-1", title: "Code", agent: "coder", status: "completed", output: "code" },
        ],
      });

      expect(result).toBeNull();
    });
  });
});
