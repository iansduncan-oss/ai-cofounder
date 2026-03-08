#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "@ai-cofounder/api-client";
import { registerTools } from "./tools.js";

const baseUrl = process.env.AGENT_SERVER_URL ?? "http://localhost:3100";
const apiSecret = process.env.API_SECRET;

const client = new ApiClient({ baseUrl, apiSecret });

const server = new McpServer({
  name: "ai-cofounder",
  version: "0.1.0",
});

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
