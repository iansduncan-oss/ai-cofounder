import type { LlmTool } from "@ai-cofounder/llm";

export const QUERY_ANALYTICS_TOOL: LlmTool = {
  name: "query_analytics",
  description:
    "Query analytics and performance data — costs, tool performance, provider health, usage trends, error rates. " +
    "Use when the user asks 'how much have we spent', 'which tools are slowest', 'performance stats', " +
    "'error rate', 'usage this week'.",
  input_schema: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: ["cost_summary", "tool_performance", "provider_health", "usage_trend", "error_rate"],
        description:
          "Which metric to query: " +
          "cost_summary (spending breakdown), " +
          "tool_performance (tool execution stats), " +
          "provider_health (LLM provider status), " +
          "usage_trend (token/request trends), " +
          "error_rate (failure rates)",
      },
      time_range: {
        type: "string",
        enum: ["today", "week", "month"],
        description: "Time range for the query (default: week)",
      },
    },
    required: ["metric"],
  },
};
