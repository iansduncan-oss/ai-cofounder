import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { lookup } from "node:dns/promises";
import path from "node:path";
import fs from "node:fs/promises";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { isPrivateIp } from "../agents/tools/browse-web.js";

const logger = createLogger("browser-service");

const NAVIGATION_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;
const DEFAULT_MAX_CONTEXTS = 3;

export interface BrowserActionInput {
  action: "navigate" | "screenshot" | "extract_text" | "click" | "fill" | "get_elements";
  url?: string;
  selector?: string;
  fields?: Array<{ selector: string; value: string }>;
  full_page?: boolean;
  max_length?: number;
  max_results?: number;
  wait_until?: "load" | "domcontentloaded" | "networkidle";
}

export interface BrowserActionResult {
  action: string;
  url?: string;
  title?: string;
  content?: string;
  screenshot_path?: string;
  elements?: Array<{ tag: string; text: string; attributes: Record<string, string> }>;
  fields_filled?: number;
  truncated?: boolean;
}

/**
 * Validates a URL for SSRF protection: must be HTTPS, must not resolve to private IP.
 */
async function validateUrl(url: string): Promise<{ valid: true; parsed: URL } | { valid: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, error: "Only HTTP/HTTPS URLs are allowed" };
  }

  // Block cloud metadata endpoints
  const blockedHosts = ["metadata.google.internal", "169.254.169.254"];
  if (blockedHosts.includes(parsed.hostname)) {
    return { valid: false, error: "Access to cloud metadata endpoints is blocked" };
  }

  // Resolve hostname and check for private IPs
  try {
    const { address } = await lookup(parsed.hostname);
    if (isPrivateIp(address)) {
      logger.warn({ url, resolvedIp: address }, "SSRF: blocked private IP in browser navigate");
      return { valid: false, error: "URL resolves to a private/internal IP address" };
    }
  } catch {
    return { valid: false, error: `Could not resolve hostname: ${parsed.hostname}` };
  }

  return { valid: true, parsed };
}

export class BrowserService {
  private browser: Browser | null = null;
  private activeContexts = 0;
  private maxContexts: number;
  private screenshotDir: string;
  available = false;

  constructor(options?: { maxContexts?: number; screenshotDir?: string }) {
    this.maxContexts = options?.maxContexts ?? DEFAULT_MAX_CONTEXTS;
    this.screenshotDir = options?.screenshotDir
      ?? path.join(optionalEnv("WORKSPACE_DIR", "/tmp/ai-cofounder-workspace"), "_screenshots");
  }

