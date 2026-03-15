import type { LlmTool } from "@ai-cofounder/llm";

export const QUERY_VPS_TOOL: LlmTool = {
  name: "query_vps",
  description:
    "Query the VPS infrastructure for health and resource usage. " +
    "Returns disk usage, memory usage, CPU load averages, uptime, " +
    "and per-container CPU/memory stats (when include_stats is true). " +
    "Use this to diagnose performance issues or check server health.",
  input_schema: {
    type: "object",
    properties: {
      include_stats: {
        type: "boolean",
        description: "Include per-container CPU and memory statistics (default: true)",
      },
    },
    required: [],
  },
};
