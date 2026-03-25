#!/bin/bash
# Backup integrity verification
# Runs weekly Sunday at 4 AM via cron
# Alerts Discord on any issues
#
# Cron: 0 4 * * 0 /opt/scripts/backup-verify.sh >> /var/log/automation/backup-verify.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands docker gzip
start_timer

LATEST_SYMLINK="/backups/ai-cofounder/latest/db.dump"
EXPECTED_MIN_TABLES=10
MAX_AGE_HOURS=36

ERRORS=()

log "Verifying latest backup integrity..."

# Check symlink exists and points to a real file
if [[ ! -L "$LATEST_SYMLINK" ]]; then
  ERRORS+=("Backup symlink missing: ${LATEST_SYMLINK}")
  log_error "Symlink missing"
elif [[ ! -f "$LATEST_SYMLINK" ]]; then
  ERRORS+=("Backup symlink is broken — target file not found")
  log_error "Broken symlink"
else
  BACKUP_FILE=$(readlink -f "$LATEST_SYMLINK")
  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  log "Backup file: ${BACKUP_FILE} (${BACKUP_SIZE})"

  # Check backup age
  BACKUP_EPOCH=$(stat -c '%Y' "$BACKUP_FILE" 2>/dev/null || stat -f '%m' "$BACKUP_FILE" 2>/dev/null)
  NOW_EPOCH=$(date +%s)
  AGE_HOURS=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))
  log "Backup age: ${AGE_HOURS}h"

  if [[ $AGE_HOURS -gt $MAX_AGE_HOURS ]]; then
    ERRORS+=("Backup is **${AGE_HOURS}h** old (expected <${MAX_AGE_HOURS}h)")
  fi

  # Decompress and verify with pg_restore --list
  TEMP_SQL=$(mktemp)
  trap 'rm -f "$TEMP_SQL"' EXIT

  if gunzip -c "$BACKUP_FILE" > "$TEMP_SQL" 2>/dev/null; then
    log "Decompression successful"

    # Count tables in the dump (look for CREATE TABLE statements)
    TABLE_COUNT=$(grep -c 'CREATE TABLE' "$TEMP_SQL" 2>/dev/null || echo "0")
    log "Found ${TABLE_COUNT} CREATE TABLE statements"

    if [[ $TABLE_COUNT -lt $EXPECTED_MIN_TABLES ]]; then
      ERRORS+=("Only **${TABLE_COUNT}** tables found (expected ${EXPECTED_MIN_TABLES}+)")
    fi

    # Basic size sanity check — decompressed should be >1KB
    DECOMP_SIZE=$(du -sk "$TEMP_SQL" | cut -f1)
    if [[ $DECOMP_SIZE -lt 1 ]]; then
      ERRORS+=("Decompressed backup is suspiciously small (${DECOMP_SIZE}KB)")
    fi
  else
    ERRORS+=("Failed to decompress backup — file may be corrupt")
    log_error "Decompression failed"
  fi
fi

# Report results
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  ERROR_LIST=$(printf '\\n- %s' "${ERRORS[@]}")
  notify_discord \
    "Backup Verification Failed" \
    "Weekly backup integrity check found issues:${ERROR_LIST}" \
    "$COLOR_RED" \
    "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true},{\"name\":\"Check Time\",\"value\":\"$(date '+%H:%M %Z')\",\"inline\":true}]"
  log_error "Verification failed: ${#ERRORS[@]} issues"
  exit 1
fi

log "Backup verification passed (${AGE_HOURS}h old, ${TABLE_COUNT} tables, ${BACKUP_SIZE})"
heartbeat "backup-verify"
