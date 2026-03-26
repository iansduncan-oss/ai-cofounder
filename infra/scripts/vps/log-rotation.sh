#!/bin/bash
# Log rotation — compress old logs, delete ancient ones
# Runs daily at 3:30 AM via cron
# Alerts Discord only if >50MB freed
#
# Cron: 30 3 * * * /opt/scripts/log-rotation.sh >> /var/log/automation/log-rotation.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands gzip find
start_timer

LOG_SOURCE_DIR="/var/log/automation"
COMPRESS_AGE_DAYS=7
DELETE_AGE_DAYS=30

log "Starting log rotation..."

# Get disk usage before
BEFORE_KB=$(du -sk "$LOG_SOURCE_DIR" 2>/dev/null | cut -f1 || echo "0")

# Compress .log files older than 7 days (skip already compressed)
COMPRESSED=0
while IFS= read -r logfile; do
  [[ -z "$logfile" ]] && continue
  if gzip "$logfile" 2>/dev/null; then
    COMPRESSED=$((COMPRESSED + 1))
    log "Compressed: $(basename "$logfile")"
  else
    log_error "Failed to compress: ${logfile}"
  fi
done < <(find "$LOG_SOURCE_DIR" -maxdepth 1 -name "*.log" -mtime +$COMPRESS_AGE_DAYS -not -name "*.gz" 2>/dev/null)

# Delete .log.gz files older than 30 days
DELETED=$(find "$LOG_SOURCE_DIR" -maxdepth 1 -name "*.log.gz" -mtime +$DELETE_AGE_DAYS -delete -print 2>/dev/null | wc -l)

# Get disk usage after
AFTER_KB=$(du -sk "$LOG_SOURCE_DIR" 2>/dev/null | cut -f1 || echo "0")
FREED_KB=$((BEFORE_KB - AFTER_KB))
FREED_MB=$((FREED_KB / 1024))

log "Compressed ${COMPRESSED} files, deleted ${DELETED} old archives, freed ${FREED_MB}MB"

# Alert only if >50MB freed
if [[ $FREED_MB -gt 50 ]]; then
  notify_discord \
    "Log Rotation: ${FREED_MB}MB Freed" \
    "Compressed ${COMPRESSED} log files, deleted ${DELETED} old archives." \
    "$COLOR_BLUE" \
    "[{\"name\":\"Space Freed\",\"value\":\"${FREED_MB}MB\",\"inline\":true},{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
fi

log "Log rotation complete"
heartbeat "log-rotation"
