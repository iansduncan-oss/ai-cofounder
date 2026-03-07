import * as cheerio from "cheerio";
import type { LlmTool } from "@ai-cofounder/llm";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("browse-web");

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
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AI-Cofounder-Bot/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: AbortSignal.timeout(15_000),
    });

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
