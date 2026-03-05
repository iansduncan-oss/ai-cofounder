# AI Cofounder — Complete Remaining Infrastructure Setup

## Context

The AI Cofounder monorepo is deployed on a Hetzner VPS at `168.119.162.59`. The following services are live:

- **Agent Server** — https://api.aviontechs.com (Fastify, port 3100)
- **Discord Bot** — running, connected to agent-server
- **Grafana** — https://grafana.aviontechs.com (port 3200)
- **Prometheus** — localhost:9090
- **Alertmanager** — localhost:9093 (Discord webhook configured)

New compose files have been committed but NOT yet deployed:

- `docker-compose.n8n.yml` — n8n at n8n.aviontechs.com
- `docker-compose.uptimekuma.yml` — Uptime Kuma at status.aviontechs.com

Reverse proxy: **Nginx Proxy Manager (NPM)** — admin UI on port 8181 (SSH tunnel).
External Docker network: `avion_avion_net`
VPS project path: `/opt/ai-cofounder`
VPS IP: `168.119.162.59`

---

## Tasks to Complete

### 1. DNS Records

Create A records pointing to `168.119.162.59`:

- `n8n.aviontechs.com`
- `status.aviontechs.com`

Do this first so DNS propagates while we work on the rest.

### 2. GitHub Secret for Deploy Notifications

```bash
gh auth login
gh secret set DISCORD_DEPLOY_WEBHOOK_URL \
  -R <owner>/ai-cofounder \
  --body "$DISCORD_DEPLOY_WEBHOOK_URL"
```

### 3. VPS — Create n8n Database

SSH into the VPS and create the `n8n` database in PostgreSQL:

```bash
# If Postgres is a Docker container:
docker exec -it <postgres-container-name> psql -U ai_cofounder -d ai_cofounder -c "CREATE DATABASE n8n;"
docker exec -it <postgres-container-name> psql -U ai_cofounder -d ai_cofounder -c "GRANT ALL PRIVILEGES ON DATABASE n8n TO ai_cofounder;"

# If Postgres is installed on the host:
sudo -u postgres psql -c "CREATE DATABASE n8n;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE n8n TO ai_cofounder;"
```

### 4. VPS — Add n8n Environment Variables

Append to `/opt/ai-cofounder/.env`:

```bash
N8N_KEY=$(openssl rand -hex 32)
cat >> /opt/ai-cofounder/.env << EOF

# ── n8n ──────────────────────────────────────────────────────
N8N_ENCRYPTION_KEY=$N8N_KEY
N8N_DB_HOST=host.docker.internal
N8N_DB_USER=ai_cofounder
N8N_DB_PASSWORD=<same-password-as-DATABASE_URL>
EOF
```

**Note:** If PostgreSQL is a Docker container on `avion_avion_net`, use the container name instead of `host.docker.internal`.

### 5. VPS — Start n8n and Uptime Kuma

```bash
cd /opt/ai-cofounder
git pull origin main
docker compose -f docker-compose.n8n.yml up -d
docker compose -f docker-compose.uptimekuma.yml up -d

# Verify containers are running
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### 6. NPM Proxy Hosts

In Nginx Proxy Manager admin UI (SSH tunnel to port 8181), create two new proxy hosts:

**n8n:**

- Domain: `n8n.aviontechs.com`
- Scheme: `http`
- Forward Hostname: `ai-cofounder-n8n`
- Forward Port: `5678`
- SSL tab: Request a new SSL certificate, Force SSL, HTTP/2 Support

**Uptime Kuma:**

- Domain: `status.aviontechs.com`
- Scheme: `http`
- Forward Hostname: `ai-cofounder-uptime-kuma`
- Forward Port: `3001`
- SSL tab: Request a new SSL certificate, Force SSL, HTTP/2 Support

For n8n, add this to the Advanced tab (Custom Nginx Configuration) for WebSocket support:

```nginx
location / {
    proxy_pass http://ai-cofounder-n8n:5678;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
}
```

### 7. Docker Log Rotation

Create `/opt/ai-cofounder/daemon-log-config.json` or add logging config to all compose files.

Add to each service in every docker-compose file:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

Alternatively, set it globally in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart Docker: `sudo systemctl restart docker`

### 8. Automated PostgreSQL Backups

Create a backup script at `/opt/ai-cofounder/infra/backup-db.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/backups/postgres"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup ai_cofounder database
# Adjust the command depending on whether Postgres is Docker or host:
# Docker: docker exec <container> pg_dump -U ai_cofounder ai_cofounder
# Host:   sudo -u postgres pg_dump ai_cofounder
docker exec <postgres-container> pg_dump -U ai_cofounder ai_cofounder | gzip > "$BACKUP_DIR/ai_cofounder_$TIMESTAMP.sql.gz"
docker exec <postgres-container> pg_dump -U ai_cofounder n8n | gzip > "$BACKUP_DIR/n8n_$TIMESTAMP.sql.gz"

