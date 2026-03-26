#!/bin/bash
# Container health check — verify all expected containers are running
# Runs every 30 minutes via cron
# Alerts Discord only if issues found
#
# Cron: */30 * * * * /opt/scripts/container-health.sh >> /var/log/automation/container-health.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands docker
start_timer

EXPECTED_CONTAINERS=(
  "ai-cofounder-agent-server"
  "ai-cofounder-redis"
  "ai-cofounder-worker"
  "ai-cofounder-discord-bot"
  "ai-cofounder-slack-bot"
  "ai-cofounder-n8n"
  "ai-cofounder-prometheus"
  "ai-cofounder-alertmanager"
  "ai-cofounder-grafana"
  "ai-cofounder-uptime-kuma"
  "ai-cofounder-node-exporter"
  "ai-cofounder-cadvisor"
  "ai-cofounder-postgres-exporter"
  "ai-cofounder-alertmanager-discord"
  "avion-postgres-1"
)

log "Checking ${#EXPECTED_CONTAINERS[@]} expected containers..."

MISSING=()
UNHEALTHY=()

# Get all running container names
RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null)

for container in "${EXPECTED_CONTAINERS[@]}"; do
  if ! echo "$RUNNING" | grep -qx "$container"; then
    MISSING+=("$container")
    log_error "MISSING: ${container}"
    continue
  fi

  # Check health status if container has health check
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
  if [[ "$HEALTH" == "unhealthy" ]]; then
    UNHEALTHY+=("$container")
    log_error "UNHEALTHY: ${container}"
  fi
done

RUNNING_COUNT=$(echo "$RUNNING" | wc -l | tr -d ' ')
log "${RUNNING_COUNT} containers running, ${#MISSING[@]} missing, ${#UNHEALTHY[@]} unhealthy"

# Alert only if issues found
if [[ ${#MISSING[@]} -gt 0 || ${#UNHEALTHY[@]} -gt 0 ]]; then
  ISSUES=()
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    MISSING_LIST=$(printf ', %s' "${MISSING[@]}")
    ISSUES+=("**Missing (${#MISSING[@]}):** ${MISSING_LIST:2}")
  fi
  if [[ ${#UNHEALTHY[@]} -gt 0 ]]; then
    UNHEALTHY_LIST=$(printf ', %s' "${UNHEALTHY[@]}")
    ISSUES+=("**Unhealthy (${#UNHEALTHY[@]}):** ${UNHEALTHY_LIST:2}")
  fi

  BODY=$(printf '\\n%s' "${ISSUES[@]}")

  ALERT_COLOR=$COLOR_ORANGE
  if [[ ${#MISSING[@]} -gt 2 ]]; then
    ALERT_COLOR=$COLOR_RED
  fi

  notify_discord \
    "Container Health Alert" \
    "Issues detected with Docker containers:${BODY}" \
    "$ALERT_COLOR" \
    "[{\"name\":\"Running\",\"value\":\"${RUNNING_COUNT}/${#EXPECTED_CONTAINERS[@]}\",\"inline\":true},{\"name\":\"Host\",\"value\":\"$(hostname)\",\"inline\":true}]"
fi

log "Container health check complete"
heartbeat "container-health"
