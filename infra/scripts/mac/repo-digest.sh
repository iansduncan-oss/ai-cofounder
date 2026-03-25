#!/bin/bash
# Repository digest — scan for uncommitted/unpushed work
# Runs weekdays at 9 AM via cron
# Alerts Discord only if there's something to report
#
# Cron: 0 9 * * 1-5 /Users/ianduncan/Scripts/repo-digest.sh >> /Users/ianduncan/Scripts/logs/repo-digest.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands git
start_timer

PROJECTS_DIR="$HOME/Projects"
STALE_BRANCH_DAYS=30

UNCOMMITTED=()
UNPUSHED=()
STALE_BRANCHES=()

log "Scanning repos in ${PROJECTS_DIR}..."

for repo in "$PROJECTS_DIR"/*/; do
  [[ -d "${repo}.git" ]] || continue
  REPO_NAME=$(basename "$repo")

  # Check for uncommitted changes (staged + unstaged + untracked)
  if [[ -n $(git -C "$repo" status --porcelain 2>/dev/null) ]]; then
    CHANGED=$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    UNCOMMITTED+=("**${REPO_NAME}**: ${CHANGED} changed files")
  fi

  # Check for unpushed commits on current branch
  BRANCH=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [[ -n "$BRANCH" ]]; then
    AHEAD=$(git -C "$repo" rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo "0")
    if [[ "$AHEAD" -gt 0 ]]; then
      UNPUSHED+=("**${REPO_NAME}** (${BRANCH}): ${AHEAD} commits ahead")
    fi
  fi

  # Check for stale merged branches (>30 days old, excluding main/master/develop)
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    branch=$(echo "$branch" | xargs)  # trim whitespace
    [[ "$branch" =~ ^(main|master|develop)$ ]] && continue

    LAST_COMMIT=$(git -C "$repo" log -1 --format="%ct" "$branch" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    AGE_DAYS=$(( (NOW - LAST_COMMIT) / 86400 ))

    if [[ $AGE_DAYS -gt $STALE_BRANCH_DAYS ]]; then
      STALE_BRANCHES+=("**${REPO_NAME}/${branch}**: ${AGE_DAYS}d old")
    fi
  done < <(git -C "$repo" branch --merged 2>/dev/null | grep -v '^\*' | grep -v 'main\|master\|develop' || true)
done

# Build message
SECTIONS=()

if [[ ${#UNCOMMITTED[@]} -gt 0 ]]; then
  LIST=$(printf '\\n- %s' "${UNCOMMITTED[@]}")
  SECTIONS+=("**Uncommitted Changes**${LIST}")
fi

if [[ ${#UNPUSHED[@]} -gt 0 ]]; then
  LIST=$(printf '\\n- %s' "${UNPUSHED[@]}")
  SECTIONS+=("**Unpushed Commits**${LIST}")
fi

if [[ ${#STALE_BRANCHES[@]} -gt 0 ]]; then
  LIST=$(printf '\\n- %s' "${STALE_BRANCHES[@]}")
  SECTIONS+=("**Stale Merged Branches (>${STALE_BRANCH_DAYS}d)**${LIST}")
fi

# Only send if something to report
if [[ ${#SECTIONS[@]} -gt 0 ]]; then
  BODY=$(printf '\\n\\n%s' "${SECTIONS[@]}")
  REPO_COUNT=$(find "$PROJECTS_DIR" -maxdepth 1 -mindepth 1 -type d -exec test -d {}/.git \; -print | wc -l | tr -d ' ')

  notify_discord \
    "Repo Digest" \
    "Scanned ${REPO_COUNT} repositories:${BODY}" \
    "$COLOR_YELLOW" \
    "[{\"name\":\"Repos Scanned\",\"value\":\"${REPO_COUNT}\",\"inline\":true},{\"name\":\"Date\",\"value\":\"$(date '+%A %b %d')\",\"inline\":true}]"

  log "Digest sent: ${#UNCOMMITTED[@]} uncommitted, ${#UNPUSHED[@]} unpushed, ${#STALE_BRANCHES[@]} stale"
else
  log "All repos clean — no notification sent"
fi

heartbeat "repo-digest"
