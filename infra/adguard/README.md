# AdGuard Home + Unbound Deployment Runbook

Recursive, validating, ad-blocking DNS for the homelab. AdGuard does the
blocking and admin UI; Unbound does the actual DNS lookups by talking
directly to the root servers, so your queries never pass through a third
party.

**Blast radius:** high and **sticky**. DNS misconfig doesn't just break the
service you were touching — it breaks every device that points at this
resolver, and breaks them for as long as the TTL says. **Schedule this
for a quiet window and keep a second resolver (1.1.1.1) configured on
your main workstation as an escape hatch until you're confident.**

---

## 0. What this gives you

- One DNS server for every device on your Tailscale tailnet (phone,
  laptop, homelab services).
- Network-wide blocking of tracker + ad domains via AdGuard's filter
  lists. Toggle per-client.
- Zero reliance on Cloudflare/Google/ISP DNS — Unbound talks to the
  root servers directly with DNSSEC validation.
- Local A records for `*.avion.internal` hostnames (via
  `unbound/a-records.conf`), so you can point Tailscale-only services
  at memorable names without touching public DNS.

## 0.1 What this does NOT replace

- **Public DNS for aviontechs.com.** Cloudflare still hosts the
  authoritative zone for `*.aviontechs.com`. AdGuard is a _recursive
  resolver_ for your clients, not an authoritative nameserver.
- **Router DHCP.** Clients still get their IP + default gateway from
  the router. Only the DNS server setting changes.

---

## 1. Prerequisites

- VPS has Tailscale installed and up. Run `tailscale ip -4` to get the
  VPS's tailnet IP — you'll bind DNS to this interface only so the
  public internet cannot query you.
- UFW allows 53/tcp + 53/udp **only on the Tailscale interface**. If
  unsure, run:
  ```bash
  sudo ufw allow in on tailscale0 to any port 53 proto udp
  sudo ufw allow in on tailscale0 to any port 53 proto tcp
  sudo ufw reload
  ```
  Double-check that 53 is **not** open on `eth0` — being an open
  recursive resolver on the public internet will get you DDoS'd and
  potentially abuse-blacklisted within hours.
