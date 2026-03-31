#!/usr/bin/env bash
set -euo pipefail

# Deploy Dry Run — validate deploy readiness locally
# Usage: ./scripts/deploy-dry-run.sh

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

TOTAL_START=$SECONDS
WARNINGS=0

step() {
  echo -e "\n${BOLD}${CYAN}==> $1${RESET}"
  STEP_START=$SECONDS
}

step_done() {
  local elapsed=$(( SECONDS - STEP_START ))
  echo -e "${GREEN}    done (${elapsed}s)${RESET}"
}

warn() {
  echo -e "${YELLOW}    WARN: $1${RESET}"
  WARNINGS=$((WARNINGS + 1))
}

fail() {
  echo -e "${RED}FAILED: $1${RESET}" >&2
  exit 1
}

# Ensure we're at monorepo root
if [ ! -f "package.json" ] || [ ! -d "apps" ] || [ ! -d "packages" ]; then
  fail "Must be run from the monorepo root (ai-cofounder/)"
fi

echo -e "${BOLD}Deploy Dry Run${RESET}"
echo "Commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
echo "Branch: $(git rev-parse --abbrev-ref HEAD)"

# ─── Step 1: Build (includes typecheck) ───
step "Build (includes typecheck)"
npm run build || fail "build failed"
step_done

# ─── Step 2: Lint ───
step "Lint"
npm run lint || fail "lint failed"
step_done

# ─── Step 3: Test ───
step "Test"
npm run test || fail "tests failed"
step_done

# ─── Step 4: Docker images ───
step "Build Docker images (no push)"
for svc in agent-server discord-bot slack-bot; do
  DOCKERFILE="apps/${svc}/Dockerfile"
  if [ ! -f "$DOCKERFILE" ]; then
    fail "Dockerfile not found: $DOCKERFILE"
  fi
  echo "  Building ai-cofounder-${svc}:dry-run..."
  docker build -f "$DOCKERFILE" -t "ai-cofounder-${svc}:dry-run" . || fail "docker build failed for $svc"
done
step_done

# ─── Step 5: Validate .env ───
step "Check required environment variables"
REQUIRED_VARS=(
  DATABASE_URL
  ANTHROPIC_API_KEY
  DISCORD_TOKEN
  DISCORD_CLIENT_ID
  REDIS_PASSWORD
)

if [ -f ".env" ]; then
  for var in "${REQUIRED_VARS[@]}"; do
    # Check if var is set and non-empty in .env
    VALUE=$(grep -E "^${var}=" .env 2>/dev/null | cut -d= -f2- || true)
    if [ -z "$VALUE" ]; then
      warn "$var is not set in .env"
    else
      echo -e "  ${GREEN}ok${RESET}: $var"
    fi
  done
else
  warn ".env file not found — skipping env var check"
fi
step_done

# ─── Step 6: Validate compose files ───
step "Validate Docker Compose files"
for f in docker-compose.prod.yml docker-compose.n8n.yml docker-compose.uptimekuma.yml docker-compose.monitoring.yml; do
  if [ -f "$f" ]; then
    if docker compose -f "$f" config --quiet 2>/dev/null; then
      echo -e "  ${GREEN}ok${RESET}: $f"
    else
      warn "$f failed validation"
    fi
  fi
done
step_done

# ─── Summary ───
TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))

echo ""
echo -e "${BOLD}========================================${RESET}"
echo -e "${BOLD}  Deploy Readiness Summary${RESET}"
echo -e "${BOLD}========================================${RESET}"
echo "  Commit:  $(git rev-parse --short HEAD)"
echo "  Branch:  $(git rev-parse --abbrev-ref HEAD)"
echo ""
echo "  Services:"
echo "    - ai-cofounder-agent-server"
echo "    - ai-cofounder-discord-bot"
echo "    - ai-cofounder-slack-bot"
echo ""

if [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}${WARNINGS} warning(s)${RESET} — review above"
else
  echo -e "  ${GREEN}All checks passed${RESET}"
fi

echo ""
echo -e "  Completed in ${TOTAL_ELAPSED}s"
echo -e "${BOLD}========================================${RESET}"

if [ "$WARNINGS" -eq 0 ]; then
  echo -e "\n${GREEN}Ready to deploy.${RESET} Push to main or run: npm run deploy:dry-run (CI)"
fi
