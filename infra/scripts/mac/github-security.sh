#!/bin/bash
# GitHub security alert checker via Dependabot
# Runs Monday at 10 AM via cron
# Alerts Discord on critical/high severity vulnerabilities
#
# Cron: 0 10 * * 1 /Users/ianduncan/Scripts/github-security.sh >> /Users/ianduncan/Scripts/logs/github-security.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

REPO="ianduncan/ai-cofounder"

log "Checking Dependabot alerts for ${REPO}..."

# Verify gh CLI is available and authenticated
if ! command -v gh &>/dev/null; then
  log_error "gh CLI not found"
  exit 1
fi

# Fetch open Dependabot alerts (critical + high only)
ALERTS_JSON=$(gh api "repos/${REPO}/dependabot/alerts?state=open&severity=critical,high&per_page=100" 2>&1) || {
  # 404 = Dependabot not enabled, not an error
  if echo "$ALERTS_JSON" | grep -q "404"; then
    log "Dependabot alerts not enabled for ${REPO} — skipping"
    exit 0
  fi
  log_error "Failed to fetch Dependabot alerts: ${ALERTS_JSON}"
  notify_discord \
    "Security Check Failed" \
    "Could not fetch Dependabot alerts for \`${REPO}\`. Check \`gh\` auth or enable Dependabot." \
    "$COLOR_RED"
  exit 1
}

# Count by severity
CRITICAL=$(echo "$ALERTS_JSON" | jq '[.[] | select(.security_advisory.severity == "critical")] | length' 2>/dev/null || echo "0")
HIGH=$(echo "$ALERTS_JSON" | jq '[.[] | select(.security_advisory.severity == "high")] | length' 2>/dev/null || echo "0")
TOTAL=$((CRITICAL + HIGH))

log "Found: ${CRITICAL} critical, ${HIGH} high (${TOTAL} total)"

if [[ $TOTAL -eq 0 ]]; then
  log "No critical/high alerts — no notification sent"
  exit 0
fi

# Build details (top 5)
DETAILS=$(echo "$ALERTS_JSON" | jq -r '
  [.[:5][] |
    "- **\(.security_advisory.severity | ascii_upcase)**: \(.security_advisory.summary // "Unknown") (\(.dependency.package.name // "unknown package"))"
  ] | join("\\n")' 2>/dev/null || echo "- Details unavailable")

# Choose color based on severity
if [[ $CRITICAL -gt 0 ]]; then
  ALERT_COLOR=$COLOR_RED
  TITLE="Security Alert: ${CRITICAL} Critical"
else
  ALERT_COLOR=$COLOR_ORANGE
  TITLE="Security Alert: ${HIGH} High"
fi

notify_discord \
  "$TITLE" \
  "Open Dependabot alerts for \`${REPO}\`:\\n${DETAILS}" \
  "$ALERT_COLOR" \
  "[{\"name\":\"Critical\",\"value\":\"${CRITICAL}\",\"inline\":true},{\"name\":\"High\",\"value\":\"${HIGH}\",\"inline\":true},{\"name\":\"Total\",\"value\":\"${TOTAL}\",\"inline\":true}]"

log "Alert sent"
