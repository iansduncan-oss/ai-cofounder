# Remaining Setup — Task 11: Uptime Kuma Monitors

Everything else is done. This is the only manual task left.

## Go to https://status.aviontechs.com

If this is your first visit, create an admin account.

## Add These Monitors

Click "Add New Monitor" for each:

### 1. AI Cofounder API

- Monitor Type: HTTP(s)
- Friendly Name: `AI Cofounder API`
- URL: `https://api.aviontechs.com/health`
- Heartbeat Interval: `60`
- Expected Status Code: `200`

### 2. Grafana

- Monitor Type: HTTP(s)
- Friendly Name: `Grafana`
- URL: `https://grafana.aviontechs.com`
- Heartbeat Interval: `60`
- Expected Status Code: `200`

### 3. n8n

- Monitor Type: HTTP(s)
- Friendly Name: `n8n`
- URL: `https://n8n.aviontechs.com`
- Heartbeat Interval: `60`
- Expected Status Code: `200`

### 4. Status Page (self-check)

- Monitor Type: HTTP(s)
- Friendly Name: `Status Page`
- URL: `https://status.aviontechs.com`
- Heartbeat Interval: `60`
- Expected Status Code: `200`

## Create a Public Status Page

1. Click "Status Pages" in the left sidebar
2. Click "New Status Page"
3. Set Name: `Avion Technologies`
4. Set Slug: `/`
5. Add all 4 monitors to the page
6. Click "Save" and "Publish"

## Verification

After setup, all 4 monitors should show green. The public status page at https://status.aviontechs.com should display all services.
