import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { BROWSE_WEB_TOOL, executeBrowseWeb } = await import(
  "../agents/tools/browse-web.js"
);

describe("BROWSE_WEB_TOOL definition", () => {
  it("has the correct name", () => {
    expect(BROWSE_WEB_TOOL.name).toBe("browse_web");
  });

  it("has a non-empty description", () => {
    expect(BROWSE_WEB_TOOL.description.length).toBeGreaterThan(20);
  });

  it("requires url", () => {
    expect(BROWSE_WEB_TOOL.input_schema.required).toContain("url");
  });

  it("defines url as string", () => {
    expect(BROWSE_WEB_TOOL.input_schema.properties.url.type).toBe("string");
  });

  it("defines max_length as number", () => {
    expect(BROWSE_WEB_TOOL.input_schema.properties.max_length.type).toBe("number");
  });
});

describe("executeBrowseWeb", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches and returns cleaned page content", async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <script>var x = 1;</script>
          <style>.foo { color: red; }</style>
          <nav>Navigation</nav>
          <main><p>Hello World</p></main>
          <footer>Footer content</footer>
        </body>
      </html>
    `;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await executeBrowseWeb("https://example.com");

    expect(result).toEqual({
      url: "https://example.com",
      title: "Test Page",
      content: expect.stringContaining("Hello World"),
      truncated: false,
    });
    // Scripts, styles, nav, footer should be stripped
    expect((result as { content: string }).content).not.toContain("var x = 1");
    expect((result as { content: string }).content).not.toContain("Navigation");
    expect((result as { content: string }).content).not.toContain("Footer content");
  });

  it("returns error on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await executeBrowseWeb("https://example.com/missing");

    expect(result).toEqual({ error: "Failed to fetch URL: 404" });
  });

  it("returns error on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await executeBrowseWeb("https://example.com");

    expect(result).toEqual({ error: "Browse failed: ECONNREFUSED" });
  });

  it("truncates content exceeding max_length", async () => {
    const longContent = "A".repeat(500);
    const html = `<html><head><title>Long</title></head><body>${longContent}</body></html>`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await executeBrowseWeb("https://example.com", 100);

    expect(result).toEqual({
      url: "https://example.com",
      title: "Long",
      content: expect.any(String),
      truncated: true,
    });
    expect((result as { content: string }).content.length).toBe(100);
  });

  it("does not truncate short content", async () => {
    const html = `<html><head><title>Short</title></head><body>Brief</body></html>`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await executeBrowseWeb("https://example.com", 10000);

    expect((result as { truncated: boolean }).truncated).toBe(false);
  });
});
