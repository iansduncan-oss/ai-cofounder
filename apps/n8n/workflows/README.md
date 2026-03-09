# n8n Workflow Automations

Import these JSON files into your n8n instance at `http://localhost:5678`.

## Workflows

### 1. GitHub Issue → Goal (`github-issue-to-goal.json`)
- **Trigger:** Webhook (POST to `/webhook/github-issue`)
- **What it does:** When a GitHub issue is opened, creates a goal via the agent-server API and notifies Discord
- **Setup:** Point a GitHub webhook (issues events) at your n8n webhook URL

### 2. Deploy Failure Alerts (`deploy-alerts.json`)
- **Trigger:** Webhook (POST to `/webhook/deploy-alert`)
- **What it does:** On deploy failure, sends a Discord alert and triggers an agent investigation session
- **Setup:** Point a GitHub webhook (workflow_run events) at your n8n webhook URL

### 3. Weekly LLM Cost Digest (`weekly-cost-digest.json`)
- **Trigger:** Schedule (every Monday at 9 AM)
- **What it does:** Fetches usage stats + provider health from agent-server, formats a cost digest, posts to Discord and Slack
- **Setup:** Just activate the workflow — it runs on a cron schedule

## Required n8n Credentials

- **Agent Server API Key** — HTTP Header Auth credential with `Authorization: Bearer <your API_SECRET>`

## Required Environment Variables (in n8n)

- `AGENT_SERVER_URL` — e.g., `http://agent-server:3100` (or `http://localhost:3100` for local dev)
- `DISCORD_WEBHOOK_URL` — Discord channel webhook URL for notifications
- `SLACK_WEBHOOK_URL` — Slack incoming webhook URL (used by cost digest)
