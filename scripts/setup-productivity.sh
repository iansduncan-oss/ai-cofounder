#!/usr/bin/env bash
# setup-productivity.sh — one-command setup for the productivity tracker
#
# What this does:
#   1. Verifies prerequisites (Node, Docker, .env)
#   2. Starts Postgres + Redis via Docker Compose
#   3. Pushes the new schema (creates productivity_logs + codebase_insights tables)
#   4. Builds the packages the productivity feature depends on
#   5. Prints next steps

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BOLD=$'\033[1m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
RESET=$'\033[0m'

info()  { echo "${BOLD}==>${RESET} $*"; }
ok()    { echo "${GREEN}✓${RESET} $*"; }
warn()  { echo "${YELLOW}!${RESET} $*"; }
die()   { echo "${RED}✗${RESET} $*" >&2; exit 1; }

info "Productivity tracker setup starting in $ROOT_DIR"
echo

# ── 1. Prerequisites ──────────────────────────────────────────────────────────

info "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || die "Node.js is required (install from https://nodejs.org)"
command -v npm   >/dev/null 2>&1 || die "npm is required"
command -v docker >/dev/null 2>&1 || die "Docker is required (install from https://docs.docker.com)"

NODE_MAJOR="$(node --version | sed -E 's/v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js v20+ is required (found v$NODE_MAJOR)"
fi
ok "Node.js $(node --version)"
ok "npm $(npm --version)"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    warn ".env not found — copying from .env.example"
    cp .env.example .env
    warn "You'll need to edit .env and fill in at least ANTHROPIC_API_KEY before proceeding."
    warn "Optional but recommended for full productivity features:"
    warn "  - GITHUB_TOKEN + GITHUB_MONITORED_REPOS (for PR/CI scanning)"
    warn "  - DISCORD_TOKEN + DISCORD_CLIENT_ID (for /plan /autoplan /audit commands)"
    warn "  - SLACK_BOT_TOKEN (if you want nudges via Slack)"
    warn "  - BRIEFING_HOUR (default 9) and BRIEFING_TIMEZONE (default America/New_York)"
    echo
    read -r -p "Press Enter after editing .env to continue, or Ctrl-C to abort..."
  else
    die "No .env or .env.example found. Cannot proceed."
  fi
else
  ok ".env exists"
fi

# Check for ANTHROPIC_API_KEY in .env
if ! grep -q '^ANTHROPIC_API_KEY=..' .env 2>/dev/null; then
  warn "ANTHROPIC_API_KEY appears to be missing or empty in .env"
  warn "The auto-planner, weekly reflection, and codebase scanner all need it."
  read -r -p "Continue anyway? [y/N] " ans
  [ "${ans:-n}" = "y" ] || die "Aborted"
fi

echo

# ── 2. Docker services ───────────────────────────────────────────────────────

info "Starting Postgres + Redis via Docker Compose..."
npm run docker:up >/dev/null 2>&1 || die "docker:up failed. Check 'docker ps' and 'docker compose logs'"
ok "Docker services up"

# Give Postgres a beat to finish starting
sleep 2

echo

# ── 3. Install dependencies if needed ────────────────────────────────────────

if [ ! -d "node_modules" ]; then
  info "Installing npm dependencies (first run)..."
  npm install >/dev/null 2>&1 || die "npm install failed"
  ok "Dependencies installed"
  echo
fi

# ── 4. Build the packages productivity depends on ───────────────────────────

info "Building shared packages..."
npm run build -w @ai-cofounder/shared    >/dev/null 2>&1 || die "shared build failed"
npm run build -w @ai-cofounder/db        >/dev/null 2>&1 || die "db build failed"
npm run build -w @ai-cofounder/queue     >/dev/null 2>&1 || die "queue build failed"
npm run build -w @ai-cofounder/api-client >/dev/null 2>&1 || die "api-client build failed"
npm run build -w @ai-cofounder/bot-handlers >/dev/null 2>&1 || die "bot-handlers build failed"
ok "Packages built"

echo

# ── 5. Push the schema (creates new tables) ─────────────────────────────────

info "Pushing database schema (creates productivity_logs + codebase_insights tables)..."
if npm run db:push >/dev/null 2>&1; then
  ok "Schema pushed"
else
  warn "db:push failed. If Postgres just started, wait a few seconds and retry."
  warn "You can also run auto-migrations by starting the agent-server (it runs them at boot)."
fi

echo

# ── 6. Summary / next steps ──────────────────────────────────────────────────

cat <<EOF
${BOLD}${GREEN}Setup complete.${RESET}

${BOLD}To start the productivity loop:${RESET}
  ${YELLOW}npm run dev${RESET}

Then:
  - Dashboard:       ${BOLD}http://localhost:5173/dashboard/productivity${RESET}
  - Agent API:       ${BOLD}http://localhost:3100${RESET}
  - OpenAPI docs:    ${BOLD}http://localhost:3100/docs${RESET}

${BOLD}What runs automatically:${RESET}
  - ${GREEN}Every 4 hours:${RESET}  Codebase scan — finds TODOs, open PRs, CI failures, recurring errors
  - ${GREEN}Every 15 minutes:${RESET} Plan sync — auto-marks completed items and tops up urgent work
  - ${GREEN}Every day at BRIEFING_HOUR+1:${RESET} Morning nudge — Jarvis generates your plan and DMs you

${BOLD}Manual triggers (on demand):${RESET}
  Discord:  ${YELLOW}/plan${RESET}, ${YELLOW}/autoplan${RESET}, ${YELLOW}/audit${RESET}, ${YELLOW}/reflect${RESET}, ${YELLOW}/streak${RESET}
  Dashboard: Auto-plan my day / Sync / Rescan buttons
  REST:
    ${YELLOW}POST /api/productivity/auto-plan${RESET}
    ${YELLOW}POST /api/productivity/sync${RESET}
    ${YELLOW}POST /api/codebase/scan${RESET}

${BOLD}To verify everything wired up:${RESET}
  ${YELLOW}curl -X POST http://localhost:3100/api/codebase/scan -H "Authorization: Bearer \$TOKEN"${RESET}
  ${YELLOW}curl -X POST http://localhost:3100/api/productivity/auto-plan -H "Authorization: Bearer \$TOKEN"${RESET}

${BOLD}Troubleshooting:${RESET}
  - Logs:               ${YELLOW}docker compose logs -f${RESET}
  - DB shell:           ${YELLOW}npm run db:studio${RESET}
  - Restart services:   ${YELLOW}npm run docker:down && npm run docker:up${RESET}
EOF
