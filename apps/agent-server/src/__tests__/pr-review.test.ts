import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
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
  return { LlmRegistry: MockLlmRegistry };
});

// Mock child_process to avoid real git/gh calls
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const { PrReviewService } = await import("../services/pr-review.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

describe("PrReviewService", () => {
  let service: InstanceType<typeof PrReviewService>;
  let registry: InstanceType<typeof LlmRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new LlmRegistry();
    service = new PrReviewService(registry);
  });

  it("reviewPr() generates structured review from diff", async () => {
    // Mock getPrDiff via child_process
    const { execFileSync } = await import("node:child_process");
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n+added line\n-removed line\n",
    );

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "Adds a new feature and removes old code.",
            issues: [
              { file: "file.ts", line: 10, severity: "warning", message: "Possible null ref" },
            ],
            approval: "approve",
          }),
        },
      ],
    });

    const result = await service.reviewPr("/repo", "#42");

    expect(result.summary).toBe("Adds a new feature and removes old code.");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("warning");
    expect(result.approval).toBe("approve");
    expect(result.files_changed).toBe(1);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it("handles large diffs by truncating at 15KB", async () => {
    const { execFileSync } = await import("node:child_process");
    const largeDiff =
      "diff --git a/file.ts b/file.ts\n" + "+a\n".repeat(20000);
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(largeDiff);

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "Large change.",
            issues: [],
            approval: "comment",
          }),
        },
      ],
    });

    await service.reviewPr("/repo", "#1");

    // Verify LLM received truncated diff
    const callArgs = mockComplete.mock.calls[0];
    const messageText = callArgs[1].messages[0].content[0].text;
    expect(messageText).toContain("[... diff truncated]");
  });

  it("parses LLM response as JSON", async () => {
    const { execFileSync } = await import("node:child_process");
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "diff --git a/x.ts b/x.ts\n+line\n",
    );

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: 'Here is my review:\n```json\n{"summary":"Good PR","issues":[],"approval":"approve"}\n```',
        },
      ],
    });

    const result = await service.reviewPr("/repo", "#5");

    expect(result.summary).toBe("Good PR");
    expect(result.approval).toBe("approve");
    expect(result.issues).toEqual([]);
  });

  it("falls back to raw text on JSON parse failure", async () => {
    const { execFileSync } = await import("node:child_process");
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "diff --git a/x.ts b/x.ts\n+line\n",
    );

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "This PR looks fine overall. No major issues found.",
        },
      ],
    });

    const result = await service.reviewPr("/repo", "#6");

    expect(result.summary).toBe("This PR looks fine overall. No major issues found.");
    expect(result.issues).toEqual([]);
    expect(result.approval).toBe("comment");
  });

  it("counts additions/deletions from diff", async () => {
    const { execFileSync } = await import("node:child_process");
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "+new line 1",
      "+new line 2",
      "+new line 3",
      "-old line 1",
      "-old line 2",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "+another add",
    ].join("\n");
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(diff);

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ summary: "Multi-file change", issues: [], approval: "approve" }),
        },
      ],
    });

    const result = await service.reviewPr("/repo", "#7");

    expect(result.additions).toBe(4);
    expect(result.deletions).toBe(2);
    expect(result.files_changed).toBe(2);
  });

  it("handles empty diff", async () => {
    const { execFileSync } = await import("node:child_process");
    // Both gh and git fail
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => { throw new Error("gh not found"); })
      .mockReturnValueOnce("");

    const result = await service.reviewPr("/repo", "#8");

    expect(result.summary).toContain("No diff found");
    expect(result.issues).toEqual([]);
    expect(result.approval).toBe("comment");
    expect(result.files_changed).toBe(0);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("normalizes invalid approval values to 'comment'", async () => {
    const { execFileSync } = await import("node:child_process");
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "diff --git a/x.ts b/x.ts\n+line\n",
    );

    mockComplete.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "Review",
            issues: [],
            approval: "invalid_value",
          }),
        },
      ],
    });

    const result = await service.reviewPr("/repo", "#9");
    expect(result.approval).toBe("comment");
  });
});
