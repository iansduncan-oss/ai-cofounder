# Manual Runtime Verification Checklist

**Context:** These 11 checks require a running production instance and a browser. They verify Phases 15-17 features that automated tests can't cover (real n8n connections, live WebSocket updates, UI interactions).

**Base URL:** `https://app.aviontechs.com/dashboard`
**API URL:** `https://api.aviontechs.com`

---

## Phase 15: Content Automations

### 1. Pipeline Template Trigger
- **URL:** `/dashboard/pipeline-templates`
- **Steps:**
  1. Find the "YouTube Shorts" template card
  2. Click "Trigger" button
  3. Observe loading state, then success toast
- **Expected:** Pipeline execution starts, status updates to "running", then "completed" within 30s
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 2. N8n Workflows Page
- **URL:** `/dashboard/n8n`
- **Steps:**
  1. Page loads and shows registered workflows
  2. Click on a workflow to see execution history
  3. Verify status badges show correct colors (green=success, red=error, yellow=running)
- **Expected:** Workflows list populated from n8n API, execution history shows timestamps and durations
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 3. Pipeline Execution History
- **URL:** `/dashboard/pipelines`
- **Steps:**
  1. Verify past pipeline executions appear in the list
  2. Click a completed execution to see detail view
  3. Check stage-by-stage results are visible
- **Expected:** Executions show stage progression with outputs from each step
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 4. Journal Entry for Content Pipeline
- **URL:** `/dashboard/journal`
- **Steps:**
  1. Open the type filter dropdown
  2. Select "content_pipeline" filter
  3. Verify at least one entry appears (from the trigger test above)
- **Expected:** Journal entry with Workflow icon, "Content Pipeline" label, and pipeline execution details
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 5. CONT-03: Agent Can Trigger N8n Workflows
- **URL:** Chat at `/dashboard` (command center)
- **Steps:**
  1. In the chat panel, type: "Trigger the youtube-shorts-publish workflow"
  2. Watch for `trigger_workflow` tool call card
  3. Verify agent receives success response
- **Expected:** Tool call card shows `trigger_workflow` with workflow name, result confirms trigger success
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

---

## Phase 16: Dashboard Command Center

### 6. Approval Latency + Tier Badges
- **URL:** `/dashboard/approvals`
- **Steps:**
  1. Create a goal that triggers an approval (or verify existing pending approvals)
  2. Check that approval cards show tier badges (yellow for `yellow`, red for `red`)
  3. Approve or reject an approval, verify response time < 2s
- **Expected:** Tier badges render correctly, approval action reflects immediately in the UI
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 7. Notification Center Real-Time Updates
- **URL:** `/dashboard/notifications`
- **Steps:**
  1. Open notifications page
  2. In another tab, trigger an action that creates a notification (e.g., monitoring alert, budget threshold)
  3. Return to notifications page — check if new notification appears without manual refresh
- **Expected:** WebSocket push delivers new notification within 5s (no page reload needed)
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

---

## Phase 17: Integration Flow Gaps

### 8. Autonomous Sessions Page
- **URL:** `/dashboard/autonomous`
- **Steps:**
  1. Page loads with list of past autonomous sessions
  2. Verify status badges: running (blue), completed (green), failed (red), timeout (yellow), skipped (gray), aborted (orange)
  3. Check duration and token count columns are populated
  4. Click a session to verify summary and linked goals appear
- **Expected:** All sessions visible with correct status rendering, durations shown as human-readable
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 9. Journal Filter — Content Pipeline Type
- **URL:** `/dashboard/journal`
- **Steps:**
  1. Open the journal type filter dropdown
  2. Verify "Content Pipeline" appears as a filter option (added in Phase 17)
  3. Apply the filter and verify only content_pipeline entries show
  4. Test date range filter: set "From" to 7 days ago, verify results narrow
- **Expected:** Filter dropdown includes content_pipeline, date range works correctly
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 10. Project Switcher Scoping
- **URL:** `/dashboard` (sidebar)
- **Steps:**
  1. Find the project switcher dropdown in the sidebar
  2. Switch to a different project
  3. Navigate to `/dashboard/workspace` — verify the file browser root changes
  4. Refresh the page — verify the selected project persists (localStorage)
- **Expected:** Project selection persists across navigation and page refresh, workspace scopes to project
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

### 11. Scheduler Tier Enforcement
- **API test:** `curl -s https://api.aviontechs.com/health/deep | jq .`
- **Steps:**
  1. Verify the health endpoint returns OK with all subsystems healthy
  2. Check agent server logs for scheduler startup: `scheduler started with autonomyTierService`
  3. Trigger an autonomous session (via API or scheduled job)
  4. Verify the orchestrator respects the autonomy tier — green tools execute freely, yellow tools log approval checks, red tools require explicit approval
- **Expected:** Autonomy tier service is wired through scheduler → orchestrator, tool execution respects tier boundaries
- **Pass/Fail:** [ ] Pass / [ ] Fail
- **Notes:**

---

## Summary

| # | Check | Phase | Status |
|---|-------|-------|--------|
| 1 | Pipeline template trigger | 15 | [ ] |
| 2 | N8n workflows page | 15 | [ ] |
| 3 | Pipeline execution history | 15 | [ ] |
| 4 | Journal content_pipeline entry | 15 | [ ] |
| 5 | CONT-03 agent triggers n8n | 15 | [ ] |
| 6 | Approval latency + tier badges | 16 | [ ] |
| 7 | Notification real-time updates | 16 | [ ] |
| 8 | Autonomous sessions page | 17 | [ ] |
| 9 | Journal filter + date range | 17 | [ ] |
| 10 | Project switcher scoping | 17 | [ ] |
| 11 | Scheduler tier enforcement | 17 | [ ] |

**All 11 pass = Phases 15-17 runtime-verified. Update v3-audit.md accordingly.**
