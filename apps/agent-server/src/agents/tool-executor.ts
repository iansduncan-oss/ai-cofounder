// Shared tool executor used by both Orchestrator and SubagentRunner.
//
// The implementation is split into focused submodules under ./tool-executor/
// This file is a thin facade that preserves the public API for external callers:
//
//   - buildSharedToolList  (tool-executor/tool-list-builder.ts)
//   - executeSharedTool    (tool-executor/shared-tool-executor.ts)
//   - executeWithTierCheck (tool-executor/tier-dispatch.ts)
//   - ToolExecutorServices, ToolExecutorContext (tool-executor/types.ts)
//
// Tool handlers are organized by category under tool-executor/handlers/:
//   - memory.ts        — save_memory, recall_memories, recall_episodes, recall_procedures
//   - workflows.ts     — web, n8n, schedules, sandbox, follow-ups, productivity,
//                        query_database, query_analytics, templates
//   - workspace.ts     — filesystem, git, run_tests, create_pr, review_pr, browser_action,
//                        vps/docker commands
//   - integrations.ts  — messaging, projects, gmail, calendar, knowledge base, webhooks,
//                        branching, discord

export { buildSharedToolList } from "./tool-executor/tool-list-builder.js";
export { executeSharedTool } from "./tool-executor/shared-tool-executor.js";
export { executeWithTierCheck } from "./tool-executor/tier-dispatch.js";
export type { ToolExecutorServices, ToolExecutorContext } from "./tool-executor/types.js";
