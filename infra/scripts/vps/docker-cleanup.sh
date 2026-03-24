#!/bin/bash
# Docker cleanup — prune unused resources
# Runs Sunday at 3 AM via cron
# Alerts Discord only if >500MB freed
#
# Cron: 0 3 * * 0 /opt/scripts/docker-cleanup.sh >> /var/log/automation/docker-cleanup.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

log "Starting Docker cleanup..."

# Capture disk usage before
BEFORE=$(df / --output=used | tail -1 | tr -d ' ')

# Prune dangling images
log "Pruning dangling images..."
docker image prune -f 2>/dev/null || true

# Prune stopped containers older than 24h
log "Pruning stopped containers (>24h)..."
docker container prune -f --filter "until=24h" 2>/dev/null || true

# Prune unused volumes (not attached to any container)
log "Pruning unused volumes..."
docker volume prune -f 2>/dev/null || true

# Prune build cache older than 7 days
log "Pruning build cache (>7d)..."
docker builder prune -f --filter "until=168h" 2>/dev/null || true

# Capture disk usage after
AFTER=$(df / --output=used | tail -1 | tr -d ' ')

# Calculate space freed (in KB, convert to MB)
FREED_KB=$((BEFORE - AFTER))
FREED_MB=$((FREED_KB / 1024))

log "Space freed: ${FREED_MB}MB"

# Alert only if >500MB freed
if [[ $FREED_MB -gt 500 ]]; then
  FREED_HUMAN=$(numfmt --to=iec --suffix=B $((FREED_KB * 1024)) 2>/dev/null || echo "${FREED_MB}MB")
  DISK_USAGE=$(df -h / | awk 'NR==2{print $5 " used (" $4 " free)"}')

  notify_discord \
    "Docker Cleanup: ${FREED_HUMAN} Freed" \
    "Weekly Docker cleanup reclaimed significant space." \
    "$COLOR_BLUE" \
    "[{\"name\":\"Space Freed\",\"value\":\"${FREED_HUMAN}\",\"inline\":true},{\"name\":\"Disk Now\",\"value\":\"${DISK_USAGE}\",\"inline\":true}]"
fi

log "Docker cleanup complete"
