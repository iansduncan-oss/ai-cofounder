#!/bin/bash
# Mac weekly maintenance — brew updates + cache cleanup
# Runs Sunday at 10 AM via cron
# Always sends weekly summary
#
# Cron: 0 10 * * 0 /Users/ianduncan/Scripts/mac-maintenance.sh >> /Users/ianduncan/Scripts/logs/mac-maintenance.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

log "Starting weekly Mac maintenance..."

# Ensure brew is in PATH for cron
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SUMMARY=()

# --- Homebrew updates ---
log "Running brew update..."
BREW_UPDATE=$(brew update 2>&1)

# Check for outdated packages
OUTDATED=$(brew outdated 2>/dev/null)
if [[ -n "$OUTDATED" ]]; then
  OUTDATED_COUNT=$(echo "$OUTDATED" | wc -l | tr -d ' ')
  log "Upgrading ${OUTDATED_COUNT} packages..."
  brew upgrade 2>&1 | tail -5
  SUMMARY+=("Upgraded **${OUTDATED_COUNT}** brew packages")
else
  SUMMARY+=("All brew packages up to date")
fi

# Cleanup old versions
CLEANUP_OUTPUT=$(brew cleanup --prune=7 2>&1)
CLEANUP_FREED=$(echo "$CLEANUP_OUTPUT" | grep -oE '[0-9.]+[KMGT]B' | tail -1 || echo "")
if [[ -n "$CLEANUP_FREED" ]]; then
  SUMMARY+=("Brew cleanup freed ${CLEANUP_FREED}")
fi

# --- Cache cleanup ---
log "Cleaning user caches older than 30 days..."
CACHE_DIR="$HOME/Library/Caches"
if [[ -d "$CACHE_DIR" ]]; then
  # Only clean known safe cache directories
  CACHE_FREED_KB=0
  for dir in com.apple.Safari com.spotify.client com.docker.docker; do
    if [[ -d "${CACHE_DIR}/${dir}" ]]; then
      SIZE_BEFORE=$(du -sk "${CACHE_DIR}/${dir}" 2>/dev/null | cut -f1 || echo "0")
      find "${CACHE_DIR}/${dir}" -type f -mtime +30 -delete 2>/dev/null || true
      SIZE_AFTER=$(du -sk "${CACHE_DIR}/${dir}" 2>/dev/null | cut -f1 || echo "0")
      CACHE_FREED_KB=$((CACHE_FREED_KB + SIZE_BEFORE - SIZE_AFTER))
    fi
  done

  if [[ $CACHE_FREED_KB -gt 1024 ]]; then
    CACHE_FREED_MB=$((CACHE_FREED_KB / 1024))
    SUMMARY+=("Cleared ${CACHE_FREED_MB}MB of old caches")
  fi
fi

# --- Disk usage ---
DISK_USAGE=$(df -h / | awk 'NR==2{print $5}')
DISK_FREE=$(df -h / | awk 'NR==2{print $4}')
DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')

# Build summary message
BODY=$(printf '\\n- %s' "${SUMMARY[@]}")

notify_discord \
  "Weekly Mac Maintenance" \
  "Maintenance complete:${BODY}" \
  "$COLOR_GREEN" \
  "[{\"name\":\"Disk Used\",\"value\":\"${DISK_USAGE}\",\"inline\":true},{\"name\":\"Free\",\"value\":\"${DISK_FREE}\",\"inline\":true},{\"name\":\"Total\",\"value\":\"${DISK_TOTAL}\",\"inline\":true}]"

log "Weekly maintenance complete"