- No other container is already listening on 53. On the aviontechs VPS,
  nothing is (Uptime Kuma / Grafana / n8n don't use DNS ports).

---

## 2. First boot

```bash
cd /opt/ai-cofounder/infra/adguard
cp .env.example .env
# Edit .env: set TAILSCALE_IP to the value from `tailscale ip -4`

docker compose --env-file .env up -d

# Watch Unbound come up first (takes ~5s for the DNSSEC trust anchor)
docker compose logs -f unbound
# Then AdGuard
docker compose logs -f adguard
```

Expected log lines:

- Unbound: `generate keytag query _ta-4f66`, `info: start of service`
- AdGuard: `Initialize: opening file`, `Init: initial listener: udp://...`

---

## 3. Initial AdGuard setup wizard

1. SSH tunnel to the admin UI: `ssh -L 3000:127.0.0.1:3002 vps`
2. Open `http://127.0.0.1:3000/` on your laptop.
3. Wizard:
   - **Web interface:** listen on all interfaces, port `3000`.
     (The compose file maps `3400` and `3002` → `3000`. Port 3100 is
     taken by agent-server, 3001 by Uptime Kuma.)
   - **DNS server:** listen on all interfaces, port `53`.
   - **Admin user:** pick a strong password. Stash it in
     Vaultwarden/1Password now.
4. After the wizard finishes, **AdGuard will restart** and the setup
   UI on `:3002` becomes unreachable. The working UI is on `:3400`
   (SSH tunnel: `ssh -L 3400:127.0.0.1:3400 vps`).

---

## 4. Point AdGuard at Unbound

AdGuard admin UI → Settings → DNS settings:

- **Upstream DNS servers:** clear everything, then add exactly one line:
  ```
  [/.] 172.20.0.2:5335
  ```
  Where `172.20.0.2` is the IP Unbound got on the `adguard_internal`
  network. Find it with `docker inspect unbound | jq '.[].NetworkSettings.Networks'`
  or use the alias: `[/.] unbound:5335` (alias works because we
  defined one in the compose file).
- **Bootstrap DNS:** `9.9.9.9` (only used once at AdGuard startup to
  resolve the Unbound hostname — can also leave blank since we use an
  internal alias).
- **Private reverse DNS:** leave defaults.
- **Enable DNSSEC:** on.
- Click **Test upstreams** — should show ✅ for `unbound:5335`.
- **Apply**.

Then Settings → Filters → DNS blocklists → enable at minimum:

- AdGuard DNS filter
- AdAway Default Blocklist
- Peter Lowe's Blocklist

Optional: enable the "Malware Domain List" and "Phishing Army" lists
for extra protection.

---

## 5. Validate before cutover

On the VPS itself (not your laptop yet):

```bash
# Should return ads.doubleclick.net → 0.0.0.0 (blocked by AdGuard)
docker exec adguard dig @127.0.0.1 -p 53 ads.doubleclick.net

# Should return a real A record with AD flag set (DNSSEC validated)
docker exec adguard dig @127.0.0.1 -p 53 cloudflare.com +dnssec | grep 'flags:'
# Expected:  ;; flags: qr rd ra ad; QUERY: 1, ...
#                              ^^ "ad" = authenticated

# Response time from a cold cache should be <200ms
time docker exec adguard dig @127.0.0.1 -p 53 github.com > /dev/null
```

From your laptop over Tailscale:

```bash
dig @${TAILSCALE_IP} cloudflare.com
```

Must return a real IP in <500ms. If not, **stop** — don't move on to
step 6.

---

## 6. Cutover

This is the moment of highest risk. Do it in this exact order:

1. **Laptop first.** Manually set DNS on your laptop to the VPS
   tailnet IP. On macOS: System Settings → Network → Wi-Fi → Details →
   DNS → add `${TAILSCALE_IP}`, move it above the automatic entries.
2. Browse for 10 minutes. Watch the AdGuard admin UI Query Log — you
   should see your requests flowing in and block counts ticking up.
3. If everything works, **cut over one device at a time**: phone next,
   then other laptops.
4. Do **not** set Tailscale-wide DNS yet (tailnet admin → DNS →
   Nameservers). That would push it to every device at once. Wait 24h
   after the per-device cutover to make sure AdGuard stays up.
5. After 24h of clean operation, go to the Tailscale admin console →
   **DNS → Nameservers → Override local DNS → add `${TAILSCALE_IP}`**.
   This pushes the config to every device in the tailnet.

**Escape hatches during cutover:**

- On macOS: delete the DNS entry in Network settings. Falls back to
  DHCP-provided DNS instantly.
- On Tailscale: disable "Override local DNS" in the admin console.
  Clients revert within ~1 min.
- On AdGuard itself: `docker compose stop adguard` — clients fall back
  to the next DNS server in their list (always have a secondary!).

---

## 7. Rollback

```bash
# Stop but keep data (filter lists, query log, client stats)
docker compose down

# Full wipe
docker compose down -v
```

After stopping, any client still pointed at the tailnet IP will
**lose DNS entirely**. Either:

- Revert the Tailscale "Override local DNS" setting (fastest — clients
  fall back in ~1 min), OR
- Remove the manual DNS entry on each device.

---

## 8. Monitoring

- Uptime Kuma → add a DNS monitor:
  - Hostname: `${TAILSCALE_IP}`
  - Resolver type: DNS
  - Query type: A
  - Record: `cloudflare.com`
  - Expected: non-empty answer
  - Interval: 60s
- Prometheus: AdGuard has a Prometheus endpoint at
  `http://adguard:3000/api/stats` (JSON, not OpenMetrics — use
  `prometheus-aggregator` or write a tiny sidecar exporter if you want
  it scraped).
- Log level stays at 0 (Unbound) and "info" (AdGuard). Both log to
  stdout — existing Docker log rotation handles them.

## 9. Backup

Add to the existing Restic backup job:

```bash
# /opt/restic/backup.sh
restic backup \
  /var/lib/docker/volumes/ai-cofounder-adguard_adguard_conf \
  /var/lib/docker/volumes/ai-cofounder-adguard_adguard_work
```

`unbound_data` is just the auto-updating root trust anchor — safe to
skip from backups; it'll regenerate on first boot.

## 10. Ongoing gotchas

- **Client identification.** AdGuard uses source IP to identify
  clients. Over Tailscale, every device gets a stable tailnet IP, so
  you can name clients in the admin UI (Settings → Client settings).
- **Per-client blocking.** Once clients are named, you can turn off
  ad-blocking per client (e.g. if a kid's game needs tracker pings to
  not crash).
- **Filter list updates.** AdGuard auto-updates them every 24h by
  default. No action needed.
- **Unbound root trust anchor.** Also auto-updates (RFC 5011). Check
  the log once a month for errors.
- **Cache poisoning.** Unbound's cache can grow unbounded over weeks.
  Restart unbound container monthly if you notice RAM creeping:
  ```bash
  docker compose restart unbound
  ```
