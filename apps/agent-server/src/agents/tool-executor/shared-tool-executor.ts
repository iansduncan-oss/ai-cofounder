import type { LlmToolUseContent } from "@ai-cofounder/llm";
import type { ToolExecutorServices, ToolExecutorContext } from "./types.js";
import { handlesMemoryTool, executeMemoryTool } from "./handlers/memory.js";
import { handlesWorkflowTool, executeWorkflowTool } from "./handlers/workflows.js";
import { handlesWorkspaceTool, executeWorkspaceTool } from "./handlers/workspace.js";
import { handlesIntegrationTool, executeIntegrationTool } from "./handlers/integrations.js";

/**
 * Execute a single tool call. Shared between Orchestrator and SubagentRunner.
 * Does NOT handle orchestrator-only tools (create_plan, create_milestone, request_approval,
 * delegate_to_subagent, delegate_parallel, check_subagent).
 *
 * Returns `null` for unknown tools so the caller can handle them.
 */
export async function executeSharedTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
): Promise<unknown> {
  if (handlesMemoryTool(block.name)) {
    return executeMemoryTool(block, services, context);
  }
  if (handlesWorkflowTool(block.name)) {
    return executeWorkflowTool(block, services, context);
  }
  if (handlesWorkspaceTool(block.name)) {
    return executeWorkspaceTool(block, services, context);
  }
  if (handlesIntegrationTool(block.name)) {
    return executeIntegrationTool(block, services, context);
  }
  return null; // Unknown tool — caller handles
}
