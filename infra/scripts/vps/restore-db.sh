#!/bin/bash
# Database and n8n volume restore for ai-cofounder
# Creates pre-restore backup before any destructive operation
#
# Usage:
#   restore-db.sh --avion FILE       Restore ai_cofounder database
#   restore-db.sh --n8n FILE         Restore n8n database
#   restore-db.sh --n8n-volume FILE  Restore n8n Docker volume
#   restore-db.sh --all              Restore all from latest backups
#   restore-db.sh --help             Show this help

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands docker gzip gunzip
start_timer

PG_CONTAINER="avion-postgres-1"
AVION_BACKUP_DIR="/backups/ai-cofounder"
N8N_BACKUP_DIR="/backups/n8n"
N8N_VOLUME_DIR="${N8N_BACKUP_DIR}/volumes"
PRE_RESTORE_DIR="/backups/pre-restore"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

usage() {
  head -12 "$0" | tail -8 | sed 's/^# //'
  exit 0
}

validate_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    log_error "${label} file not found: ${file}"
    exit 1
  fi
  if ! gzip -t "$file" 2>/dev/null && ! tar tzf "$file" &>/dev/null; then
    log_error "${label} file is not a valid gzip/tar.gz archive: ${file}"
    exit 1
  fi
}

confirm() {
  local msg="$1"
  echo ""
  echo "WARNING: ${msg}"
  read -r -p "Type 'yes' to continue: " response
  if [[ "$response" != "yes" ]]; then
    log "Aborted by user"
    exit 0
  fi
}

pre_restore_backup() {
  local label="$1"
  local backup_file="$2"
  mkdir -p "$PRE_RESTORE_DIR"

  log "Creating pre-restore backup of ${label}..."
  if [[ "$label" == "avion" ]]; then
    docker exec "$PG_CONTAINER" pg_dump -U avion ai_cofounder 2>/dev/null | gzip > "$backup_file"
  elif [[ "$label" == "n8n" ]]; then
    docker exec "$PG_CONTAINER" pg_dump -U avion n8n 2>/dev/null | gzip > "$backup_file"
  fi
  log "Pre-restore backup saved: ${backup_file}"
}

restore_avion() {
  local file="$1"
  validate_file "$file" "avion"
  confirm "This will DROP and restore the ai_cofounder database from: ${file}"

  pre_restore_backup "avion" "${PRE_RESTORE_DIR}/avion_pre_restore_${TIMESTAMP}.sql.gz"

  log "Restoring ai_cofounder database from ${file}..."
  if gunzip -c "$file" | docker exec -i "$PG_CONTAINER" psql -U avion -d ai_cofounder 2>>"${LOG_DIR}/restore-db-stderr.log"; then
    log "ai_cofounder database restored successfully"
    notify_discord \
      "DB Restore Complete" \
      "ai_cofounder database restored from: $(basename "$file")" \
      "$COLOR_GREEN" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
  else
    log_error "ai_cofounder database restore failed"
    notify_discord \
      "DB Restore Failed" \
      "ai_cofounder restore failed from: $(basename "$file")" \
      "$COLOR_RED" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
    exit 1
  fi
}

restore_n8n() {
  local file="$1"
  validate_file "$file" "n8n"
  confirm "This will DROP and restore the n8n database from: ${file}"

  pre_restore_backup "n8n" "${PRE_RESTORE_DIR}/n8n_pre_restore_${TIMESTAMP}.sql.gz"

  log "Restoring n8n database from ${file}..."
  if gunzip -c "$file" | docker exec -i "$PG_CONTAINER" psql -U avion -d n8n 2>>"${LOG_DIR}/restore-db-stderr.log"; then
    log "n8n database restored successfully"
    notify_discord \
      "DB Restore Complete" \
      "n8n database restored from: $(basename "$file")" \
      "$COLOR_GREEN" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
  else
    log_error "n8n database restore failed"
    notify_discord \
      "DB Restore Failed" \
      "n8n restore failed from: $(basename "$file")" \
      "$COLOR_RED" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
    exit 1
  fi
}

