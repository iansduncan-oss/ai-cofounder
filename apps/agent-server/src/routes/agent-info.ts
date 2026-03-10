import type { FastifyPluginAsync } from "fastify";

/** Static agent role definitions with descriptions, tools, and specialties */
const AGENT_ROLES = [
  {
    role: "orchestrator",
    description: "Main coordinator that breaks down complex requests, delegates to specialists, and synthesizes results",
    tools: [
      "create_plan", "create_milestone", "request_approval", "save_memory", "recall_memories",
      "search_web", "browse_web", "trigger_workflow", "list_workflows", "execute_code",
      "create_schedule", "list_schedules", "delete_schedule",
      "read_file", "write_file", "delete_file", "delete_directory", "list_directory",
      "git_clone", "git_status", "git_diff", "git_add", "git_commit", "git_log",
      "git_pull", "git_branch", "git_checkout", "git_push",
      "run_tests", "create_pr", "send_message", "check_messages", "broadcast_update",
      "submit_verification",
    ],
    specialties: ["task decomposition", "multi-agent coordination", "tool orchestration"],
  },
  {
    role: "planner",
    description: "Designs step-by-step plans and task breakdowns for achieving goals",
    tools: ["search_web", "recall_memories", "read_file", "list_directory"],
    specialties: ["task planning", "goal decomposition", "dependency analysis"],
  },
  {
    role: "coder",
    description: "Generates, modifies, and reviews code with built-in self-review capabilities",
    tools: ["execute_code", "read_file", "write_file", "list_directory", "search_web"],
    specialties: ["code generation", "code modification", "self-review", "refactoring"],
  },
  {
    role: "reviewer",
    description: "Reviews code and deliverables for quality, correctness, and best practices",
    tools: ["read_file", "list_directory", "search_web"],
    specialties: ["code review", "quality assurance", "best practices enforcement"],
  },
  {
    role: "debugger",
    description: "Reads logs and errors, traces issues through the system, and proposes fixes",
    tools: ["read_file", "list_directory", "execute_code", "search_web"],
    specialties: ["error diagnosis", "log analysis", "root cause analysis", "fix proposals"],
  },
  {
    role: "researcher",
    description: "Performs web searches and memory recall to gather information and context",
    tools: ["search_web", "browse_web", "recall_memories"],
    specialties: ["web research", "information synthesis", "context gathering"],
  },
  {
    role: "doc_writer",
    description: "Creates and updates documentation, READMEs, and technical specifications",
    tools: ["read_file", "write_file", "list_directory", "search_web"],
    specialties: ["documentation", "technical writing", "API docs"],
  },
  {
    role: "verifier",
    description: "Validates that completed work meets acceptance criteria and quality standards",
    tools: ["read_file", "list_directory", "execute_code", "run_tests"],
    specialties: ["acceptance testing", "quality validation", "criteria verification"],
  },
] as const;

export const agentInfoRoutes: FastifyPluginAsync = async (app) => {
  /* GET /roles — list available agent roles with descriptions */
  app.get("/roles", { schema: { tags: ["agents"] } }, async () => {
    return {
      roles: AGENT_ROLES.map(({ role, description }) => ({ role, description })),
    };
  });

  /* GET /capabilities — full capability matrix per agent role */
  app.get("/capabilities", { schema: { tags: ["agents"] } }, async () => {
    return { agents: AGENT_ROLES };
  });
};