  async init(): Promise<void> {
    try {
      const executablePath = optionalEnv("BROWSER_EXECUTABLE_PATH", "");
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        ...(executablePath ? { executablePath } : {}),
      });
      this.available = true;
      logger.info("browser service initialized (Chromium launched)");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "browser service unavailable — Chromium not found or failed to launch");
      this.available = false;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.available = false;
      logger.info("browser service closed");
    }
  }

  async execute(input: BrowserActionInput): Promise<BrowserActionResult | { error: string }> {
    if (!this.available || !this.browser) {
      return { error: "Browser service is not available. Chromium may not be installed." };
    }

    if (this.activeContexts >= this.maxContexts) {
      return { error: `Browser concurrency limit reached (${this.maxContexts} active contexts). Try again later.` };
    }

    // Validate URL if provided
    if (input.url) {
      const validation = await validateUrl(input.url);
      if (!validation.valid) {
        return { error: validation.error };
      }
    }

    // Navigate action requires a URL
    if (input.action === "navigate" && !input.url) {
      return { error: "URL is required for navigate action" };
    }

    // Click requires selector
    if (input.action === "click" && !input.selector) {
      return { error: "Selector is required for click action" };
    }

    // Fill requires fields
    if (input.action === "fill" && (!input.fields || input.fields.length === 0)) {
      return { error: "Fields array is required for fill action" };
    }

    let context: BrowserContext | null = null;
    this.activeContexts++;

    try {
      context = await this.browser.newContext({
        userAgent: "AI-Cofounder-Bot/1.0 (Playwright)",
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: false,
      });

      // SSRF protection: intercept all subrequests and block private IPs
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        try {
          const parsed = new URL(requestUrl);
          const { address } = await lookup(parsed.hostname);
          if (isPrivateIp(address)) {
            logger.warn({ url: requestUrl, resolvedIp: address }, "SSRF: blocked subrequest to private IP");
            await route.abort("blockedbyclient");
            return;
          }
        } catch {
          // DNS resolution failed for subrequest — allow it (may be a data: URL etc)
        }
        await route.continue();
      });

      const page = await context.newPage();
      page.setDefaultTimeout(ACTION_TIMEOUT);

      // If we have a URL, navigate first (for all actions except when no URL is given)
      if (input.url) {
        await page.goto(input.url, {
          timeout: NAVIGATION_TIMEOUT,
          waitUntil: input.wait_until ?? "load",
        });
      }

      return await this.executeAction(page, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, action: input.action, url: input.url }, "browser action failed");
      return { error: `Browser action failed: ${message}` };
    } finally {
      this.activeContexts--;
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }

  private async executeAction(page: Page, input: BrowserActionInput): Promise<BrowserActionResult> {
    switch (input.action) {
      case "navigate": {
        const title = await page.title();
        const url = page.url();
        return { action: "navigate", url, title };
      }

      case "screenshot": {
        await fs.mkdir(this.screenshotDir, { recursive: true });
        const filename = `screenshot-${Date.now()}.png`;
        const screenshotPath = path.join(this.screenshotDir, filename);
        await page.screenshot({
          path: screenshotPath,
          fullPage: input.full_page ?? true,
        });
        const title = await page.title();
        return {
          action: "screenshot",
          url: page.url(),
          title,
          screenshot_path: screenshotPath,
        };
      }

      case "extract_text": {
        const maxLength = input.max_length ?? 10_000;
        let text: string;
        if (input.selector) {
          const el = await page.$(input.selector);
          if (!el) {
            return { action: "extract_text", content: "", truncated: false };
          }
          text = (await el.textContent()) ?? "";
        } else {
          text = (await page.locator("body").textContent()) ?? "";
        }
        // Normalize whitespace
        text = text.replace(/\s+/g, " ").trim();
        const truncated = text.length > maxLength;
        if (truncated) {
          text = text.slice(0, maxLength);
        }
        return {
          action: "extract_text",
          url: page.url(),
          title: await page.title(),
          content: text,
          truncated,
        };
      }

      case "click": {
        await page.click(input.selector!, { timeout: ACTION_TIMEOUT });
        // Wait briefly for any navigation or DOM updates
        await page.waitForTimeout(500);
        return {
          action: "click",
          url: page.url(),
          title: await page.title(),
        };
      }

      case "fill": {
        let filled = 0;
        for (const field of input.fields!) {
          await page.fill(field.selector, field.value, { timeout: ACTION_TIMEOUT });
          filled++;
        }
        return {
          action: "fill",
          url: page.url(),
          title: await page.title(),
          fields_filled: filled,
        };
      }

      case "get_elements": {
        const maxResults = input.max_results ?? 20;
        const selector = input.selector ?? "*";
        const elements = await page.$$(selector);
        const results: BrowserActionResult["elements"] = [];

        for (const el of elements.slice(0, maxResults)) {
          const tag = await el.evaluate((node) => node.tagName.toLowerCase());
          const text = ((await el.textContent()) ?? "").trim().slice(0, 200);
          const attributes: Record<string, string> = {};

          for (const attr of ["id", "class", "href", "src", "type", "name", "value", "placeholder", "aria-label", "role"]) {
            const val = await el.getAttribute(attr);
            if (val) attributes[attr] = val.slice(0, 200);
          }

          results.push({ tag, text, attributes });
        }

        return {
          action: "get_elements",
          url: page.url(),
          elements: results,
        };
      }

      default:
        return { action: input.action } as BrowserActionResult;
    }
  }
}

export function createBrowserService(options?: { maxContexts?: number; screenshotDir?: string }): BrowserService {
  return new BrowserService(options);
}
