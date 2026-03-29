import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock DNS lookup
const mockLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

// Mock fs for screenshot directory creation
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock playwright-core
const mockScreenshot = vi.fn().mockResolvedValue(undefined);
const mockGoto = vi.fn().mockResolvedValue(undefined);
const mockTitle = vi.fn().mockResolvedValue("Test Page");
const mockUrl = vi.fn().mockReturnValue("https://example.com");
const mockClick = vi.fn().mockResolvedValue(undefined);
const mockFill = vi.fn().mockResolvedValue(undefined);
const mockWaitForTimeout = vi.fn().mockResolvedValue(undefined);
const mockTextContent = vi.fn().mockResolvedValue("Hello World");
const mockDollar = vi.fn().mockResolvedValue({ textContent: mockTextContent });
const mockDollarDollar = vi.fn().mockResolvedValue([]);
const mockLocator = vi.fn().mockReturnValue({ textContent: mockTextContent });
const mockSetDefaultTimeout = vi.fn();

const mockPage = {
  goto: mockGoto,
  title: mockTitle,
  url: mockUrl,
  screenshot: mockScreenshot,
  click: mockClick,
  fill: mockFill,
  waitForTimeout: mockWaitForTimeout,
  $: mockDollar,
  $$: mockDollarDollar,
  locator: mockLocator,
  setDefaultTimeout: mockSetDefaultTimeout,
};

const mockRoute = vi.fn().mockResolvedValue(undefined);
const mockContextClose = vi.fn().mockResolvedValue(undefined);

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  route: mockRoute,
  close: mockContextClose,
};

const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
const mockNewContext = vi.fn().mockResolvedValue(mockContext);

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: mockNewContext,
      close: mockBrowserClose,
    }),
  },
}));

const { BrowserService } = await import("../services/browser.js");

