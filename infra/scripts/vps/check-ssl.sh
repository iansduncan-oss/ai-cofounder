#!/bin/bash
# SSL certificate expiry checker
# Runs daily at 8 AM via cron
# Alerts Discord when certs expire within 14 days
#
# Cron: 0 8 * * * /opt/scripts/check-ssl.sh >> /var/log/automation/check-ssl.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

DOMAINS=(
  "api.aviontechs.com"
  "app.aviontechs.com"
  "n8n.aviontechs.com"
  "grafana.aviontechs.com"
  "status.aviontechs.com"
)

WARN_DAYS=14
CRIT_DAYS=7

WARNINGS=()
CRITICALS=()

log "Checking SSL certificates for ${#DOMAINS[@]} domains..."

for domain in "${DOMAINS[@]}"; do
  # Get cert expiry date
  EXPIRY=$(echo | openssl s_client -servername "$domain" -connect "${domain}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')

  if [[ -z "$EXPIRY" ]]; then
    CRITICALS+=("${domain}: could not retrieve certificate")
    log_error "${domain}: failed to get cert"
    continue
  fi

  # Calculate days until expiry
  EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null)
  NOW_EPOCH=$(date +%s)
  DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

  log "${domain}: ${DAYS_LEFT} days remaining (expires ${EXPIRY})"

  if [[ $DAYS_LEFT -le $CRIT_DAYS ]]; then
    CRITICALS+=("${domain}: **${DAYS_LEFT} days** remaining")
  elif [[ $DAYS_LEFT -le $WARN_DAYS ]]; then
    WARNINGS+=("${domain}: **${DAYS_LEFT} days** remaining")
  fi
done

# Send alerts
if [[ ${#CRITICALS[@]} -gt 0 ]]; then
  CRIT_LIST=$(printf '\\n- %s' "${CRITICALS[@]}")
  notify_discord \
    "SSL CRITICAL — Certs Expiring Soon" \
    "Certificates need immediate renewal:${CRIT_LIST}" \
    "$COLOR_RED" \
    "[{\"name\":\"Threshold\",\"value\":\"< ${CRIT_DAYS} days\",\"inline\":true}]"
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  WARN_LIST=$(printf '\\n- %s' "${WARNINGS[@]}")
  notify_discord \
    "SSL Warning — Certs Expiring" \
    "Certificates expiring within ${WARN_DAYS} days:${WARN_LIST}" \
    "$COLOR_YELLOW" \
    "[{\"name\":\"Threshold\",\"value\":\"< ${WARN_DAYS} days\",\"inline\":true}]"
fi

log "SSL check complete"
