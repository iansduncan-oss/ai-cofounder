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

const { executeCreatePr } = await import("../agents/tools/github-tools.js");

describe("executeCreatePr", () => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken) {
      process.env.GITHUB_TOKEN = originalToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("returns error when GITHUB_TOKEN is not set", async () => {
    const result = await executeCreatePr({
      owner: "test-owner",
      repo: "test-repo",
      title: "Test PR",
      head: "feature-branch",
    });

    expect(result).toEqual({ error: "GITHUB_TOKEN environment variable is not set" });
  });

  it("creates a PR successfully", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";

    const mockPr = {
      number: 42,
      html_url: "https://github.com/test-owner/test-repo/pull/42",
      title: "Test PR",
      state: "open",
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPr),
    });

    const result = await executeCreatePr({
      owner: "test-owner",
      repo: "test-repo",
      title: "Test PR",
      head: "feature-branch",
      base: "develop",
      body: "PR description",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/test-owner/test-repo/pulls",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer ghp_test123",
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: "Test PR",
          head: "feature-branch",
          base: "develop",
          body: "PR description",
        }),
      },
    );

    expect(result).toEqual({
      number: 42,
      html_url: "https://github.com/test-owner/test-repo/pull/42",
      title: "Test PR",
      state: "open",
    });
  });

  it("handles GitHub API non-200 response", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"message":"Validation Failed"}'),
    });

    const result = await executeCreatePr({
      owner: "test-owner",
      repo: "test-repo",
      title: "Test PR",
      head: "feature-branch",
    });

    expect(result).toEqual({
      error: 'GitHub API error 422: {"message":"Validation Failed"}',
    });
  });

  it("handles fetch network error", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";

    global.fetch = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com"));

    const result = await executeCreatePr({
      owner: "test-owner",
      repo: "test-repo",
      title: "Test PR",
      head: "feature-branch",
    });

    expect(result).toEqual({
      error: "getaddrinfo ENOTFOUND api.github.com",
    });
  });
});
