#!/bin/bash
# Clean up stale remote branches merged into main
# Runs weekly Sunday 3:30 AM via cron
# Notifies Discord only if branches were deleted
#
# Cron: 30 3 * * 0 /opt/scripts/stale-branch-cleaner.sh >> /var/log/automation/stale-branch-cleaner.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands git
start_timer

REPO_DIR="/opt/ai-cofounder"
PROTECTED_BRANCHES="main|develop|staging"
MAX_AGE_DAYS=14
DRY_RUN="${1:-}"

cd "$REPO_DIR" || { log_error "Cannot cd to ${REPO_DIR}"; exit 1; }

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  log "DRY RUN MODE — no branches will be deleted"
fi
log "Starting stale branch cleanup..."

# Prune remote tracking refs
git fetch --prune origin 2>/dev/null

# Find branches merged into origin/main (excluding protected)
MERGED_BRANCHES=$(git branch -r --merged origin/main 2>/dev/null \
  | grep 'origin/' \
  | grep -v 'HEAD' \
  | grep -Ev "origin/(${PROTECTED_BRANCHES})" \
  | sed 's|origin/||' \
  | xargs || true)

if [[ -z "$MERGED_BRANCHES" ]]; then
  log "No merged branches found"
  exit 0
fi

DELETED=()
CUTOFF=$(date -d "${MAX_AGE_DAYS} days ago" +%s 2>/dev/null || date -v-${MAX_AGE_DAYS}d +%s)

for branch in $MERGED_BRANCHES; do
  # Get last commit date on the branch
  LAST_COMMIT=$(git log -1 --format='%ct' "origin/${branch}" 2>/dev/null)

  if [[ -z "$LAST_COMMIT" ]]; then
    continue
  fi

  if [[ "$LAST_COMMIT" -lt "$CUTOFF" ]]; then
    LAST_DATE=$(git log -1 --format='%ci' "origin/${branch}" 2>/dev/null | cut -d' ' -f1)
    if [[ "$DRY_RUN" == "--dry-run" ]]; then
      log "Would delete: ${branch} (last commit: ${LAST_DATE})"
      DELETED+=("${branch} (${LAST_DATE})")
    else
      log "Deleting: ${branch} (last commit: ${LAST_DATE})"
      if git push origin --delete "$branch" 2>/dev/null; then
        DELETED+=("${branch} (${LAST_DATE})")
      else
        log_error "Failed to delete branch: ${branch}"
      fi
    fi
  fi
done

if [[ ${#DELETED[@]} -gt 0 ]]; then
  BRANCH_LIST=$(printf '\\n- %s' "${DELETED[@]}")
  notify_discord \
    "Stale Branches Cleaned" \
    "Deleted ${#DELETED[@]} merged branch(es) older than ${MAX_AGE_DAYS} days:${BRANCH_LIST}" \
    "$COLOR_BLUE" \
    "[{\"name\":\"Repository\",\"value\":\"ai-cofounder\",\"inline\":true},{\"name\":\"Protected\",\"value\":\"main, develop, staging\",\"inline\":true}]"
  log "Deleted ${#DELETED[@]} stale branches"
else
  log "No stale branches to delete (all merged branches are recent)"
fi

heartbeat "stale-branch-cleaner"
