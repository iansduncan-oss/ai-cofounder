# Backup & Restore

## What's Backed Up

| Item | Method | Schedule | Destination |
| --- | --- | --- | --- |
| PostgreSQL database | `pg_dump` | Nightly | Local `/backups/` + Hetzner Storage Box |
| `.env` files | rsync | Nightly | Hetzner Storage Box |
| Docker Compose configs | rsync | Nightly | Hetzner Storage Box |

## Schedule

- **Nightly** at 02:00 UTC via cron on VPS
- **Retention**: 7 days local, 30 days on Storage Box
- **Method**: rsync with `--delete` for rotation

## Destinations

- **Local**: `/backups/ai-cofounder/` on VPS
- **Offsite**: Hetzner Storage Box (BX11) via SSH/rsync

## Verification

1. Check latest backup timestamp: `ls -la /backups/ai-cofounder/`
2. Verify DB dump integrity: `pg_restore --list /backups/ai-cofounder/latest/db.dump`
3. Prometheus metric: `backup_last_success_timestamp` gauge (alert if > 36h stale)

## Restore Procedure

### Full Restore

```bash
# 1. SSH to VPS
ssh vps

# 2. Stop services
sudo docker compose -f docker-compose.prod.yml down

# 3. Restore database
sudo docker exec -i postgres pg_restore -U postgres -d ai_cofounder --clean < /backups/ai-cofounder/latest/db.dump

# 4. Restore env files (if needed)
cp /backups/ai-cofounder/latest/.env /opt/ai-cofounder/.env

# 5. Restart services
sudo docker compose -f docker-compose.prod.yml up -d

# 6. Verify health
curl -s http://localhost:3100/health/deep | python3 -m json.tool
```

### Partial Restore (single table)

```bash
pg_restore -U postgres -d ai_cofounder --table=<table_name> /backups/ai-cofounder/latest/db.dump
```

## Monitoring

- `backup_last_success_timestamp` Prometheus gauge updated after successful backup
- `BackupStale` alert fires if no successful backup in 36 hours
