#!/bin/bash
# Shared utilities for Mac automation scripts
# Sourced by all Mac scripts — not executed directly

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
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

# Validate required commands exist — call after sourcing common.sh
require_commands() {
  local missing=()
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required commands: ${missing[*]}"
    exit 1
  fi
}

# Execution timing — call start_timer at script start, heartbeat at end
_SCRIPT_START_EPOCH=""
start_timer() {
  _SCRIPT_START_EPOCH=$(date +%s)
}

heartbeat() {
  local script_name="${1:-$(basename "$0" .sh)}"
  if [[ "${HEARTBEAT_ENABLED:-false}" != "true" || -z "$_SCRIPT_START_EPOCH" ]]; then
    return 0
  fi
  local elapsed=$(( $(date +%s) - _SCRIPT_START_EPOCH ))
  local mins=$((elapsed / 60))
  local secs=$((elapsed % 60))
  notify_discord \
    "${script_name} completed" \
    "Finished in ${mins}m ${secs}s" \
    "$COLOR_GREEN" \
    "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true},{\"name\":\"Duration\",\"value\":\"${mins}m ${secs}s\",\"inline\":true}]"
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
    "footer": {"text": "Mac Automation"},
    "timestamp": "${timestamp}"
  }]
}
EOF
)

  local attempt
  for attempt in 1 2 3; do
    local http_code
    http_code=$(curl --connect-timeout 5 --max-time 10 \
      -s -o /dev/null -w '%{http_code}' \
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
