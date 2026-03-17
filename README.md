# AI Cofounder

A multi-agent AI system that orchestrates specialist agents to collaborate on business tasks. Exposed through Discord, Slack, a React dashboard, a voice UI, and an HTTP API. Features task-based LLM routing across multiple providers, BullMQ job queues, RAG retrieval, and a proactive monitoring stack.

## Architecture

Turborepo monorepo with 14 workspaces:

| Workspace | Description |
| --- | --- |
| `apps/agent-server` | Fastify server (port 3100) — multi-agent orchestration, tool loop, REST API, WebSocket |
| `apps/discord-bot` | Discord bot with 8 slash commands, uses `@ai-cofounder/api-client` + `@ai-cofounder/bot-handlers` |
| `apps/slack-bot` | Slack bot (Bolt + Socket Mode) with 8 slash commands, uses `@ai-cofounder/api-client` + `@ai-cofounder/bot-handlers` |
| `apps/dashboard` | React + Vite + TanStack Query + React Router + Tailwind v4 — real-time HUD, chat, goal management |
| `apps/voice-ui` | Static HTML/CSS/JS voice interface served at `/voice/` with SSE streaming + ElevenLabs TTS |
| `packages/db` | Drizzle ORM + PostgreSQL + pgvector — schema, repositories, auto-migrations |
| `packages/llm` | Multi-LLM provider abstraction with task-based routing, fallback chains, and cost tracking |
| `packages/queue` | BullMQ + Redis — 11 job queues, recurring scheduler, dead letter queue, priority support |
| `packages/rag` | RAG pipeline — chunker, ingester, retriever with pgvector HNSW search |
| `packages/sandbox` | Docker-based isolated code execution (TypeScript, JavaScript, Python, Bash) |
| `packages/api-client` | Typed fetch-based API client for all agent-server endpoints |
| `packages/bot-handlers` | Platform-agnostic command handlers shared by Discord + Slack bots |
| `packages/shared` | Shared types, pino logger (`createLogger`), env config helpers (`requireEnv`, `optionalEnv`) |
| `packages/test-utils` | Shared test fixtures (`mockSharedModule`, `mockLlmModule`, `mockDbModule`) |
| `packages/mcp-server` | MCP server wrapping ApiClient (12 tools for Claude Code integration) |

### Agent System

The **Orchestrator** handles conversations via an agentic tool loop (up to 5 rounds). It can create plans (goals + tasks), save/recall memories, and delegate to specialists.

**Specialist agents** execute goal tasks (supports DAG-based parallel execution):

- **Researcher** — web search and information gathering
- **Coder** — code generation with self-review
- **Reviewer** — code and output review
- **Planner** — planning and decomposition
- **Debugger** — reads logs/errors, traces issues, proposes fixes
- **DocWriter** — documentation generation
- **Verifier** — goal verification and acceptance testing

### Semantic Memory

