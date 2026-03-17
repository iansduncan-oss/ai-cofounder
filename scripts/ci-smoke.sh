#!/usr/bin/env bash
set -euo pipefail

# CI Smoke Test — mirrors .github/workflows/ci.yml locally + adds typecheck
# Usage: ./scripts/ci-smoke.sh

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

TOTAL_START=$SECONDS

step() {
  echo -e "\n${BOLD}${CYAN}==> $1${RESET}"
  STEP_START=$SECONDS
}

step_done() {
  local elapsed=$(( SECONDS - STEP_START ))
  echo -e "${GREEN}    done (${elapsed}s)${RESET}"
}

fail() {
  echo -e "${RED}FAILED: $1${RESET}" >&2
  exit 1
}

# Ensure we're at monorepo root
if [ ! -f "package.json" ] || [ ! -d "apps" ] || [ ! -d "packages" ]; then
  fail "Must be run from the monorepo root (ai-cofounder/)"
fi

# ─── Step 1: Type Check ───
step "Type Check (all workspaces)"
WORKSPACES=(
  apps/agent-server
  apps/discord-bot
  apps/slack-bot
  apps/dashboard
  packages/shared
  packages/db
  packages/llm
  packages/queue
  packages/sandbox
  packages/api-client
  packages/bot-handlers
  packages/rag
  packages/test-utils
  packages/mcp-server
)
for ws in "${WORKSPACES[@]}"; do
  if [ -f "$ws/tsconfig.json" ]; then
    echo "  Checking $ws..."
    npx tsc --noEmit -p "$ws/tsconfig.json" || fail "typecheck failed in $ws"
  fi
done
step_done

# ─── Step 2: Lint ───
step "Lint"
npm run lint || fail "lint failed"
step_done

# ─── Step 3: Build ───
step "Build"
npm run build || fail "build failed"
step_done

# ─── Step 4: Test ───
step "Test"
npm run test || fail "tests failed"
step_done

# ─── Summary ───
TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))
echo -e "\n${BOLD}${GREEN}All checks passed in ${TOTAL_ELAPSED}s${RESET}"
