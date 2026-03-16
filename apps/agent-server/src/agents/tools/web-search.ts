import type { LlmTool } from "@ai-cofounder/llm";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("web-search");

export const SEARCH_WEB_TOOL: LlmTool = {
  name: "search_web",
  description:
    "Search the internet for current information. Use when you need up-to-date data " +
    "(pricing, documentation, news, competitors), when your knowledge might be outdated, " +
    "or when the user asks about something you're not sure about.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query (be specific for better results)",
      },
      max_results: {
        type: "number",
        description: "Number of results to return (default: 5, max: 10)",
      },
    },
    required: ["query"],
  },
};

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
}

export async function executeWebSearch(
  query: string,
  maxResults = 5,
): Promise<{ results: TavilyResult[]; answer?: string } | { error: string }> {
  const apiKey = optionalEnv("TAVILY_API_KEY", "");
  if (!apiKey) {
    return { error: "Web search not configured (TAVILY_API_KEY not set)" };
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(maxResults, 10),
        include_answer: true,
        search_depth: "advanced",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, "Tavily API error");
      return { error: `Search failed: ${response.status}` };
    }

    const data = (await response.json()) as TavilyResponse;
    return {
      results: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
      answer: data.answer,
    };
  } catch (err) {
    logger.error({ err }, "web search failed");
    return { error: "Web search request failed" };
  }
}