restore_n8n_volume() {
  local file="$1"
  validate_file "$file" "n8n-volume"

  local volume
  volume=$(docker volume ls --format '{{.Name}}' --filter name=n8n_data 2>/dev/null | head -1)
  if [[ -z "$volume" ]]; then
    log_error "n8n Docker volume not found"
    exit 1
  fi

  confirm "This will REPLACE the n8n Docker volume (${volume}) contents from: ${file}"

  # Pre-restore backup of current volume
  mkdir -p "$PRE_RESTORE_DIR"
  local pre_file="${PRE_RESTORE_DIR}/n8n_volume_pre_restore_${TIMESTAMP}.tar.gz"
  log "Creating pre-restore backup of n8n volume..."
  docker run --rm -v "${volume}:/data:ro" alpine tar czf - -C /data . > "$pre_file"
  log "Pre-restore volume backup saved: ${pre_file}"

  log "Restoring n8n volume from ${file}..."
  # Stop n8n before restoring volume
  local n8n_container
  n8n_container=$(docker ps --format '{{.Names}}' --filter name=n8n | head -1)
  if [[ -n "$n8n_container" ]]; then
    log "Stopping n8n container: ${n8n_container}"
    docker stop "$n8n_container"
  fi

  if docker run --rm -v "${volume}:/data" -i alpine sh -c "rm -rf /data/* && tar xzf - -C /data" < "$file"; then
    log "n8n volume restored successfully"
    # Restart n8n if it was running
    if [[ -n "$n8n_container" ]]; then
      docker start "$n8n_container"
      log "n8n container restarted"
    fi
    notify_discord \
      "Volume Restore Complete" \
      "n8n volume restored from: $(basename "$file")" \
      "$COLOR_GREEN" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
  else
    log_error "n8n volume restore failed"
    # Restart n8n even on failure
    if [[ -n "$n8n_container" ]]; then
      docker start "$n8n_container"
    fi
    notify_discord \
      "Volume Restore Failed" \
      "n8n volume restore failed from: $(basename "$file")" \
      "$COLOR_RED" \
      "[{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
    exit 1
  fi
}

restore_all() {
  local avion_file="${AVION_BACKUP_DIR}/latest/db.dump"
  local n8n_files
  n8n_files=$(find "$N8N_BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" -type f 2>/dev/null | sort -r | head -1)
  local n8n_vol_files
  n8n_vol_files=$(find "$N8N_VOLUME_DIR" -maxdepth 1 -name "*.tar.gz" -type f 2>/dev/null | sort -r | head -1)

  echo "Restore targets:"
  echo "  avion DB:     ${avion_file}"
  echo "  n8n DB:       ${n8n_files:-NOT FOUND}"
  echo "  n8n volume:   ${n8n_vol_files:-NOT FOUND}"
  echo ""

  confirm "This will restore ALL of the above"

  if [[ -f "$avion_file" ]]; then
    restore_avion "$avion_file"
  else
    log_error "No avion backup found at ${avion_file}"
  fi

  if [[ -n "$n8n_files" ]]; then
    restore_n8n "$n8n_files"
  else
    log "No n8n DB backup found — skipping"
  fi

  if [[ -n "$n8n_vol_files" ]]; then
    restore_n8n_volume "$n8n_vol_files"
  else
    log "No n8n volume backup found — skipping"
  fi
}

# --- Main ---

if [[ $# -eq 0 ]]; then
  usage
fi

case "$1" in
  --avion)
    [[ -z "${2:-}" ]] && { log_error "--avion requires a file path"; exit 1; }
    restore_avion "$2"
    ;;
  --n8n)
    [[ -z "${2:-}" ]] && { log_error "--n8n requires a file path"; exit 1; }
    restore_n8n "$2"
    ;;
  --n8n-volume)
    [[ -z "${2:-}" ]] && { log_error "--n8n-volume requires a file path"; exit 1; }
    restore_n8n_volume "$2"
    ;;
  --all)
    restore_all
    ;;
  --help|-h)
    usage
    ;;
  *)
    log_error "Unknown option: $1"
    usage
    ;;
esac

log "Restore operation completed"
