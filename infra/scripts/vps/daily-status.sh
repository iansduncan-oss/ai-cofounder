#!/bin/bash
# Daily system status reporter
# Curls agent-server health + monitoring endpoints and posts Discord embed
# Runs daily at 7 AM via cron
#
# Cron: 0 7 * * * /opt/scripts/daily-status.sh >> /var/log/automation/daily-status.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

API_BASE="http://localhost:3100"

log "Starting daily status report..."

# Fetch health and monitoring data
# Localhost requests bypass JWT auth in the agent-server
HEALTH=$(curl -sf --max-time 10 "${API_BASE}/health/full" 2>/dev/null)
MONITORING=$(curl -sf --max-time 15 "${API_BASE}/api/monitoring/status" 2>/dev/null || true)

if [[ -z "$HEALTH" ]]; then
  notify_discord \
    "Daily Status: Agent Server Unreachable" \
    "Could not reach agent-server at ${API_BASE}/health/full" \
    "$COLOR_RED"
  log_error "Agent server unreachable"
  exit 1
fi

# Write JSON to temp files for python
HEALTH_FILE=$(mktemp)
MONITORING_FILE=$(mktemp)
trap 'rm -f "$HEALTH_FILE" "$MONITORING_FILE"' EXIT

echo "$HEALTH" > "$HEALTH_FILE"
echo "$MONITORING" > "$MONITORING_FILE"

# Parse and format with python3
RESULT=$(python3 - "$HEALTH_FILE" "$MONITORING_FILE" << 'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    h = json.load(f)
try:
    with open(sys.argv[2]) as f:
        m = json.load(f)
except:
    m = {}

status = h.get("status", "unknown")

core = h.get("core", {})
db = core.get("database", "unknown")
redis = core.get("redis", "unknown")

llm = h.get("llm", {})
queue = h.get("queue", {})

lines = [f"**Overall: {status.upper()}**", ""]

lines.append("**Core Services**")
lines.append(f"Database: {db}")
lines.append(f"Redis: {redis}")
lines.append(f"LLM Providers: {llm.get('available', 0)}/{llm.get('total', 0)} available")
qs = queue.get("status", "unknown")
if qs != "unknown":
    lines.append(f"Queue: {qs} (DLQ: {queue.get('dlqSize', 0)})")

if m and m != {}:
    lines.append("")
    lines.append("**Infrastructure**")

    vps = m.get("vps", {})
    if isinstance(vps, dict) and not vps.get("error"):
        disk = vps.get("disk", {})
        mem = vps.get("memory", {})
        if disk:
            lines.append(f"Disk: {disk.get('usedPercent', '?')}% used")
        if mem:
            lines.append(f"Memory: {mem.get('usedPercent', '?')}% used")

    ci = m.get("ciStatus", m.get("ci", {}))
    if isinstance(ci, dict):
        lines.append(f"CI: {ci.get('status', ci.get('conclusion', 'unknown'))}")

    containers = m.get("containers", m.get("docker", []))
    if isinstance(containers, list) and containers:
        running = sum(1 for c in containers if c.get("state") == "running")
        lines.append(f"Containers: {running}/{len(containers)} running")

    backup = m.get("backup", m.get("backups", {}))
    if isinstance(backup, dict):
        age = backup.get("ageHours", backup.get("age_hours"))
        if age is not None:
            lines.append(f"Backup: {age}h ago")

    alerts = m.get("alerts", [])
    if isinstance(alerts, list) and alerts:
        lines.append(f"{len(alerts)} active alert(s)")

desc = "\\n".join(lines)
color = 2278400 if status == "ok" else (15105570 if status == "degraded" else 15548997)
uptime = round(h.get("uptime", 0) / 3600, 1)

# Output JSON object
print(json.dumps({"description": desc, "color": color, "uptime": uptime}))
PYEOF
)

if [[ -z "$RESULT" ]]; then
  log_error "Failed to parse health data"
  exit 1
fi

DESCRIPTION=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['description'])")
EMBED_COLOR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['color'])")
UPTIME=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['uptime'])")
TIMESTAMP=$(date '+%H:%M %Z')

notify_discord \
  "Daily System Status" \
  "$DESCRIPTION" \
  "$EMBED_COLOR" \
  "[{\"name\":\"Uptime\",\"value\":\"${UPTIME}h\",\"inline\":true},{\"name\":\"Report Time\",\"value\":\"${TIMESTAMP}\",\"inline\":true}]"

log "Daily status report sent"