# Prune old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup complete: ai_cofounder_$TIMESTAMP.sql.gz, n8n_$TIMESTAMP.sql.gz"
```

Make executable and add cron job:

```bash
chmod +x /opt/ai-cofounder/infra/backup-db.sh

# Run nightly at 3 AM
crontab -e
# Add: 0 3 * * * /opt/ai-cofounder/infra/backup-db.sh >> /var/log/db-backup.log 2>&1
```

### 9. Firewall Hardening (UFW)

```bash
# Check current status
ufw status

# If not enabled, set up rules:
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS (for NPM)
ufw allow 80/tcp
ufw allow 443/tcp

# Allow NPM admin only from your IP (replace YOUR_IP)
# ufw allow from YOUR_IP to any port 8181

# Enable
ufw enable
ufw status verbose
```

### 10. fail2ban for SSH Protection

```bash
apt install -y fail2ban

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
```

### 11. Uptime Kuma Monitors

After Uptime Kuma is accessible at https://status.aviontechs.com:

1. Create admin account on first visit
2. Add these HTTP(s) monitors (60s interval):
   - `AI Cofounder API` → `https://api.aviontechs.com/health` — expect status 200
   - `Grafana` → `https://grafana.aviontechs.com` — expect status 200
   - `n8n` → `https://n8n.aviontechs.com` — expect status 200
   - `Status Page` → `https://status.aviontechs.com` — expect status 200 (self-check)
3. Create a Status Page → set slug to `/` → add all monitors → publish

### 12. Update CLAUDE.md

Add n8n, Uptime Kuma, and monitoring info to the project's CLAUDE.md so future sessions have context:

- n8n at https://n8n.aviontechs.com (docker-compose.n8n.yml)
- Uptime Kuma at https://status.aviontechs.com (docker-compose.uptimekuma.yml)
- Monitoring stack: Prometheus + Alertmanager + Grafana (docker-compose.monitoring.yml)
- NPM reverse proxy on port 8181 (SSH tunnel)
- Alertmanager sends to Discord webhook
- PostgreSQL nightly backups at /opt/backups/postgres (14-day retention)
- Docker log rotation configured globally

### 13. Reload Alertmanager Config on VPS

The alertmanager.yml now has the real Discord webhook URL. Restart to pick it up:

```bash
cd /opt/ai-cofounder
docker compose -f docker-compose.monitoring.yml restart alertmanager
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] `curl https://n8n.aviontechs.com` — n8n login/setup page loads
- [ ] `curl https://status.aviontechs.com` — Uptime Kuma status page loads
- [ ] `curl https://api.aviontechs.com/health` — returns `{"status":"ok"}`
- [ ] `curl https://grafana.aviontechs.com` — Grafana login page loads
- [ ] Alertmanager test: `curl -X POST http://localhost:9093/api/v1/alerts -d '[{"labels":{"alertname":"TestAlert","severity":"warning"},"annotations":{"summary":"Test alert"}}]'` — check Discord for notification
- [ ] `docker ps` — all containers running (agent-server, discord-bot, n8n, uptime-kuma, prometheus, alertmanager, grafana)
- [ ] `ufw status` — firewall active with correct rules
- [ ] `fail2ban-client status sshd` — fail2ban monitoring SSH
- [ ] `/opt/ai-cofounder/infra/backup-db.sh` — run manually once, check /opt/backups/postgres/
- [ ] Push a test commit to main → verify deploy workflow runs and Discord notification fires

## Post-Setup: Deploy the Discord Bot Changes

Once the other session's Discord bot work is done:

```bash
# Locally: commit all remaining changes, push
git add -A
git commit -m "feat: conversation persistence + discord user tracking"
git push origin main
# CI runs → deploy triggers automatically
```
