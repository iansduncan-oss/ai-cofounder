#!/bin/bash
# Docker cleanup — prune unused resources
# Runs daily at 3 AM via cron
# Alerts Discord only if >500MB freed
#
# Cron: 0 3 * * * /opt/scripts/docker-cleanup.sh >> /var/log/automation/docker-cleanup.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands docker
start_timer

log "Starting Docker cleanup..."

# Capture disk usage before
BEFORE=$(df / --output=used | tail -1 | tr -d ' ')

# Prune all images older than 48h (not just dangling)
log "Pruning images older than 48h..."
if OUTPUT=$(docker image prune -a -f --filter "until=48h" 2>&1); then
  log "Image prune done"
else
  log_error "Image prune failed: ${OUTPUT}"
fi

# Prune stopped containers older than 24h
log "Pruning stopped containers (>24h)..."
if OUTPUT=$(docker container prune -f --filter "until=24h" 2>&1); then
  log "Container prune done"
else
  log_error "Container prune failed: ${OUTPUT}"
fi

# Prune unused volumes (not attached to any container)
log "Pruning unused volumes..."
if OUTPUT=$(docker volume prune -f 2>&1); then
  log "Volume prune done"
else
  log_error "Volume prune failed: ${OUTPUT}"
fi

# Prune build cache older than 3 days
log "Pruning build cache (>3d)..."
if OUTPUT=$(docker builder prune -f --filter "until=72h" 2>&1); then
  log "Build cache prune done"
else
  log_error "Build cache prune failed: ${OUTPUT}"
fi

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
heartbeat "docker-cleanup"
