import type { LlmTool } from "@ai-cofounder/llm";

export const EXECUTE_VPS_COMMAND_TOOL: LlmTool = {
  name: "execute_vps_command",
  description:
    "Run a shell command on the production VPS. Use this to manage Docker containers, " +
    "check system resources, view logs, run maintenance scripts, or diagnose issues. " +
    "The VPS runs all AI Cofounder services. Project is at /opt/ai-cofounder. " +
    "Docker compose files: docker-compose.prod.yml (main), docker-compose.monitoring.yml, " +
    "docker-compose.n8n.yml, docker-compose.uptimekuma.yml. " +
    "Dangerous commands (rm -rf /, shutdown, reboot, etc.) are blocked.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute on the VPS",
      },
      timeout_seconds: {
        type: "number",
        description: "Command timeout in seconds (default 60, max 300)",
      },
    },
    required: ["command"],
  },
};

export const DOCKER_SERVICE_LOGS_TOOL: LlmTool = {
  name: "docker_service_logs",
  description:
    "Get recent logs from a Docker compose service. " +
    "Services: agent-server, worker, discord-bot, slack-bot, redis (prod); " +
    "n8n; uptime-kuma; prometheus, grafana, alertmanager (monitoring).",
  input_schema: {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Docker compose service name (e.g. 'agent-server', 'worker', 'n8n')",
      },
      lines: {
        type: "number",
        description: "Number of log lines to fetch (default 50, max 200)",
      },
    },
    required: ["service"],
  },
};

export const DOCKER_RESTART_SERVICE_TOOL: LlmTool = {
  name: "docker_restart_service",
  description:
    "Restart a Docker compose service on the VPS. Use when a service is unhealthy " +
    "or needs to pick up configuration changes.",
  input_schema: {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Docker compose service name to restart",
      },
      compose_file: {
        type: "string",
        description: "Compose file (default: docker-compose.prod.yml). Options: docker-compose.prod.yml, docker-compose.monitoring.yml, docker-compose.n8n.yml, docker-compose.uptimekuma.yml",
      },
    },
    required: ["service"],
  },
};