describe("BrowserService", () => {
  let service: InstanceType<typeof BrowserService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue({ address: "93.184.216.34" });
    service = new BrowserService({ maxContexts: 2, screenshotDir: "/tmp/test-screenshots" });
  });

  describe("lifecycle", () => {
    it("initializes and sets available flag", async () => {
      expect(service.available).toBe(false);
      await service.init();
      expect(service.available).toBe(true);
    });

    it("closes browser and resets available flag", async () => {
      await service.init();
      expect(service.available).toBe(true);
      await service.close();
      expect(service.available).toBe(false);
      expect(mockBrowserClose).toHaveBeenCalled();
    });

    it("handles close when not initialized", async () => {
      await service.close(); // should not throw
    });
  });

  describe("execute", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("returns error when service not available", async () => {
      const unavailable = new BrowserService();
      const result = await unavailable.execute({ action: "navigate", url: "https://example.com" });
      expect(result).toEqual({ error: expect.stringContaining("not available") });
    });

    it("navigates to a URL", async () => {
      const result = await service.execute({
        action: "navigate",
        url: "https://example.com",
      });
      expect(mockGoto).toHaveBeenCalledWith("https://example.com", expect.objectContaining({ waitUntil: "load" }));
      expect(result).toEqual({
        action: "navigate",
        url: "https://example.com",
        title: "Test Page",
      });
    });

    it("requires URL for navigate action", async () => {
      const result = await service.execute({ action: "navigate" });
      expect(result).toEqual({ error: "URL is required for navigate action" });
    });

    it("requires selector for click action", async () => {
      const result = await service.execute({ action: "click" });
      expect(result).toEqual({ error: "Selector is required for click action" });
    });

    it("requires fields for fill action", async () => {
      const result = await service.execute({ action: "fill" });
      expect(result).toEqual({ error: "Fields array is required for fill action" });
    });

    it("takes a screenshot", async () => {
      const result = await service.execute({
        action: "screenshot",
        url: "https://example.com",
        full_page: true,
      });
      expect(mockScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          action: "screenshot",
          screenshot_path: expect.stringContaining("screenshot-"),
        }),
      );
    });

    it("extracts text from page", async () => {
      const result = await service.execute({
        action: "extract_text",
        url: "https://example.com",
      });
      expect(result).toEqual(
        expect.objectContaining({
          action: "extract_text",
          content: "Hello World",
          truncated: false,
        }),
      );
    });

    it("extracts text with selector", async () => {
      const result = await service.execute({
        action: "extract_text",
        url: "https://example.com",
        selector: "#main",
      });
      expect(mockDollar).toHaveBeenCalledWith("#main");
      expect(result).toEqual(
        expect.objectContaining({
          action: "extract_text",
          content: "Hello World",
        }),
      );
    });

    it("clicks an element", async () => {
      const result = await service.execute({
        action: "click",
        url: "https://example.com",
        selector: "button.submit",
      });
      expect(mockClick).toHaveBeenCalledWith("button.submit", expect.any(Object));
      expect(result).toEqual(
        expect.objectContaining({ action: "click" }),
      );
    });

    it("fills form fields", async () => {
      const result = await service.execute({
        action: "fill",
        url: "https://example.com",
        fields: [
          { selector: "#email", value: "test@example.com" },
          { selector: "#password", value: "secret" },
        ],
      });
      expect(mockFill).toHaveBeenCalledTimes(2);
      expect(result).toEqual(
        expect.objectContaining({
          action: "fill",
          fields_filled: 2,
        }),
      );
    });

    it("gets elements", async () => {
      mockDollarDollar.mockResolvedValue([
        {
          evaluate: vi.fn().mockResolvedValue("a"),
          textContent: vi.fn().mockResolvedValue("Click here"),
          getAttribute: vi.fn().mockImplementation((attr: string) =>
            attr === "href" ? Promise.resolve("https://example.com") : Promise.resolve(null),
          ),
        },
      ]);

      const result = await service.execute({
        action: "get_elements",
        url: "https://example.com",
        selector: "a",
      });
      expect(result).toEqual(
        expect.objectContaining({
          action: "get_elements",
          elements: expect.arrayContaining([
            expect.objectContaining({
              tag: "a",
              text: "Click here",
            }),
          ]),
        }),
      );
    });

    it("closes browser context after execution", async () => {
      await service.execute({
        action: "navigate",
        url: "https://example.com",
      });
      expect(mockContextClose).toHaveBeenCalled();
    });
  });

  describe("SSRF protection", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("blocks private IP (127.x)", async () => {
      mockLookup.mockResolvedValue({ address: "127.0.0.1" });
      const result = await service.execute({
        action: "navigate",
        url: "https://evil.com",
      });
      expect(result).toEqual({ error: "URL resolves to a private/internal IP address" });
    });

    it("blocks private IP (10.x)", async () => {
      mockLookup.mockResolvedValue({ address: "10.0.0.1" });
      const result = await service.execute({
        action: "navigate",
        url: "https://evil.com",
      });
      expect(result).toEqual({ error: "URL resolves to a private/internal IP address" });
    });

    it("blocks private IP (192.168.x)", async () => {
      mockLookup.mockResolvedValue({ address: "192.168.1.1" });
      const result = await service.execute({
        action: "navigate",
        url: "https://evil.com",
      });
      expect(result).toEqual({ error: "URL resolves to a private/internal IP address" });
    });

    it("blocks private IP (172.16.x)", async () => {
      mockLookup.mockResolvedValue({ address: "172.16.0.1" });
      const result = await service.execute({
        action: "navigate",
        url: "https://evil.com",
      });
      expect(result).toEqual({ error: "URL resolves to a private/internal IP address" });
    });

    it("blocks cloud metadata endpoint", async () => {
      const result = await service.execute({
        action: "navigate",
        url: "http://169.254.169.254/latest/meta-data/",
      });
      expect(result).toEqual({ error: "Access to cloud metadata endpoints is blocked" });
    });

    it("blocks file:// URLs", async () => {
      const result = await service.execute({
        action: "navigate",
        url: "file:///etc/passwd",
      });
      expect(result).toEqual({ error: "Only HTTP/HTTPS URLs are allowed" });
    });

    it("allows valid public URLs", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34" });
      const result = await service.execute({
        action: "navigate",
        url: "https://example.com",
      });
      expect(result).toEqual(
        expect.objectContaining({ action: "navigate" }),
      );
    });

    it("blocks unresolvable hostnames", async () => {
      mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
      const result = await service.execute({
        action: "navigate",
        url: "https://nonexistent.invalid",
      });
      expect(result).toEqual({ error: "Could not resolve hostname: nonexistent.invalid" });
    });
  });

  describe("concurrency limits", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("enforces max context limit", async () => {
      // Create a deferred promise to hold contexts open
      let resolveGoto1!: () => void;
      let resolveGoto2!: () => void;
      const gate1 = new Promise<void>((r) => { resolveGoto1 = r; });
      const gate2 = new Promise<void>((r) => { resolveGoto2 = r; });

      let callCount = 0;
      mockGoto.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return gate1;
        if (callCount === 2) return gate2;
        return Promise.resolve();
      });

      // Fire 3 concurrent requests (limit is 2)
      const p1 = service.execute({ action: "navigate", url: "https://example.com" });
      const p2 = service.execute({ action: "navigate", url: "https://example.com" });
      // Small delay to ensure p1 and p2 have incremented activeContexts
      await new Promise((r) => setTimeout(r, 10));
      const p3 = service.execute({ action: "navigate", url: "https://example.com" });

      // p3 should immediately fail due to concurrency limit
      const result3 = await p3;
      expect(result3).toEqual({ error: expect.stringContaining("concurrency limit") });

      // Release the gates so p1 and p2 complete
      resolveGoto1();
      resolveGoto2();
      await p1;
      await p2;
    });
  });

  describe("text truncation", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("truncates long text content", async () => {
      mockLocator.mockReturnValue({
        textContent: vi.fn().mockResolvedValue("A".repeat(20000)),
      });

      const result = await service.execute({
        action: "extract_text",
        url: "https://example.com",
        max_length: 100,
      });
      expect(result).toEqual(
        expect.objectContaining({
          action: "extract_text",
          truncated: true,
        }),
      );
      const r = result as { content: string };
      expect(r.content.length).toBe(100);
    });
  });
});
