#!/bin/bash
# Disk space and inode monitor
# Runs every 6 hours via cron
# Alerts Discord only when thresholds exceeded
#
# Cron: 0 */6 * * * /opt/scripts/disk-monitor.sh >> /var/log/automation/disk-monitor.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
start_timer

DISK_WARN_PCT=80
INODE_WARN_PCT=70

ALERTS=()

log "Checking disk usage..."

# Check root partition disk usage
ROOT_PCT=$(df / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
ROOT_FREE=$(df -h / | awk 'NR==2 {print $4}')
log "Root partition: ${ROOT_PCT}% used (${ROOT_FREE} free)"

if [[ $ROOT_PCT -ge 90 ]]; then
  ALERTS+=("**CRITICAL** — Root partition at **${ROOT_PCT}%** (${ROOT_FREE} free)")
  ALERT_COLOR=$COLOR_RED
  # Auto-trigger cleanup at critical level
  log "Disk critical — triggering emergency Docker cleanup..."
  "${SCRIPT_DIR}/docker-cleanup.sh" >> /var/log/automation/disk-monitor.log 2>&1 || true
elif [[ $ROOT_PCT -ge 85 ]]; then
  ALERTS+=("Root partition at **${ROOT_PCT}%** (${ROOT_FREE} free) — running cleanup")
  ALERT_COLOR=${ALERT_COLOR:-$COLOR_ORANGE}
  # Auto-trigger cleanup at warning level
  log "Disk high — triggering Docker cleanup..."
  "${SCRIPT_DIR}/docker-cleanup.sh" >> /var/log/automation/disk-monitor.log 2>&1 || true
elif [[ $ROOT_PCT -ge $DISK_WARN_PCT ]]; then
  ALERTS+=("Root partition at **${ROOT_PCT}%** (${ROOT_FREE} free)")
  ALERT_COLOR=${ALERT_COLOR:-$COLOR_ORANGE}
fi

# Check inode usage
INODE_PCT=$(df -i / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
log "Root inodes: ${INODE_PCT}% used"

if [[ $INODE_PCT -ge $INODE_WARN_PCT ]]; then
  ALERTS+=("Inode usage at **${INODE_PCT}%**")
  ALERT_COLOR=${ALERT_COLOR:-$COLOR_ORANGE}
fi

# Check /backups partition if mounted
if mountpoint -q /backups 2>/dev/null; then
  BACKUP_PCT=$(df /backups | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
  BACKUP_FREE=$(df -h /backups | awk 'NR==2 {print $4}')
  log "Backup partition: ${BACKUP_PCT}% used (${BACKUP_FREE} free)"

  if [[ $BACKUP_PCT -ge $DISK_WARN_PCT ]]; then
    ALERTS+=("Backup partition at **${BACKUP_PCT}%** (${BACKUP_FREE} free)")
    ALERT_COLOR=${ALERT_COLOR:-$COLOR_ORANGE}
  fi
fi

# Alert only if issues found
if [[ ${#ALERTS[@]} -gt 0 ]]; then
  ALERT_LIST=$(printf '\\n- %s' "${ALERTS[@]}")
  notify_discord \
    "Disk Space Warning" \
    "Disk usage thresholds exceeded:${ALERT_LIST}" \
    "${ALERT_COLOR:-$COLOR_ORANGE}" \
    "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true},{\"name\":\"Check Time\",\"value\":\"$(date '+%H:%M %Z')\",\"inline\":true}]"
fi

log "Disk monitor complete"
heartbeat "disk-monitor"
