import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import type { LlmTool } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("browse-web");

export function isPrivateIp(ip: string): boolean {
  // Block loopback, link-local, private ranges, and metadata endpoints
  return (
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.20.") ||
    ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") ||
    ip.startsWith("172.23.") ||
    ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") ||
    ip.startsWith("172.26.") ||
    ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") ||
    ip.startsWith("172.29.") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("169.254.") ||
    ip === "0.0.0.0" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

export const BROWSE_WEB_TOOL: LlmTool = {
  name: "browse_web",
  description:
    "Fetch and read the content of a specific URL. Use when you need the full text of a web page, " +
    "documentation, article, or any publicly accessible URL. Complements search_web which only returns summaries.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch (must be a valid HTTP/HTTPS URL)",
      },
      max_length: {
        type: "number",
        description: "Maximum character length of returned content (default: 10000)",
      },
    },
    required: ["url"],
  },
};

interface BrowseResult {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

export async function executeBrowseWeb(
  url: string,
  maxLength = 10_000,
): Promise<BrowseResult | { error: string }> {
  try {
    // SSRF protection: enforce HTTPS and block private/internal IPs
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { error: "Invalid URL" };
    }
    if (parsedUrl.protocol !== "https:") {
      return { error: "Only HTTPS URLs are allowed" };
    }
    // Resolve hostname and check for private IPs (prevents DNS rebinding)
    let resolvedIp: string;
    try {
      const { address } = await lookup(parsedUrl.hostname);
      resolvedIp = address;
      if (isPrivateIp(address)) {
        logger.warn({ url, resolvedIp: address }, "SSRF: blocked private IP");
        return { error: "URL resolves to a private/internal IP address" };
      }
    } catch {
      return { error: `Could not resolve hostname: ${parsedUrl.hostname}` };
    }

    // Build a URL using the resolved IP to prevent DNS rebinding (TOCTOU)
    // Keep the original Host header so the server responds correctly
    const resolvedUrl = new URL(url);
    resolvedUrl.hostname = resolvedIp;

    const response = await fetch(resolvedUrl.toString(), {
      headers: {
        "User-Agent": "AI-Cofounder-Bot/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain",
        Host: parsedUrl.host,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    // Handle redirects safely — don't follow to internal URLs
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      return { error: `Redirect to ${location ?? "unknown"} — not followed for security` };
    }

    if (!response.ok) {
      logger.error({ status: response.status, url }, "browse fetch failed");
      return { error: `Failed to fetch URL: ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $("script, style, noscript, nav, footer, header, iframe, svg").remove();

    const title = $("title").text().trim() || "";
    let content = $("body").text();

    // Normalize whitespace: collapse runs of whitespace into single spaces, trim lines
    content = content.replace(/\s+/g, " ").trim();

    const truncated = content.length > maxLength;
    if (truncated) {
      content = content.slice(0, maxLength);
    }

    return { url, title, content, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, url }, "browse web failed");
    return { error: `Browse failed: ${message}` };
  }
}
