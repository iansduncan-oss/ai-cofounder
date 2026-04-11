# Authentik SSO Deployment Runbook

This directory is a **plan**, not a deployed service. When you're ready to turn on
SSO in front of the aviontechs stack, follow the steps below on the Hetzner VPS
(`ssh vps`, working dir `/opt/ai-cofounder`).

**Blast radius:** high. Mistakes can lock you out of your own dashboards. Do all
of this during a low-traffic window and keep an SSH session open as an escape
hatch.

---

## 0. Prerequisites

- `avion_avion_net` Docker network already exists on the VPS (it does — that's
  the network monitoring + ai-cofounder share).
- DNS A record `auth.aviontechs.com` → VPS IP, already created in Cloudflare (or
  wherever).
- TLS cert for `auth.aviontechs.com` issued by Nginx Proxy Manager. Easiest: add
  the Proxy Host first with a "dummy" upstream, let NPM pull a Let's Encrypt
  cert, then change the upstream in step 4.
- `openssl`, `docker`, `docker compose` on the VPS.
- ~1.5 GB free RAM. The four Authentik containers together budget for ~2 GB hard
  limit but typically sit at ~600 MB.

Keep an **open SSH session** during the cutover. If you lock yourself out of a
browser-facing service, you can always fix config via SSH.

---

## 1. Generate secrets

```bash
cd /opt/ai-cofounder/infra/authentik
cp .env.example .env

# Populate .env with:
echo "AUTHENTIK_SECRET_KEY=$(openssl rand -base64 60 | tr -d '\n')"          >> .env
echo "AUTHENTIK_POSTGRES_PASSWORD=$(openssl rand -hex 32)"                    >> .env
echo "AUTHENTIK_BOOTSTRAP_PASSWORD=$(openssl rand -base64 24 | tr -d '=')"    >> .env
echo "AUTHENTIK_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)"                      >> .env

# Edit .env and set AUTHENTIK_BOOTSTRAP_EMAIL to your real email.
# (Also fill in SMTP vars if you want password resets via email.)

# Stash a copy of the bootstrap password in Vaultwarden/1Password BEFORE
# you continue. You'll need it for the first login.
```

Then mirror the three secret values into `/opt/ai-cofounder/.env` so Docker
Compose picks them up for all projects that share that env file:

```bash
cat /opt/ai-cofounder/infra/authentik/.env | grep AUTHENTIK_ >> /opt/ai-cofounder/.env
```

---

## 2. First boot

```bash
cd /opt/ai-cofounder
docker compose -f infra/authentik/docker-compose.yml --env-file .env up -d

# Watch for "Welcome" and "migrations complete" in the server log.
docker compose -f infra/authentik/docker-compose.yml logs -f authentik-server
```

First boot will:

1. Start Postgres + Redis.
2. Run Authentik DB migrations.
3. Apply the blueprint in `./blueprints/` (creates groups, providers, apps,
   and the proxy outpost).
4. Create the bootstrap user with the email + password from `.env`.

Healthcheck: `curl -I http://127.0.0.1:9000/-/health/live/` → `200 OK` within
~60s.

---

## 3. First login + lock down bootstrap

1. Add a temporary Nginx Proxy Manager proxy host:
   - Domain: `auth.aviontechs.com`
   - Forward Hostname/IP: `authentik-server`
   - Forward Port: `9000`
   - Scheme: `http`
   - Websockets Support: **on**
   - SSL: Request a new Let's Encrypt cert, force SSL
2. Visit `https://auth.aviontechs.com/if/admin/`. Log in with the bootstrap
   email + password from step 1.
3. In the admin UI:
   - Create your **real admin user** (Users → Create → add to
     `aviontechs-admins` group).
   - Enroll TOTP on the real admin user (User settings → MFA → Add
     authenticator).
   - Log out, log in as the real admin to prove it works.
   - Disable the bootstrap user (Users → select bootstrap → Deactivate).
4. Clear `AUTHENTIK_BOOTSTRAP_PASSWORD` and `AUTHENTIK_BOOTSTRAP_TOKEN` from
   `.env` and `/opt/ai-cofounder/.env`. Authentik only reads them when the DB is
   empty, so leaving them is harmless but noisy. Restart `authentik-server` to
   pick up the change.

---

## 4. Wire a first application (Grafana) behind forward-auth

This is the lowest-risk integration to test end-to-end. Grafana already has its
own auth, so the worst failure mode is "Grafana goes back to its built-in
login" — you're not locked out.

1. Authentik admin → Outposts → `aviontechs-proxy-outpost` should already
   exist from the blueprint. Confirm it's healthy (green dot).
