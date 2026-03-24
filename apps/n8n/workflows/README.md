# n8n Workflow Automations

Import these JSON files into your n8n instance at `http://localhost:5678`.

## Workflows

### 1. Enhanced GitHub Issue Pipeline (`github-issue-to-goal.json`)
- **Trigger:** Webhook (POST to `/webhook/github-issue`)
- **What it does:** Classifies incoming GitHub issues as bug, feature, or question using label overrides + keyword heuristics. Then per type:
  - **Bug:** Checks for duplicates via GitHub search API, labels `bug`, creates high-priority agent goal
  - **Feature:** Labels `enhancement`, creates medium-priority agent goal
  - **Question:** Labels `question`, auto-replies with docs pointer
- **All paths:** Notify Discord with a color-coded classification embed
- **Setup:** Point a GitHub webhook (issues events) at your n8n webhook URL

### 2. Deploy Failure Alerts (`deploy-alerts.json`)
- **Trigger:** Webhook (POST to `/webhook/deploy-alert`)
- **What it does:** On deploy failure, sends a Discord alert and triggers an agent investigation session
- **Setup:** Point a GitHub webhook (workflow_run events) at your n8n webhook URL

### 3. Smart Error Triage (`smart-error-triage.json`)
- **Trigger:** Alertmanager webhook (POST to `/webhook/alertmanager-triage`)
- **What it does:** Receives Prometheus alerts, deduplicates via n8n staticData (30-minute suppression window per fingerprint), enriches from `/api/errors/summary`, classifies severity, and sends color-coded Discord embeds
- **Key behaviors:**
  - Resolved alerts always pass through (no suppression)
  - Firing alerts suppressed if seen within 30 minutes
  - Colors: critical=red, warning=yellow, info=blue, resolved=green
- **Infra:** Alertmanager receiver points to `http://n8n:5678/webhook/alertmanager-triage` (both on `avion_avion_net` Docker network)
- **Replaces:** Direct Alertmanager → Discord webhook

### 4. Weekly Digest (`weekly-digest.json`)
- **Trigger:** Schedule (every Monday at 9 AM)
- **What it does:** Comprehensive weekly report combining:
  - Commits grouped by conventional prefix (feat, fix, refactor, etc.)
  - Deploy success rate from GitHub Actions
  - Error summary (7 days)
  - LLM cost breakdown by model
  - GitHub compare link for the week
- **Posts to:** Discord (rich embed) + Slack (text summary)
- **Replaces:** `weekly-cost-digest.json` (strict superset — old workflow marked inactive)

### 5. System Health Rollup (`system-health-rollup.json`)
- **Trigger:** Schedule (daily at 7:30 AM)
- **What it does:** Single-embed daily health report with 6 sections:
  - System Health (DB, Redis, LLM providers, queue)
  - VPS Resources (CPU, memory, disk, uptime)
  - SSL Certificates (5 domains, days until expiry)
  - Backups (last run, status, size)
  - Errors (24h summary with top errors)
  - Active Alerts & Open PRs
- **Color logic:** Green (all ok), Yellow (any warning), Red (any critical)
- **Replaces:** `daily-status.sh` (7 AM) and `check-ssl.sh` (8 AM) cron scripts

### 6. Weekly LLM Cost Digest (`weekly-cost-digest.json`) — DEPRECATED
- **Status:** Inactive — superseded by Weekly Digest
- **Kept for reference only**

## Required n8n Credentials

- **Agent Server API Key** — HTTP Header Auth credential with `Authorization: Bearer <your API_SECRET>`
- **GitHub Token** — HTTP Header Auth credential with `Authorization: Bearer <your GITHUB_TOKEN>` (used by issue pipeline and weekly digest)

## Required Environment Variables (in n8n)

| Variable | Used By | Description |
|----------|---------|-------------|
| `AGENT_SERVER_URL` | All workflows | e.g., `http://agent-server:3100` (or `http://localhost:3100` for local dev) |
| `DISCORD_WEBHOOK_URL` | All workflows | Discord channel webhook URL for notifications |
| `SLACK_WEBHOOK_URL` | Weekly Digest | Slack incoming webhook URL |
| `GITHUB_REPO` | Weekly Digest | Repository in `owner/repo` format (default: `iansduncan-oss/ai-cofounder`) |
| `GITHUB_TOKEN` | Issue Pipeline, Weekly Digest | GitHub personal access token for labeling + search API |

## Infra Changes

### Alertmanager
The `alertmanager.yml` receiver now points to `http://n8n:5678/webhook/alertmanager-triage` instead of `${ALERTMANAGER_DISCORD_WEBHOOK_URL}`. Both services are on the `avion_avion_net` Docker network.

### Cron Scripts
After validating the System Health Rollup workflow for 2+ days, disable these VPS cron entries:
- `daily-status.sh` (7 AM daily)
- `check-ssl.sh` (8 AM daily)

## Migration from Old Workflows

1. **Import** `smart-error-triage.json`, `weekly-digest.json`, and `system-health-rollup.json` into n8n
2. **Replace** the existing `GitHub Issue → Goal` workflow with the new `github-issue-to-goal.json`
3. **Deactivate** the `Weekly LLM Cost Digest` workflow
4. **Activate** all new workflows
5. **Verify** the alertmanager config change is deployed
6. **Add** the `GitHub Token` credential in n8n with your `GITHUB_TOKEN`
