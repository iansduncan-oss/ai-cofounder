#!/bin/bash
set -euo pipefail

# =============================================================
# AI Cofounder — VPS Setup Script
# Handles tasks 3, 4, 7, 8, 9, 10, 13 from SETUP-COMPLETION-PROMPT.md
#
# Run on VPS as root:
#   chmod +x /opt/ai-cofounder/infra/vps-setup.sh
#   /opt/ai-cofounder/infra/vps-setup.sh
# =============================================================

PROJECT_DIR="/opt/ai-cofounder"
PG_CONTAINER="avion-postgres-1"
ENV_FILE="$PROJECT_DIR/.env"
BACKUP_DIR="/opt/backups/postgres"

echo "========================================="
echo "  AI Cofounder VPS Setup"
echo "========================================="
echo ""

# ── Task 3: Create n8n database ──────────────────────────
echo "[Task 3] Creating n8n database..."
if docker exec "$PG_CONTAINER" psql -U avion -d avion -tc "SELECT 1 FROM pg_database WHERE datname = 'n8n'" | grep -q 1; then
  echo "  → n8n database already exists, skipping."
else
  docker exec "$PG_CONTAINER" psql -U avion -d avion -c "CREATE DATABASE n8n;"
  docker exec "$PG_CONTAINER" psql -U avion -d avion -c "GRANT ALL PRIVILEGES ON DATABASE n8n TO avion;"
  echo "  → n8n database created."
fi
echo ""

# ── Task 4: Add n8n env vars ─────────────────────────────
echo "[Task 4] Adding n8n environment variables..."
if grep -q "N8N_ENCRYPTION_KEY" "$ENV_FILE" 2>/dev/null; then
  echo "  → n8n env vars already present, skipping."
else
  N8N_KEY=$(openssl rand -hex 32)

  cat >> "$ENV_FILE" << EOF

# ── n8n ──────────────────────────────────────────────────
N8N_ENCRYPTION_KEY=$N8N_KEY
N8N_DB_HOST=$PG_CONTAINER
N8N_DB_USER=avion
N8N_DB_PASSWORD=REDACTED_PASSWORD
EOF
  echo "  → Added N8N_ENCRYPTION_KEY, N8N_DB_HOST, N8N_DB_USER, N8N_DB_PASSWORD"
fi
echo ""

# ── Task 7: Docker log rotation ──────────────────────────
echo "[Task 7] Configuring Docker log rotation..."
DAEMON_JSON="/etc/docker/daemon.json"
if [ -f "$DAEMON_JSON" ] && grep -q "max-size" "$DAEMON_JSON"; then
  echo "  → Log rotation already configured, skipping."
else
  mkdir -p /etc/docker
  cat > "$DAEMON_JSON" << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
  echo "  → Written $DAEMON_JSON. Docker restart needed (will do at end)."
  RESTART_DOCKER=1
fi
echo ""

# ── Task 8: Backup script ────────────────────────────────
echo "[Task 8] Setting up PostgreSQL backups..."
BACKUP_SCRIPT="$PROJECT_DIR/infra/backup-db.sh"
mkdir -p "$BACKUP_DIR"
cat > "$BACKUP_SCRIPT" << 'SCRIPT'
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/backups/postgres"
PG_CONTAINER="avion-postgres-1"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

docker exec "$PG_CONTAINER" pg_dump -U avion avion | gzip > "$BACKUP_DIR/avion_$TIMESTAMP.sql.gz"
docker exec "$PG_CONTAINER" pg_dump -U avion n8n | gzip > "$BACKUP_DIR/n8n_$TIMESTAMP.sql.gz"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup complete: ai_cofounder_$TIMESTAMP.sql.gz, n8n_$TIMESTAMP.sql.gz"
SCRIPT
chmod +x "$BACKUP_SCRIPT"

# Add cron job if not already present
if crontab -l 2>/dev/null | grep -q "backup-db.sh"; then
  echo "  → Cron job already exists, skipping."
else
  (crontab -l 2>/dev/null; echo "0 3 * * * $BACKUP_SCRIPT >> /var/log/db-backup.log 2>&1") | crontab -
  echo "  → Cron job added: nightly at 3 AM."
fi
echo "  → Backup script at $BACKUP_SCRIPT"
echo ""

# ── Task 9: UFW firewall ─────────────────────────────────
echo "[Task 9] Configuring UFW firewall..."
if ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "  → UFW already active."
  ufw status numbered
else
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "y" | ufw enable
  echo "  → UFW enabled: 22, 80, 443 open."
fi
echo ""

# ── Task 10: fail2ban ────────────────────────────────────
echo "[Task 10] Setting up fail2ban..."
if systemctl is-active --quiet fail2ban 2>/dev/null; then
  echo "  → fail2ban already running."
else
  apt-get update -qq && apt-get install -y -qq fail2ban
  cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
  echo "  → fail2ban installed and running."
fi
echo ""

# ── Task 5: Skipped — n8n and Uptime Kuma already running ─
echo "[Task 5] n8n and Uptime Kuma already running, skipping."
echo ""

# ── Task 13: Reload Alertmanager ─────────────────────────
echo "[Task 13] Restarting Alertmanager..."
docker compose -f docker-compose.monitoring.yml restart alertmanager
echo ""

# ── Restart Docker if daemon.json was changed ────────────
if [ "${RESTART_DOCKER:-0}" = "1" ]; then
  echo "[Task 7] Restarting Docker daemon for log rotation..."
  systemctl restart docker
  echo "  → Docker restarted. Containers will auto-restart (unless-stopped policy)."
  echo ""
fi

# ── Final status ─────────────────────────────────────────
echo "========================================="
echo "  Setup complete! Container status:"
echo "========================================="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "Remaining manual tasks:"
echo "  1. DNS A records → n8n.aviontechs.com, status.aviontechs.com → 168.119.162.59"
echo "  2. GitHub secret → DISCORD_DEPLOY_WEBHOOK_URL"
echo "  6. NPM proxy hosts → n8n + uptime-kuma (see setup prompt)"
echo " 11. Uptime Kuma monitors → create in UI at https://status.aviontechs.com"
