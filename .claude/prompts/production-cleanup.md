# Production Cleanup & Hardening

Handle the loose ends from v3.0 shipping — push unpushed commits, fix temporary credentials, and tighten up production config.

## Tasks

### 1. Push pending commits
- Verify 4 commits ahead of origin on `main`
- Review each commit with `git log --oneline origin/main..HEAD` to confirm they're all safe to push
- Push to origin (confirm with user first)

### 2. Fix NPM temporary password
- Current NPM proxy password is `TempNpm2026!` — needs a permanent password
- Coordinate with user on new password
- Update NPM Proxy Manager config on VPS
- Update any stored credentials or docs referencing the temp password

### 3. Verify VPS deployment health
- SSH to VPS and check all services are running: `docker compose ps`
- Verify agent-server responds: `curl https://api.aviontechs.com/health`
- Verify dashboard loads: `curl -I https://app.aviontechs.com/dashboard/`
- Check DB migrations are synced: compare local migration count vs VPS
- Review Docker logs for errors: `docker compose logs --tail=50`
- Check disk space and backup status

### 4. Security sweep
- Confirm `.env` is in `.gitignore` and not committed
- Verify API_SECRET is set in production
- Check rate limiting is active on VPS
- Confirm fail2ban is running
- Review UFW rules are correct
- Check SSL cert expiry dates via NPM

### 5. Documentation sync
- Ensure `.env.example` has all env vars currently in use
- Verify CLAUDE.md reflects actual project state
- Check that README (if any) is current

### 6. Commit any fixes
- Commit cleanup changes with descriptive message
- Push to origin
