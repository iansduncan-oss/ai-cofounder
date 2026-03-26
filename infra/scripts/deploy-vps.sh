#!/bin/bash
# Deploy VPS automation scripts to the server
# Run from local machine: ./infra/scripts/deploy-vps.sh
set -euo pipefail

VPS_HOST="vps"  # SSH config alias
REMOTE_DIR="/opt/scripts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_SCRIPTS_DIR="${SCRIPT_DIR}/vps"

echo "=== Deploying VPS automation scripts ==="

# Create remote directories
echo "Creating directories on VPS..."
ssh "$VPS_HOST" "sudo mkdir -p ${REMOTE_DIR} /backups/ai-cofounder/latest /backups/n8n /var/log/automation"

# Copy scripts
echo "Copying scripts..."
ssh "$VPS_HOST" "mkdir -p /tmp/automation-scripts"
scp "${VPS_SCRIPTS_DIR}/common.sh" \
    "${VPS_SCRIPTS_DIR}/backup-db.sh" \
    "${VPS_SCRIPTS_DIR}/docker-cleanup.sh" \
    "${VPS_SCRIPTS_DIR}/check-ssl.sh" \
    "${VPS_SCRIPTS_DIR}/daily-status.sh" \
    "${VPS_SCRIPTS_DIR}/cost-tracker.sh" \
    "${VPS_SCRIPTS_DIR}/stale-branch-cleaner.sh" \
    "${VPS_SCRIPTS_DIR}/log-rotation.sh" \
    "${VPS_SCRIPTS_DIR}/disk-monitor.sh" \
    "${VPS_SCRIPTS_DIR}/container-health.sh" \
    "${VPS_SCRIPTS_DIR}/backup-verify.sh" \
    "${VPS_SCRIPTS_DIR}/cron-verify.sh" \
    "${VPS_HOST}:/tmp/automation-scripts/"

ssh "$VPS_HOST" "sudo mv /tmp/automation-scripts/* ${REMOTE_DIR}/ && rmdir /tmp/automation-scripts"

# Make executable
echo "Setting permissions..."
ssh "$VPS_HOST" "sudo chmod +x ${REMOTE_DIR}/*.sh"

# Check if .env exists, create from example if not
ssh "$VPS_HOST" "test -f ${REMOTE_DIR}/.env" || {
  echo ""
  echo "WARNING: No .env file found on VPS at ${REMOTE_DIR}/.env"
  echo "Create it manually:"
  echo "  ssh ${VPS_HOST} 'sudo tee ${REMOTE_DIR}/.env <<< \"DISCORD_NOTIFICATION_WEBHOOK_URL=your_webhook_url\"'"
  echo ""
}

# Install crontab entries (merge with existing, replace old backup entry)
echo "Installing crontab entries..."
ssh "$VPS_HOST" 'bash -s' << 'CRON_SCRIPT'
# Get existing crontab, remove old backup entries
EXISTING=$(sudo crontab -l 2>/dev/null | grep -v 'backup-db\|docker-cleanup\|check-ssl\|daily-status\|cost-tracker\|stale-branch-cleaner\|log-rotation\|disk-monitor\|container-health\|backup-verify\|cron-verify' || true)

# Write new crontab
{
  echo "$EXISTING"
  echo ""
  echo "# === Automation Scripts (managed by deploy-vps.sh) ==="
  echo "0 2 * * * /opt/scripts/backup-db.sh >> /var/log/automation/backup-db.log 2>&1"
  echo "0 3 * * 0 /opt/scripts/docker-cleanup.sh >> /var/log/automation/docker-cleanup.log 2>&1"
  echo "0 8 * * * /opt/scripts/check-ssl.sh >> /var/log/automation/check-ssl.log 2>&1"
  echo "0 7 * * * /opt/scripts/daily-status.sh >> /var/log/automation/daily-status.log 2>&1"
  echo "0 20 * * * /opt/scripts/cost-tracker.sh >> /var/log/automation/cost-tracker.log 2>&1"
  echo "30 3 * * 0 /opt/scripts/stale-branch-cleaner.sh >> /var/log/automation/stale-branch-cleaner.log 2>&1"
  echo "45 3 * * * /opt/scripts/log-rotation.sh >> /var/log/automation/log-rotation.log 2>&1"
  echo "0 */6 * * * /opt/scripts/disk-monitor.sh >> /var/log/automation/disk-monitor.log 2>&1"
  echo "*/30 * * * * /opt/scripts/container-health.sh >> /var/log/automation/container-health.log 2>&1"
  echo "0 4 * * 0 /opt/scripts/backup-verify.sh >> /var/log/automation/backup-verify.log 2>&1"
  echo "0 6 * * 1 /opt/scripts/cron-verify.sh >> /var/log/automation/cron-verify.log 2>&1"
} | sudo crontab -
CRON_SCRIPT

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Installed crontab:"
ssh "$VPS_HOST" "sudo crontab -l | grep -A1 'Automation\|backup-db\|docker-cleanup\|check-ssl\|daily-status\|cost-tracker\|stale-branch-cleaner\|log-rotation\|disk-monitor\|container-health\|backup-verify\|cron-verify'"
echo ""
echo "To run backup manually:     ssh ${VPS_HOST} 'sudo /opt/scripts/backup-db.sh'"
echo "To run status manually:     ssh ${VPS_HOST} 'sudo /opt/scripts/daily-status.sh'"
echo "To run cost report:         ssh ${VPS_HOST} 'sudo /opt/scripts/cost-tracker.sh'"
echo "To verify symlink:          ssh ${VPS_HOST} 'ls -la /backups/ai-cofounder/latest/db.dump'"
