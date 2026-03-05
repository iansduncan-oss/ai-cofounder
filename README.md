# AI Cofounder

A multi-agent AI system that orchestrates specialist agents to collaborate on business tasks. Exposed through Discord and an HTTP API, with task-based LLM routing across multiple providers.

## Architecture

Turborepo monorepo with five workspaces:

| Workspace           | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `apps/agent-server` | Fastify server (port 3100) — multi-agent orchestration, tool loop, REST API |
| `apps/discord-bot`  | Discord bot with slash commands, calls agent-server                         |
| `apps/voice-ui`     | Static HTML/CSS/JS voice interface served at `/voice/`                      |
| `packages/db`       | Drizzle ORM + PostgreSQL — schema, repositories, migrations                 |
| `packages/llm`      | Multi-LLM provider abstraction with task-based routing and fallback chains  |
| `packages/shared`   | Shared types, pino logger, env config helpers                               |

### Agent System

The **Orchestrator** handles conversations via an agentic tool loop (up to 5 rounds). It can create plans (goals + tasks), save/recall memories, and delegate to specialists.

**Specialist agents** execute goal tasks in order:

- **Researcher** — web search and information gathering
- **Coder** — code generation with self-review
- **Reviewer** — code and output review
- **Planner** — planning and decomposition

### Multi-LLM Routing

The `LlmRegistry` routes requests by task category with automatic fallback:

| Task         | Primary          | Fallback Chain                   |
| ------------ | ---------------- | -------------------------------- |
| Planning     | Claude Opus      | Claude Sonnet → Gemini 2.5 Pro   |
| Conversation | Claude Sonnet    | Groq Llama → OpenRouter Llama    |
| Simple       | Groq Llama 8B    | OpenRouter Llama → Claude Sonnet |
| Research     | Gemini 2.5 Flash | Claude Sonnet                    |
| Code         | Claude Sonnet    | Groq Llama                       |

## Prerequisites

- **Node.js** v24+ and npm 11+
- **Docker** and Docker Compose (for PostgreSQL)
- At least one LLM API key (Anthropic recommended)

## Quick Start

```bash
git clone <repo-url> && cd ai-cofounder
cp .env.example .env          # Fill in API keys
npm install
npm run docker:up              # Start PostgreSQL
npm run db:push                # Push schema to database
npm run dev                    # Start all services in watch mode
```

Services:

- Agent Server: http://localhost:3100
- Voice UI: http://localhost:3100/voice/
- n8n: http://localhost:5678

## Commands

### Monorepo

| Command                | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `npm run build`        | Build all packages (Turbo, respects dependency graph) |
| `npm run dev`          | Dev mode with watch for all packages                  |
| `npm run lint`         | Lint all packages (ESLint + typescript-eslint)        |
| `npm run test`         | Run all tests (Vitest)                                |
| `npm run clean`        | Clean dist/ and .turbo/                               |
| `npm run format`       | Format all files (Prettier)                           |
| `npm run format:check` | Check formatting without writing                      |

### Database

| Command               | Description                   |
| --------------------- | ----------------------------- |
| `npm run db:push`     | Push schema to database (dev) |
| `npm run db:generate` | Generate Drizzle migrations   |
| `npm run db:migrate`  | Run migrations (production)   |
| `npm run db:studio`   | Open Drizzle Studio           |

### Docker

| Command               | Description                |
| --------------------- | -------------------------- |
| `npm run docker:up`   | Start PostgreSQL container |
| `npm run docker:down` | Stop containers            |
| `npm run docker:logs` | Tail container logs        |

### Single Workspace

```bash
npm run build -w @ai-cofounder/agent-server
npm run test -w @ai-cofounder/llm
```

## Discord Bot Commands

| Command                  | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `/ask <message>`         | Send a message to the AI orchestrator             |
| `/status`                | Check agent server health and uptime              |
| `/goals`                 | List goals for the current channel's conversation |
| `/tasks`                 | Show pending tasks across all goals               |
| `/memory`                | View your saved memories (ephemeral)              |
| `/clear`                 | Clear the channel's conversation context          |
| `/execute <goal_id>`     | Execute a goal's task pipeline                    |
| `/approve <approval_id>` | Approve a pending task approval                   |

## API Endpoints

All routes prefixed with the agent server URL (default `http://localhost:3100`).

### Health

| Method | Path      | Description                      |
| ------ | --------- | -------------------------------- |
| GET    | `/health` | Server health, uptime, timestamp |

### Agents

| Method | Path              | Description                     |
| ------ | ----------------- | ------------------------------- |
| POST   | `/api/agents/run` | Run orchestrator with a message |

### Goals

| Method | Path                         | Description                    |
| ------ | ---------------------------- | ------------------------------ |
| POST   | `/api/goals`                 | Create a goal                  |
| GET    | `/api/goals/:id`             | Get a goal by ID               |
| GET    | `/api/goals?conversationId=` | List goals for a conversation  |
| PATCH  | `/api/goals/:id`             | Update goal status             |
| POST   | `/api/goals/:id/execute`     | Execute a goal's task pipeline |
| GET    | `/api/goals/:id/progress`    | Get goal execution progress    |

### Tasks

