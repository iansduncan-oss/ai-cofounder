#!/bin/bash
# Daily cost tracker
# Curls agent-server usage endpoints and posts Discord embed
# Runs daily at 8 PM via cron
#
# Cron: 0 20 * * * /opt/scripts/cost-tracker.sh >> /var/log/automation/cost-tracker.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

API_BASE="http://localhost:3100"

log "Starting daily cost report..."

# Localhost requests bypass JWT auth in the agent-server
TODAY=$(curl -sf --max-time 10 "${API_BASE}/api/usage?period=today" 2>/dev/null)
DAILY=$(curl -sf --max-time 10 "${API_BASE}/api/usage/daily?days=7" 2>/dev/null || true)
BUDGET=$(curl -sf --max-time 10 "${API_BASE}/api/usage/budget" 2>/dev/null || true)
TOP_GOALS=$(curl -sf --max-time 10 "${API_BASE}/api/usage/top-goals?limit=3" 2>/dev/null || true)

if [[ -z "$TODAY" ]]; then
  notify_discord \
    "Cost Tracker: Usage Data Unavailable" \
    "Could not fetch usage data from ${API_BASE}/api/usage" \
    "$COLOR_RED"
  log_error "Usage endpoint unavailable"
  exit 1
fi

# Write to temp files
TODAY_FILE=$(mktemp)
DAILY_FILE=$(mktemp)
BUDGET_FILE=$(mktemp)
GOALS_FILE=$(mktemp)
trap 'rm -f "$TODAY_FILE" "$DAILY_FILE" "$BUDGET_FILE" "$GOALS_FILE"' EXIT

echo "$TODAY" > "$TODAY_FILE"
echo "${DAILY:-{}}" > "$DAILY_FILE"
echo "${BUDGET:-{}}" > "$BUDGET_FILE"
echo "${TOP_GOALS:-[]}" > "$GOALS_FILE"

# Parse and format
RESULT=$(python3 - "$TODAY_FILE" "$DAILY_FILE" "$BUDGET_FILE" "$GOALS_FILE" << 'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    today = json.load(f)
try:
    with open(sys.argv[2]) as f:
        daily = json.load(f)
except:
    daily = {}
try:
    with open(sys.argv[3]) as f:
        budget = json.load(f)
except:
    budget = {}
try:
    with open(sys.argv[4]) as f:
        goals = json.load(f)
except:
    goals = []

lines = []

cost = today.get("totalCostUsd", 0)
tokens_in = today.get("inputTokens", 0)
tokens_out = today.get("outputTokens", 0)
requests = today.get("requestCount", 0)

lines.append(f"**Today's Spend: ${cost:.4f}**")
lines.append(f"Requests: {requests} | Tokens: {tokens_in + tokens_out:,}")
lines.append("")

# 7-day sparkline
days = daily.get("days", [])
if days:
    costs = [d.get("costUsd", 0) for d in days]
    if costs:
        max_c = max(costs) if max(costs) > 0 else 1
        bars = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588"
        sparkline = ""
        for c in costs:
            idx = min(int(c / max_c * (len(bars) - 1)), len(bars) - 1)
            sparkline += bars[idx]
        week_total = sum(costs)
        lines.append(f"**7-Day Trend:** {sparkline}  (${week_total:.4f} total)")
        lines.append("")

daily_budget = budget.get("daily", {})
weekly_budget = budget.get("weekly", {})
if daily_budget:
    pct = daily_budget.get("percentUsed", 0)
    lines.append(f"**Daily Budget:** ${daily_budget.get('spentUsd', 0):.4f} / ${daily_budget.get('limitUsd', 0):.2f} ({pct:.0f}%)")
if weekly_budget:
    pct = weekly_budget.get("percentUsed", 0)
    lines.append(f"**Weekly Budget:** ${weekly_budget.get('spentUsd', 0):.4f} / ${weekly_budget.get('limitUsd', 0):.2f} ({pct:.0f}%)")

if isinstance(goals, list) and goals:
    lines.append("")
    lines.append("**Top Spenders**")
    for g in goals[:3]:
        title = g.get("title", "Unknown")[:40]
        gcost = g.get("costUsd", 0)
        lines.append(f"- {title}: ${gcost:.4f}")

budget_pct = daily_budget.get("percentUsed", 0) if daily_budget else 0
if budget_pct < 50:
    color = 2278400
elif budget_pct < 70:
    color = 16776160
elif budget_pct < 90:
    color = 15105570
else:
    color = 15548997

desc = "\\n".join(lines)
print(json.dumps({"description": desc, "color": color}))
PYEOF
)

if [[ -z "$RESULT" ]]; then
  log_error "Failed to parse usage data"
  exit 1
fi

DESCRIPTION=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['description'])")
EMBED_COLOR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['color'])")
TIMESTAMP=$(date '+%H:%M %Z')

notify_discord \
  "Daily Cost Report" \
  "$DESCRIPTION" \
  "$EMBED_COLOR" \
  "[{\"name\":\"Report Time\",\"value\":\"${TIMESTAMP}\",\"inline\":true}]"

log "Daily cost report sent"
