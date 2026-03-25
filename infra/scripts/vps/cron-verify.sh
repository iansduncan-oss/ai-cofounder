#!/bin/bash
# Crontab verification — ensure all expected entries exist
# Runs weekly Monday at 6 AM via cron
# Alerts Discord on missing entries
#
# Cron: 0 6 * * 1 /opt/scripts/cron-verify.sh >> /var/log/automation/cron-verify.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
start_timer

EXPECTED_SCRIPTS=(
  "backup-db.sh"
  "docker-cleanup.sh"
  "check-ssl.sh"
  "daily-status.sh"
  "cost-tracker.sh"
  "stale-branch-cleaner.sh"
  "log-rotation.sh"
  "disk-monitor.sh"
  "container-health.sh"
  "backup-verify.sh"
  "cron-verify.sh"
)

log "Verifying crontab entries..."

# Get current crontab
CURRENT_CRON=$(sudo crontab -l 2>/dev/null || echo "")

if [[ -z "$CURRENT_CRON" ]]; then
  notify_discord \
    "Cron Verification: No Crontab" \
    "Root crontab is empty — no automation scripts are scheduled!" \
    "$COLOR_RED"
  log_error "Crontab is empty"
  exit 1
fi

MISSING=()
for script in "${EXPECTED_SCRIPTS[@]}"; do
  if ! echo "$CURRENT_CRON" | grep -q "$script"; then
    MISSING+=("$script")
    log_error "Missing cron entry: ${script}"
  fi
done

log "Checked ${#EXPECTED_SCRIPTS[@]} scripts, ${#MISSING[@]} missing"

if [[ ${#MISSING[@]} -gt 0 ]]; then
  MISSING_LIST=$(printf '\\n- `%s`' "${MISSING[@]}")
  notify_discord \
    "Cron Verification: ${#MISSING[@]} Missing" \
    "Expected crontab entries not found:${MISSING_LIST}\\n\\nRe-run \`deploy-vps.sh\` to restore." \
    "$COLOR_ORANGE" \
    "[{\"name\":\"Total Expected\",\"value\":\"${#EXPECTED_SCRIPTS[@]}\",\"inline\":true},{\"name\":\"Missing\",\"value\":\"${#MISSING[@]}\",\"inline\":true}]"
fi

log "Cron verification complete"
heartbeat "cron-verify"