The orchestrator can save and recall user memories with vector search. Memories are stored in PostgreSQL with pgvector embeddings (768-dimensional, via Google's `text-embedding-004` model). Recall uses cosine similarity with an ILIKE fallback when no embeddings are available.

### Proactive Scheduler

A background scheduler sends Discord messages without user prompting:

- **Morning briefings** — LLM-generated daily summaries of active goals and tasks
- **Stale goal check-ins** — nudges after 24h of inactivity, cold-start notifications at 48h
- **Approval reminders** — notifications for pending approvals

Requires `DISCORD_FOLLOWUP_WEBHOOK_URL` to be set.

### Orchestrator Tools

The orchestrator's tool loop gives it access to 30+ tools, controlled by a three-tier autonomy system (green/yellow/red):

| Tool | Tier | Description |
| --- | --- | --- |
| `create_plan` | Green | Decompose a request into a goal with ordered tasks (DAG support) |
| `create_milestone` | Green | Create a milestone to group related goals |
| `request_approval` | Green | Request human approval for sensitive actions |
| `save_memory` | Green | Store user memories (with vector embeddings) |
| `recall_memories` | Green | Retrieve memories via vector search or text match |
| `search_web` | Green | Web search via Tavily API |
| `browse_web` | Green | Fetch and parse a web page |
| `trigger_workflow` | Yellow | Trigger an n8n outbound workflow |
| `list_workflows` | Green | List available n8n workflows |
| `execute_code` | Yellow | Run code in Docker sandbox (TS, JS, Python, Bash) |
| `read_file` | Green | Read file from workspace |
| `write_file` | Yellow | Write file to workspace |
| `delete_file` | Red | Delete a workspace file |
| `list_directory` | Green | List directory contents |
| `git_status/diff/log` | Green | Git read operations |
| `git_add/commit` | Yellow | Stage and commit changes |
| `git_push` | Yellow | Push to remote |
| `git_branch/checkout` | Yellow | Branch management |
| `git_clone/pull` | Yellow | Clone or pull repositories |
| `run_tests` | Green | Execute test suite |
| `create_pr` | Yellow | Create a GitHub pull request |
| `send_message` | Green | Send agent-to-agent message |
| `check_messages` | Green | Check agent inbox |
| `broadcast_update` | Green | Broadcast to all agents |
| `create/list/delete_schedule` | Green | Manage recurring schedules |
| `submit_verification` | Green | Submit goal verification result |
| `database_query` | Green | Read-only SQL inspection |

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

## Slack Bot Commands

The Slack bot uses Socket Mode (no public URL required) with the same 8 commands as Discord:

| Command | Description |
| --- | --- |
| `/ask <message>` | Send a message to the AI orchestrator |
| `/status` | Check agent server health and uptime |
| `/goals` | List goals for the current channel's conversation |
| `/tasks` | Show pending tasks across all goals |
| `/memory` | View your saved memories (ephemeral) |
| `/clear` | Clear the channel's conversation context |
| `/execute <goal_id>` | Execute a goal's task pipeline |
| `/approve <approval_id>` | Approve a pending task approval |

Requires `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN` (Socket Mode).

## API Endpoints

All routes prefixed with the agent server URL (default `http://localhost:3100`). Protected routes require JWT or API_SECRET bearer token.

### Health & Observability

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Basic health check (DB, Redis) |
| GET | `/health/full` | Aggregated health across all subsystems |
| GET | `/health/providers` | LLM provider health status |
| GET | `/health/providers/history` | Persisted provider health history |
| GET | `/health/deep` | Timed per-subsystem health (deploy verification) |
| GET | `/metrics` | Prometheus metrics endpoint |
| GET | `/api/tools/stats` | Per-tool execution timing stats |
| GET | `/api/briefing` | Generate daily briefing (`?send=true` to deliver) |
| GET | `/api/briefing/audio` | Synthesize briefing as MP3 via TTS |
| GET | `/api/errors/summary` | Error analytics aggregated by type |

### WebSocket

| Path | Description |
| --- | --- |
| `/ws?token=JWT` | Real-time push (9 channels: tasks, approvals, monitoring, queue, health, tools, pipelines, briefing, goals) |

### Agents & Execution

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/agents/run` | Run orchestrator (single response) |
| POST | `/api/agents/run/stream` | Run orchestrator (SSE stream) |
| GET | `/api/agents/roles` | List specialist agent roles |
| GET | `/api/agents/capabilities` | List agent capabilities |

### Goals

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/goals` | Create a goal |
| GET | `/api/goals/:id` | Get a goal by ID |
| GET | `/api/goals?conversationId=` | List goals for a conversation |
| PATCH | `/api/goals/:id` | Update goal status |
| POST | `/api/goals/:id/execute` | Execute a goal's task pipeline |
| POST | `/api/goals/:id/execute/stream` | Execute with SSE streaming |
| GET | `/api/goals/:id/progress` | Get goal execution progress |
| POST | `/api/goals/:id/clone` | Clone a goal with its tasks |

### Tasks & Approvals

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/pending` | List pending tasks |
| GET | `/api/tasks/:id` | Get task by ID |
| GET | `/api/tasks?goalId=` | List tasks for a goal |
| PATCH | `/api/tasks/:id/assign` | Assign task to an agent |
| PATCH | `/api/tasks/:id/complete` | Mark task as completed |
| POST | `/api/approvals` | Create an approval request |
| GET | `/api/approvals/pending` | List pending approvals |
| PATCH | `/api/approvals/:id/resolve` | Resolve an approval |

### Memories & Conversations

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/memories?userId=` | List memories for a user |
| DELETE | `/api/memories/:id` | Delete a memory |
| GET | `/api/conversations?userId=` | List conversations |
| GET | `/api/conversations/:id/messages` | Get conversation messages |
| DELETE | `/api/conversations/:id` | Delete a conversation |

### Queue & Autonomous

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/queue/status` | Queue status across all queues |
| POST | `/api/queue/agent-task` | Enqueue an agent task |
| GET | `/api/autonomous/sessions` | List autonomous sessions |
| POST | `/api/autonomous/start` | Start an autonomous session |

### Monitoring & Deploys

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/monitoring/status` | Full monitoring report (GitHub CI, VPS, alerts) |
| GET | `/api/monitoring/github/ci` | GitHub CI status |
| GET | `/api/monitoring/vps` | VPS health metrics |
| POST | `/api/deploys/webhook` | Deploy event webhook (from CI) |
| GET | `/api/deploys` | List deployments |
| GET | `/api/deploys/latest` | Latest deployment |
| GET | `/api/deploys/circuit-breaker` | Circuit breaker status |

### Agent Messages

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/agent-messages` | List agent messages |
| GET | `/api/agent-messages/stats` | Message statistics |
| GET | `/api/agent-messages/:id` | Get single message |
| GET | `/api/agent-messages/:id/thread` | Get message thread |

### Settings, Auth & Misc

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/settings` | Get app settings |
| PATCH | `/api/settings` | Update settings |
| POST | `/api/auth/login` | Dashboard login |
| GET | `/api/auth/google` | Google OAuth redirect |
| GET | `/api/persona` | Get active persona |
| PUT | `/api/persona` | Upsert persona |
| GET | `/api/autonomy/tiers` | List tool tier configs |
| PUT | `/api/autonomy/tiers/:tool` | Update tool tier |
| GET | `/api/journal` | List journal entries |
| GET | `/api/projects` | List registered projects |

## Environment Variables

### Core

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude models |
| `GROQ_API_KEY` | No | — | Groq API key (free tier available) |
| `GEMINI_API_KEY` | No | — | Google AI Studio API key |
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key |
| `PORT` | No | `3100` | Agent server port |
| `HOST` | No | `0.0.0.0` | Agent server host |
| `LOG_LEVEL` | No | `info` | Pino log level |

### Queue & Redis

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection for BullMQ queues |

### Discord Bot

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | For bot | — | Discord bot token |
| `DISCORD_CLIENT_ID` | For bot | — | Discord application client ID |
| `DISCORD_GUILD_ID` | No | — | Guild ID for instant slash command registration |
| `DISCORD_FOLLOWUP_WEBHOOK_URL` | No | — | Webhook for proactive scheduler messages |

### Slack Bot

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | For bot | — | Slack bot user OAuth token |
| `SLACK_SIGNING_SECRET` | For bot | — | Slack app signing secret |
| `SLACK_APP_TOKEN` | For bot | — | Slack app-level token (Socket Mode) |

### Security & Rate Limiting

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_SECRET` | No | — | Bearer token for API auth (blank = no auth) |
| `JWT_SECRET` | No | — | JWT signing secret for dashboard auth |
| `RATE_LIMIT_MAX` | No | `60` | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | No | `60` | Rate limit window in seconds |
| `RATE_LIMIT_EXPENSIVE_MAX` | No | `10` | Tighter limit for LLM endpoints |

### Google OAuth

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | — | OAuth callback URL |

### Monitoring

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | No | — | GitHub API token for CI/PR monitoring |
| `GITHUB_MONITORED_REPOS` | No | — | Comma-separated repos (e.g. `owner/repo`) |
| `VPS_HOST` | No | — | VPS hostname for health monitoring |
| `VPS_USER` | No | — | VPS SSH user |

### Voice & TTS

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ELEVENLABS_API_KEY` | No | — | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | No | — | Default voice ID |
| `ELEVENLABS_MODEL_ID` | No | — | TTS model ID |

### Misc

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AGENT_SERVER_URL` | No | `http://localhost:3100` | Agent server URL for bot clients |
| `TAVILY_API_KEY` | No | — | Tavily API key for web search tool |
| `DAILY_TOKEN_LIMIT` | No | `100000` | Daily LLM token budget |
| `BRIEFING_HOUR` | No | `9` | Hour (0-23) to send daily briefings |
| `BRIEFING_TIMEZONE` | No | `UTC` | IANA timezone for briefing schedule |
| `WORKSPACE_DIR` | No | `/tmp/ai-cofounder-workspace` | Root directory for workspace tools |
| `DEPLOY_WEBHOOK_SECRET` | No | — | Secret for deploy webhook auth |

## Testing

```bash
npm run test              # Run all tests
npm run test -w @ai-cofounder/llm   # Run tests for a specific workspace
```

Tests use Vitest with mocked external dependencies (no real network or database calls). Test files live in `src/__tests__/` directories within each workspace.

## WebSocket Protocol

The dashboard connects via `ws://<host>/ws?token=<JWT>` for real-time updates.

**Channels:** `tasks`, `approvals`, `monitoring`, `queue`, `health`, `tools`, `pipelines`, `briefing`, `goals`

**Message format:**
```json
{ "type": "invalidate", "channel": "tasks" }
```

The dashboard's `useRealtimeSync` hook maps channels to TanStack Query keys and calls `queryClient.invalidateQueries()` — triggering a refetch of stale data. Goal execution events use `subscribe_goal` / `unsubscribe_goal` messages.

SSE endpoints are preserved for backward compatibility (voice UI, bots).

## CI/CD Pipeline

**CI** (`.github/workflows/ci.yml`) — runs on push to `main` and PRs:

1. Install dependencies (`npm ci`)
2. Lint (`npm run lint`)
3. Build all packages (`npm run build`)
4. Push schema to test PostgreSQL 16 service container (`npm run db:push`)
5. Run tests (`npm run test`)

**Deploy** (`.github/workflows/deploy.yml`) — triggers on CI success for `main`:

1. Connects to VPS via Tailscale mesh network
2. Saves previous image SHA for rollback
3. Pulls latest code, builds Docker images on VPS (tagged with git SHA)
4. Restarts services via Docker Compose (agent-server, discord-bot, slack-bot, n8n, monitoring, uptime-kuma)
5. Health check via `/health/deep` (6 attempts x 5s)
6. **Auto-rollback** to previous image if health check fails
7. Deploy webhook notification to agent-server
8. Discord webhook notification (success/failure with logs link)
9. Prunes Docker images older than 72h

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

## Backup & Restore

**What's backed up:** PostgreSQL database (pg_dump), .env files, Docker Compose configs.

**Schedule:** Nightly rsync to Hetzner Storage Box. 7-day local retention.

**Restore steps:**
1. SSH to VPS: `ssh vps`
2. Stop services: `sudo docker compose -f docker-compose.prod.yml down`
3. Restore DB: `pg_restore -d ai_cofounder /backups/latest/db.dump`
4. Restart: `sudo docker compose -f docker-compose.prod.yml up -d`

## Deployment Troubleshooting

**Tailscale ACL issues:** Ensure the CI runner's Tailscale auth key has the `tag:ci` tag with ACL access to the VPS node.

**Health check failures:** Check `GET /health/deep` — it tests DB, Redis, and LLM connectivity. Common causes: DB migration not applied, Redis not started, no LLM API keys configured.

**Rollback:** The deploy script auto-rolls back if health check fails after 6 attempts. To manually rollback:
```bash
ssh vps
sudo docker tag ai-cofounder-agent-server:<previous-sha> ai-cofounder-agent-server:latest
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate
```

## License

Private — all rights reserved.
