#!/bin/bash
# Database backup for ai-cofounder and n8n
# Runs daily at 2 AM via cron
# Alerts Discord on failure only
#
# Cron: 0 2 * * * /opt/scripts/backup-db.sh >> /var/log/automation/backup-db.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands docker gzip
start_timer

PG_CONTAINER="avion-postgres-1"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup directories
AVION_BACKUP_DIR="/backups/ai-cofounder"
AVION_LATEST_DIR="${AVION_BACKUP_DIR}/latest"
N8N_BACKUP_DIR="/backups/n8n"

mkdir -p "$AVION_BACKUP_DIR" "$AVION_LATEST_DIR" "$N8N_BACKUP_DIR"

ERRORS=()

# Backup ai_cofounder database
log "Starting ai_cofounder database backup..."
AVION_FILE="${AVION_BACKUP_DIR}/avion_${TIMESTAMP}.sql.gz"
if docker exec "$PG_CONTAINER" pg_dump -U avion ai_cofounder 2>>"${LOG_DIR:-/var/log/automation}/backup-db-stderr.log" | gzip > "$AVION_FILE"; then
  AVION_SIZE=$(du -sh "$AVION_FILE" | cut -f1)
  log "avion backup complete: ${AVION_FILE} (${AVION_SIZE})"

  # Update symlink for MonitoringService compatibility
  # monitoring.ts checks: stat -c '%Y %n' /backups/ai-cofounder/latest/db.dump
  ln -sf "$AVION_FILE" "${AVION_LATEST_DIR}/db.dump"
  log "Updated symlink: ${AVION_LATEST_DIR}/db.dump -> ${AVION_FILE}"
else
  rm -f "$AVION_FILE"
  ERRORS+=("avion pg_dump failed")
  log_error "avion backup failed"
fi

# Backup n8n database
log "Starting n8n database backup..."
N8N_FILE="${N8N_BACKUP_DIR}/n8n_${TIMESTAMP}.sql.gz"
if docker exec "$PG_CONTAINER" pg_dump -U avion n8n 2>>"${LOG_DIR:-/var/log/automation}/backup-db-stderr.log" | gzip > "$N8N_FILE"; then
  N8N_SIZE=$(du -sh "$N8N_FILE" | cut -f1)
  log "n8n backup complete: ${N8N_FILE} (${N8N_SIZE})"
else
  rm -f "$N8N_FILE"
  ERRORS+=("n8n pg_dump failed")
  log_error "n8n backup failed"
fi

# Backup n8n Docker volume (workflow data, credentials, etc.)
log "Starting n8n volume backup..."
N8N_VOLUME=$(docker volume ls --format '{{.Name}}' --filter name=n8n_data 2>/dev/null | head -1)
N8N_VOLUME_DIR="${N8N_BACKUP_DIR}/volumes"
mkdir -p "$N8N_VOLUME_DIR"

if [[ -n "$N8N_VOLUME" ]]; then
  N8N_VOL_FILE="${N8N_VOLUME_DIR}/n8n_volume_${TIMESTAMP}.tar.gz"
  if docker run --rm -v "${N8N_VOLUME}:/data:ro" alpine tar czf - -C /data . > "$N8N_VOL_FILE" 2>>"${LOG_DIR:-/var/log/automation}/backup-db-stderr.log"; then
    N8N_VOL_SIZE=$(du -sh "$N8N_VOL_FILE" | cut -f1)
    log "n8n volume backup complete: ${N8N_VOL_FILE} (${N8N_VOL_SIZE})"
  else
    rm -f "$N8N_VOL_FILE"
    ERRORS+=("n8n volume backup failed")
    log_error "n8n volume backup failed"
  fi
else
  log "n8n volume not found — skipping volume backup"
fi

# Prune old backups
log "Pruning backups older than ${RETENTION_DAYS} days..."
PRUNED_AVION=$(find "$AVION_BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
PRUNED_N8N=$(find "$N8N_BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
PRUNED_N8N_VOL=$(find "$N8N_VOLUME_DIR" -maxdepth 1 -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete -print 2>/dev/null | wc -l)
log "Pruned ${PRUNED_AVION} avion + ${PRUNED_N8N} n8n DB + ${PRUNED_N8N_VOL} n8n volume old backups"

# Alert on failure only
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  ERROR_LIST=$(printf '\\n- %s' "${ERRORS[@]}")
  notify_discord \
    "DB Backup Failed" \
    "Database backup encountered errors:${ERROR_LIST}" \
    "$COLOR_RED" \
    "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true},{\"name\":\"Time\",\"value\":\"$(date '+%H:%M %Z')\",\"inline\":true}]"
  exit 1
fi

log "All backups completed successfully"
heartbeat "backup-db"
