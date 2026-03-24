#!/bin/bash
# Deploy Mac automation scripts locally
# Run: ./infra/scripts/deploy-mac.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_SCRIPTS_DIR="${SCRIPT_DIR}/mac"
TARGET_DIR="$HOME/Scripts"
LOG_DIR="${TARGET_DIR}/logs"

echo "=== Deploying Mac automation scripts ==="

# Create directories
mkdir -p "$TARGET_DIR" "$LOG_DIR"

# Copy scripts
echo "Copying scripts to ${TARGET_DIR}..."
cp "${MAC_SCRIPTS_DIR}/common.sh" "$TARGET_DIR/"
cp "${MAC_SCRIPTS_DIR}/repo-digest.sh" "$TARGET_DIR/"
cp "${MAC_SCRIPTS_DIR}/github-security.sh" "$TARGET_DIR/"
cp "${MAC_SCRIPTS_DIR}/mac-maintenance.sh" "$TARGET_DIR/"

# Make executable
chmod +x "$TARGET_DIR"/*.sh

# Check if .env exists
if [[ ! -f "${TARGET_DIR}/.env" ]]; then
  echo ""
  echo "WARNING: No .env file found at ${TARGET_DIR}/.env"
  echo "Create it:"
  echo "  echo 'DISCORD_NOTIFICATION_WEBHOOK_URL=your_webhook_url' > ${TARGET_DIR}/.env"
  echo ""
fi

# Install crontab entries (merge with existing)
echo "Installing crontab entries..."
EXISTING=$(crontab -l 2>/dev/null | grep -v 'repo-digest\|github-security\|mac-maintenance' || true)

{
  echo "$EXISTING"
  echo ""
  echo "# === Mac Automation Scripts (managed by deploy-mac.sh) ==="
  echo "0 9 * * 1-5 ${TARGET_DIR}/repo-digest.sh >> ${LOG_DIR}/repo-digest.log 2>&1"
  echo "0 10 * * 1 ${TARGET_DIR}/github-security.sh >> ${LOG_DIR}/github-security.log 2>&1"
  echo "0 10 * * 0 ${TARGET_DIR}/mac-maintenance.sh >> ${LOG_DIR}/mac-maintenance.log 2>&1"
} | crontab -

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Installed crontab:"
crontab -l | grep -A1 'Mac Automation\|repo-digest\|github-security\|mac-maintenance'
echo ""
echo "Test scripts:"
echo "  ${TARGET_DIR}/repo-digest.sh"
echo "  ${TARGET_DIR}/github-security.sh"
echo "  ${TARGET_DIR}/mac-maintenance.sh"