2. NPM → Proxy Hosts → `grafana.aviontechs.com` → **Advanced** tab. Add:
   ```nginx
   location / {
     auth_request /outpost.goauthentik.io/auth/nginx;
     error_page 401 = @goauthentik_proxy_signin;
     auth_request_set $authentik_username $upstream_http_x_authentik_username;
     auth_request_set $authentik_groups $upstream_http_x_authentik_groups;
     proxy_set_header X-Authentik-Username $authentik_username;
     proxy_set_header X-Authentik-Groups $authentik_groups;
     proxy_pass http://grafana:3000;
   }
   location /outpost.goauthentik.io {
     proxy_pass http://authentik-server:9000/outpost.goauthentik.io;
     proxy_set_header Host $host;
     proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
     add_header Set-Cookie $auth_cookie;
     auth_request_set $auth_cookie $upstream_http_set_cookie;
     proxy_pass_request_body off;
     proxy_set_header Content-Length "";
   }
   location @goauthentik_proxy_signin {
     internal;
     add_header Set-Cookie $auth_cookie;
     return 302 /outpost.goauthentik.io/start?rd=$request_uri;
   }
   ```
3. In Grafana, configure **Auth Proxy** with `X-Authentik-Username` as the
   header and `main` as the default org:
   ```ini
   # grafana.ini
   [auth.proxy]
   enabled = true
   header_name = X-Authentik-Username
   header_property = username
   auto_sign_up = true
   headers = Groups:X-Authentik-Groups
   ```
   Restart Grafana. Visit `https://grafana.aviontechs.com` → should bounce you
   to Authentik → log in → land on the Grafana home page as your Authentik
   user.

**Validation checklist:**

- [ ] Visiting grafana.aviontechs.com in a fresh incognito window bounces to
      auth.aviontechs.com.
- [ ] After login, you land back on Grafana with your Authentik username.
- [ ] Logging out of Authentik kicks you out of Grafana within 5 minutes.
- [ ] `/api/health` on Grafana still works without auth (add a `location
    = /api/health { auth_request off; proxy_pass http://grafana:3000; }`
      block before the catch-all — required for the internal healthcheck).

If anything misbehaves, **immediately revert the NPM Advanced config** and
Grafana falls back to its built-in login.

---

## 5. Roll out to remaining apps

Repeat step 4 for each of:

| App                                | Proxy Host                 | Recommended order                                                |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| Uptime Kuma                        | `status.aviontechs.com`    | 1st — low-stakes read-only                                       |
| n8n                                | `n8n.aviontechs.com`       | 2nd — disable n8n built-in basic auth after cutover              |
| NPM admin UI                       | `npm.aviontechs.com`       | 3rd — **do this last**, and only if you have an SSH escape hatch |
| Dashboard (OIDC, not forward-auth) | `dashboard.aviontechs.com` | Separate flow — see step 6                                       |

For each, the blueprint has already created the Application entry. You just
need to paste the NPM Advanced block (swap `grafana:3000` → correct upstream).

---

## 6. Dashboard via OIDC (not forward-auth)

The ai-cofounder dashboard already has its own JWT auth, so wire Authentik as
an **OIDC provider** instead of forward-auth:

1. Authentik admin → Providers → `dashboard-oidc` → copy **Client ID** and
   **Client Secret**.
2. Add to `/opt/ai-cofounder/.env`:
   ```
   OIDC_ISSUER_URL=https://auth.aviontechs.com/application/o/dashboard/
   OIDC_CLIENT_ID=<copied>
   OIDC_CLIENT_SECRET=<copied>
   OIDC_REDIRECT_URI=https://dashboard.aviontechs.com/auth/callback
   ```
3. Implement the OIDC callback handler in `apps/agent-server/src/routes/auth.ts`
   (openid-client library). **This is a code change, not config — it belongs
   in a separate PR.**
4. Keep the existing email/password login as a fallback so you don't lose
   access if Authentik is down.

---

## 7. Rollback

Everything is reversible:

```bash
# Full teardown (preserves data volumes — just stops containers)
docker compose -f infra/authentik/docker-compose.yml down

# Full wipe (destroys all users, apps, config)
docker compose -f infra/authentik/docker-compose.yml down -v

# Partial: remove the NPM Advanced config for one service and that
# service falls back to its native auth immediately.
```

Authentik is stateless from ai-cofounder's perspective — nothing in
ai-cofounder stores Authentik state. Taking Authentik offline only breaks
whichever services have the NPM Advanced block pointed at it.

---

## 8. Monitoring + backup

- Point Uptime Kuma at `https://auth.aviontechs.com/-/health/live/` — alert on
  non-200.
- Add `authentik_postgres_data` to the existing Restic backup job:
  ```bash
  # /opt/restic/backup.sh
  restic backup /var/lib/docker/volumes/ai-cofounder-authentik_authentik_postgres_data
  ```
- Authentik logs are JSON by default — forward via the existing Docker log
  driver. Prometheus metrics are at `http://authentik-server:9300/metrics`
  (scrape from the monitoring stack; add a `job_name: authentik` block to
  `infra/monitoring/prometheus/prometheus.yml`).

---

## 9. Upgrade policy

Authentik ships breaking changes occasionally. Before bumping the image tag:

1. Read the [release notes](https://docs.goauthentik.io/docs/releases/) for
   every version between current and target.
2. Run the new version against a **staging copy** of the Postgres volume
   first if the release notes mention schema migrations.
3. Never skip more than one minor version.

Pin to `2025.2.1` in docker-compose.yml until you're ready to upgrade.
