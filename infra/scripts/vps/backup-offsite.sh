#!/bin/bash
# Offsite backup to Backblaze B2 via Restic
# Runs daily at 3 AM (after backup-db.sh at 2 AM)
# Backs up: database dumps, n8n volumes, docker-compose files, .env configs
#
# Setup:
#   1. Install restic: apt install restic  (or download from github.com/restic/restic)
#   2. Create B2 bucket: b2 authorize-account && b2 create-bucket avion-backups allPrivate
#   3. Create B2 app key with access to that bucket
#   4. Add to .env:
#        B2_ACCOUNT_ID=your_account_id
#        B2_ACCOUNT_KEY=your_app_key
#        B2_BUCKET=avion-backups
#        RESTIC_PASSWORD=strong_encryption_passphrase
#   5. Initialize repo: restic -r b2:avion-backups:/ init
#   6. Add cron: 0 3 * * * /opt/ai-cofounder/infra/scripts/vps/backup-offsite.sh >> /var/log/automation/backup-offsite.log 2>&1
#
# Cron: 0 3 * * * /opt/scripts/backup-offsite.sh >> /var/log/automation/backup-offsite.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands restic
start_timer

# B2 credentials from .env
: "${B2_ACCOUNT_ID:?Missing B2_ACCOUNT_ID in .env}"
: "${B2_ACCOUNT_KEY:?Missing B2_ACCOUNT_KEY in .env}"
: "${B2_BUCKET:?Missing B2_BUCKET in .env}"
: "${RESTIC_PASSWORD:?Missing RESTIC_PASSWORD in .env}"

export B2_ACCOUNT_ID
export B2_ACCOUNT_KEY
export RESTIC_PASSWORD
RESTIC_REPO="b2:${B2_BUCKET}:/"
export RESTIC_REPOSITORY="$RESTIC_REPO"

ERRORS=()

# Verify repo is accessible
log "Checking Restic repository..."
if ! restic snapshots --latest 1 --json > /dev/null 2>&1; then
  log_error "Cannot access Restic repo. Run 'restic -r $RESTIC_REPO init' first."
  notify_discord \
    "Offsite Backup Failed" \
    "Cannot access Restic repository at ${RESTIC_REPO}" \
    "$COLOR_RED"
  exit 1
fi

# Directories to back up
BACKUP_PATHS=(
  "/backups"                          # DB dumps + n8n volumes
  "/opt/ai-cofounder/.env"            # Production env config
  "/opt/ai-cofounder/docker-compose.prod.yml"
  "/opt/ai-cofounder/docker-compose.n8n.yml"
  "/opt/ai-cofounder/docker-compose.monitoring.yml"
)

# Optional paths — include if they exist
for optional in \
  "/opt/ai-cofounder/docker-compose.uptimekuma.yml" \
  "/etc/docker/daemon.json" \
  "/opt/ai-cofounder/infra/scripts/vps"; do
  [[ -e "$optional" ]] && BACKUP_PATHS+=("$optional")
done

# Build --include args for paths that exist
VALID_PATHS=()
for p in "${BACKUP_PATHS[@]}"; do
  if [[ -e "$p" ]]; then
    VALID_PATHS+=("$p")
  else
    log "Skipping missing path: $p"
  fi
done

if [[ ${#VALID_PATHS[@]} -eq 0 ]]; then
  log_error "No valid backup paths found"
  exit 1
fi

# Run backup
log "Starting Restic backup of ${#VALID_PATHS[@]} paths..."
if restic backup \
  --verbose \
  --tag "automated" \
  --tag "vps" \
  --exclude="*.tmp" \
  --exclude="*.log" \
  "${VALID_PATHS[@]}"; then
  log "Restic backup completed"
else
  ERRORS+=("restic backup failed")
  log_error "Restic backup failed"
fi

# Prune old snapshots — keep 7 daily, 4 weekly, 3 monthly
log "Pruning old snapshots..."
if restic forget \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 3 \
  --prune \
  --tag "automated"; then
  log "Snapshot pruning completed"
else
  ERRORS+=("restic prune failed")
  log_error "Restic prune failed"
fi

# Check repo integrity (weekly — only on Sundays)
if [[ $(date +%u) -eq 7 ]]; then
  log "Running weekly integrity check..."
  if restic check; then
    log "Integrity check passed"
  else
    ERRORS+=("restic check failed — possible data corruption")
    log_error "Integrity check failed"
  fi
fi

# Get stats for notification
SNAPSHOT_COUNT=$(restic snapshots --json 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
REPO_SIZE=$(restic stats --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d['total_size']/1024/1024:.1f} MB\")" 2>/dev/null || echo "?")

# Alert on failure
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  ERROR_LIST=$(printf '\\n- %s' "${ERRORS[@]}")
  notify_discord \
    "Offsite Backup Failed" \
    "Restic backup to B2 encountered errors:${ERROR_LIST}" \
    "$COLOR_RED" \
    "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true},{\"name\":\"Repo\",\"value\":\"${B2_BUCKET}\",\"inline\":true}]"
  exit 1
fi

log "Offsite backup complete — ${SNAPSHOT_COUNT} snapshots, ${REPO_SIZE} total"
heartbeat "backup-offsite"
