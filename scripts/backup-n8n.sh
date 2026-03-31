#!/usr/bin/env bash
# backup-n8n.sh — Backup n8n Docker volume data with GPG encryption.
# Designed to run alongside the existing DB backup in cron.
#
# Usage: ./scripts/backup-n8n.sh [BACKUP_DIR]
#
# Environment variables:
#   GPG_RECIPIENT  — GPG key ID or email for encryption (required)
#   BACKUP_DIR     — override default backup directory (optional, also settable via $1)
#   RETENTION_DAYS — number of days to keep local backups (default: 7)

set -euo pipefail

VOLUME_NAME="ai-cofounder-n8n_n8n_data"
BACKUP_DIR="${1:-${BACKUP_DIR:-/opt/backups/n8n}}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="n8n-backup-${TIMESTAMP}.tar.gz"
ENCRYPTED_NAME="${ARCHIVE_NAME}.gpg"

# Validate GPG recipient is set
if [[ -z "${GPG_RECIPIENT:-}" ]]; then
  echo "ERROR: GPG_RECIPIENT env var is required for encryption" >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Verify the Docker volume exists
if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "ERROR: Docker volume '${VOLUME_NAME}' not found" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Starting n8n backup..."

# Create tarball from the Docker volume using a temporary container
docker run --rm \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.19 \
  tar czf "/backup/${ARCHIVE_NAME}" -C /data .

# Encrypt with GPG (same pattern as DB backup)
gpg --batch --yes --encrypt --recipient "${GPG_RECIPIENT}" \
  --output "${BACKUP_DIR}/${ENCRYPTED_NAME}" \
  "${BACKUP_DIR}/${ARCHIVE_NAME}"

# Remove unencrypted archive
rm -f "${BACKUP_DIR}/${ARCHIVE_NAME}"

echo "[$(date -Iseconds)] Backup created: ${BACKUP_DIR}/${ENCRYPTED_NAME}"

# Prune old backups beyond retention period
find "${BACKUP_DIR}" -name "n8n-backup-*.tar.gz.gpg" -mtime +"${RETENTION_DAYS}" -delete 2>/dev/null || true

REMAINING=$(find "${BACKUP_DIR}" -name "n8n-backup-*.tar.gz.gpg" | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] Backup complete. ${REMAINING} backup(s) retained."
