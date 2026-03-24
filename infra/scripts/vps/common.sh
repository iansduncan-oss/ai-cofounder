#!/bin/bash
# Shared utilities for VPS automation scripts
# Sourced by all VPS scripts — not executed directly

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# Load environment
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
else
  echo "ERROR: Missing ${ENV_FILE}" >&2
  exit 1
fi

: "${DISCORD_NOTIFICATION_WEBHOOK_URL:?Missing DISCORD_NOTIFICATION_WEBHOOK_URL in .env}"

# Colors (Discord embed decimal values)
COLOR_GREEN=2278400    # 0x22BB00
COLOR_RED=15548997     # 0xED4245
COLOR_YELLOW=16776160  # 0xFFE000
COLOR_ORANGE=15105570  # 0xE67E22
COLOR_BLUE=5793266     # 0x5865F2

# Logging
LOG_DIR="/var/log/automation"
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

# Discord notification with retry (max 3 attempts)
notify_discord() {
  local title="$1"
  local description="$2"
  local color="${3:-$COLOR_GREEN}"
  local fields="${4:-[]}"

  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local payload
  payload=$(cat <<EOF
{
  "embeds": [{
    "title": "${title}",
    "description": "${description}",
    "color": ${color},
    "fields": ${fields},
    "footer": {"text": "VPS Automation"},
    "timestamp": "${timestamp}"
  }]
}
EOF
)

  local attempt
  for attempt in 1 2 3; do
    local http_code
    http_code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$DISCORD_NOTIFICATION_WEBHOOK_URL") || true

    if [[ "$http_code" == "204" || "$http_code" == "200" ]]; then
      return 0
    fi

    log_error "Discord notify attempt ${attempt}/3 failed (HTTP ${http_code})"
    sleep $((attempt * 2))
  done

  log_error "Discord notification failed after 3 attempts"
  return 1
}
