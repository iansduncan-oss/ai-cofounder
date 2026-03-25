# Remaining Setup — Manual Tasks

## 1. Uptime Kuma Monitors

Go to **https://status.aviontechs.com** — create an admin account if first visit.

Click "Add New Monitor" for each:

### HTTP Monitors

| Name | URL | Type | Keyword | Interval |
|------|-----|------|---------|----------|
| AI Cofounder API | `https://api.aviontechs.com/health` | HTTP(s) - Keyword | `"status"` | 60s |
| AI Cofounder Deep Health | `https://api.aviontechs.com/health/deep` | HTTP(s) - Keyword | `"ok"` | 60s |
| Dashboard | `https://app.aviontechs.com/dashboard/` | HTTP(s) | 200 | 60s |
| n8n | `https://n8n.aviontechs.com` | HTTP(s) | 200 | 60s |
| Grafana | `https://grafana.aviontechs.com` | HTTP(s) | 200 | 60s |
| Status Page | `https://status.aviontechs.com` | HTTP(s) | 200 | 60s |

### Internal TCP Monitors (same Docker network)

| Name | Host | Port | Type | Interval |
|------|------|------|------|----------|
| Redis | `redis` | 6379 | TCP | 60s |
| PostgreSQL | `avion-postgres-1` | 5432 | TCP | 60s |

> These only work if Uptime Kuma is on the `avion_avion_net` Docker network.

### Create a Public Status Page

1. Click "Status Pages" in the left sidebar
2. Click "New Status Page"
3. Set Name: `Avion Technologies`
4. Set Slug: `/`
5. Add all monitors to the page
6. Click "Save" and "Publish"

### Verification

After setup, all monitors should show green. The public status page at https://status.aviontechs.com should display all services.

## 2. Postgres Exporter Password

The `postgres-exporter` service in `docker-compose.monitoring.yml` needs `POSTGRES_PASSWORD` set in `.env` on VPS:

```bash
ssh vps 'grep POSTGRES_PASSWORD /opt/ai-cofounder/.env'
```

## 3. Alertmanager Discord Adapter

The `alertmanager-discord` container uses `ALERTMANAGER_DISCORD_WEBHOOK_URL` from `.env`. Verify after deploy:

```bash
ssh vps 'sudo docker ps | grep alertmanager-discord'
```