| Method | Path                      | Description             |
| ------ | ------------------------- | ----------------------- |
| POST   | `/api/tasks`              | Create a task           |
| GET    | `/api/tasks/pending`      | List pending tasks      |
| GET    | `/api/tasks/:id`          | Get task by ID          |
| GET    | `/api/tasks?goalId=`      | List tasks for a goal   |
| PATCH  | `/api/tasks/:id/assign`   | Assign task to an agent |
| PATCH  | `/api/tasks/:id/start`    | Mark task as running    |
| PATCH  | `/api/tasks/:id/complete` | Mark task as completed  |
| PATCH  | `/api/tasks/:id/fail`     | Mark task as failed     |

### Approvals

| Method | Path                         | Description                |
| ------ | ---------------------------- | -------------------------- |
| POST   | `/api/approvals`             | Create an approval request |
| GET    | `/api/approvals/pending`     | List pending approvals     |
| GET    | `/api/approvals/:id`         | Get approval by ID         |
| GET    | `/api/approvals?taskId=`     | List approvals for a task  |
| PATCH  | `/api/approvals/:id/resolve` | Resolve an approval        |

### Memories

| Method | Path                    | Description              |
| ------ | ----------------------- | ------------------------ |
| GET    | `/api/memories?userId=` | List memories for a user |
| DELETE | `/api/memories/:id`     | Delete a memory          |

### Users

| Method | Path                                           | Description                 |
| ------ | ---------------------------------------------- | --------------------------- |
| GET    | `/api/users/by-platform/:platform/:externalId` | Look up user by platform ID |

### Channels

| Method | Path                                    | Description                   |
| ------ | --------------------------------------- | ----------------------------- |
| GET    | `/api/channels/:channelId/conversation` | Get channel's conversation ID |
| PUT    | `/api/channels/:channelId/conversation` | Set channel's conversation ID |

### Prompts

| Method | Path                          | Description                 |
| ------ | ----------------------------- | --------------------------- |
| GET    | `/api/prompts/:name`          | Get active prompt by name   |
| GET    | `/api/prompts/:name/versions` | List prompt versions        |
| POST   | `/api/prompts`                | Create a new prompt version |

## Environment Variables

| Variable             | Required | Default                 | Description                                     |
| -------------------- | -------- | ----------------------- | ----------------------------------------------- |
| `DATABASE_URL`       | Yes      | —                       | PostgreSQL connection string                    |
| `ANTHROPIC_API_KEY`  | Yes      | —                       | Anthropic API key for Claude models             |
| `GROQ_API_KEY`       | No       | —                       | Groq API key (free tier available)              |
| `GEMINI_API_KEY`     | No       | —                       | Google AI Studio API key                        |
| `OPENROUTER_API_KEY` | No       | —                       | OpenRouter API key                              |
| `DISCORD_TOKEN`      | For bot  | —                       | Discord bot token                               |
| `DISCORD_CLIENT_ID`  | For bot  | —                       | Discord application client ID                   |
| `DISCORD_GUILD_ID`   | No       | —                       | Guild ID for instant slash command registration |
| `AGENT_SERVER_URL`   | No       | `http://localhost:3100` | Agent server URL for Discord bot                |
| `PORT`               | No       | `3100`                  | Agent server port                               |
| `HOST`               | No       | `0.0.0.0`               | Agent server host                               |
| `LOG_LEVEL`          | No       | `info`                  | Pino log level                                  |
| `API_SECRET`         | No       | —                       | Bearer token for API auth (blank = no auth)     |
| `RATE_LIMIT_MAX`     | No       | `20`                    | Max requests per rate limit window              |
| `RATE_LIMIT_WINDOW`  | No       | `60`                    | Rate limit window in seconds                    |
| `TAVILY_API_KEY`     | No       | —                       | Tavily API key for web search tool              |
| `DAILY_TOKEN_LIMIT`  | No       | `100000`                | Daily LLM token budget                          |

## Testing

```bash
npm run test              # Run all tests
npm run test -w @ai-cofounder/llm   # Run tests for a specific workspace
```

Tests use Vitest with mocked external dependencies (no real network or database calls). Test files live in `src/__tests__/` directories within each workspace.

## CI/CD Pipeline

**CI** (`.github/workflows/ci.yml`) — runs on push to `main` and PRs:

1. Install dependencies (`npm ci`)
2. Lint (`npm run lint`)
3. Build all packages (`npm run build`)
4. Push schema to test PostgreSQL 16 service container (`npm run db:push`)
5. Run tests (`npm run test`)

**Deploy** (`.github/workflows/deploy.yml`) — triggers on CI success for `main`:

1. Connects to VPS via Tailscale mesh network
2. Pulls latest code, builds Docker images on VPS
3. Restarts services via Docker Compose (agent-server, discord-bot, n8n, monitoring, uptime-kuma)
4. Health check on `http://localhost:3100/health`
5. Discord webhook notification (success or failure with logs link)

## Production Infrastructure

Deployed on **Hetzner VPS** behind Nginx Proxy Manager with TLS termination.

| Service | URL | Notes |
| --- | --- | --- |
| Agent Server | api.aviontechs.com | Fastify, Docker |
| Discord Bot | — | Connects to agent-server internally |
| n8n | n8n.aviontechs.com | Workflow automation |
| Grafana | grafana.aviontechs.com | Prometheus + Alertmanager → Discord |
| Uptime Kuma | status.aviontechs.com | Status monitoring |

- **Database**: PostgreSQL 16 with pgvector extension for semantic memory
- **Backups**: Nightly to Hetzner Storage Box (7-day retention) via rsync
- **Security**: UFW firewall, fail2ban, Docker ports bound to 127.0.0.1
- **Networking**: Tailscale mesh for SSH access and CI/CD deployment

## License

Private — all rights reserved.
