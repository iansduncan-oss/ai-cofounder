# Roadmap: AI Cofounder

## Milestones

- [v1.0 Infrastructure & Reliability](milestones/v1.0-ROADMAP.md) — Phases 1-4 (shipped 2026-03-09)
- [v1.1 Pipeline Dashboard UI](milestones/v1.1-ROADMAP.md) — Phases 5-7 (shipped 2026-03-09)
- [v2.0 Autonomous Cofounder](milestones/v2.0-ROADMAP.md) — Phases 8-16 (active)

## Phases

<details>
<summary>v1.0 Infrastructure & Reliability (Phases 1-4) — COMPLETE 2026-03-09</summary>

- [x] **Phase 1: Queue Foundation** (completed 2026-03-08)
- [x] **Phase 2: SSE Migration** (completed 2026-03-08)
- [x] **Phase 3: Authentication** (completed 2026-03-08)
- [x] **Phase 4: Tests & Quick Wins** (completed 2026-03-09)

</details>

<details>
<summary>v1.1 Pipeline Dashboard UI (Phases 5-7) — COMPLETE 2026-03-09</summary>

- [x] **Phase 5: Pipeline List + Navigation** (completed 2026-03-09)
- [x] **Phase 6: Pipeline Detail** (completed 2026-03-09)
- [x] **Phase 7: Pipeline Trigger** (completed 2026-03-09)

</details>

### v2.0 Autonomous Cofounder (In Progress)

**Milestone Goal:** Transform the AI Cofounder from a reactive tool into an autonomous engineering partner that works independently, remembers everything, and manages all systems.

- [ ] **Phase 8: Memory & Session Foundation** — RAG auto-ingestion, decision tagging, session continuity
- [ ] **Phase 9: Autonomy & Approval System** — Three-tier approval (green/yellow/red) with configurable per-tool controls
- [ ] **Phase 10: Autonomous Execution Engine** — Task pickup, chained tool execution, auto-commit, auto-PR
- [ ] **Phase 11: Autonomous Scheduling** — Recurring execution loop, distributed lock, token budget, self-healing
- [ ] **Phase 12: Work Journal & Standup** — Browsable activity log, daily standup summaries
- [ ] **Phase 13: Financial Tracking** — Per-request cost tracking, aggregation, budget alerts
- [ ] **Phase 14: Multi-Project Awareness** — Multi-workspace registry, per-project context, VPS state
- [ ] **Phase 15: Content Automations** — YouTube pipeline + n8n as managed tasks
- [ ] **Phase 16: Dashboard Command Center** — Journal, approvals, costs, projects, notifications, settings

## Phase Details

### Phase 8: Memory & Session Foundation
**Goal**: Agent automatically ingests all conversations, decisions, and project context into RAG — and brings relevant history to every new interaction without being asked
**Depends on**: Nothing (builds on existing RAG infrastructure)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, SESS-01, SESS-02
**Success Criteria** (what must be TRUE):
  1. New conversation receives relevant context from last 3 sessions within first response
  2. Agent references a past decision unprompted when discussing the same topic
  3. Conversation ingestion completes within 30s of conversation end
  4. Project documentation is auto-ingested on project registration
  5. Related memories are periodically consolidated into coherent knowledge entries
**Plans:** 3 plans

Plans:
- [ ] 08-01-PLAN.md — Conversation auto-ingestion pipeline and project docs trigger
- [ ] 08-02-PLAN.md — Decision auto-detection and proactive decision surfacing
- [ ] 08-03-PLAN.md — Session context injection and memory consolidation

### Phase 9: Autonomy & Approval System
**Goal**: Three-tier system (green/yellow/red) controls what the agent can do freely, what needs approval, and what's forbidden — with real-time approval flow via Slack/Discord
**Depends on**: Nothing
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05
**Success Criteria** (what must be TRUE):
  1. Green-tier tools execute immediately with no delay
  2. Yellow-tier tools block until approved, with approval request delivered to Slack within 2s
  3. Red-tier tools are refused with explanation — no execution path exists
  4. Tier config changes from dashboard take effect immediately
  5. Approval timeout auto-denies after configurable period
**Plans**: TBD

### Phase 10: Autonomous Execution Engine
**Goal**: Agent picks up tasks from the goal backlog and completes them end-to-end — code, test, commit, PR — without human intervention
**Depends on**: Phase 9
**Requirements**: TERM-01, TERM-02, TERM-03, TERM-04, TERM-05
**Success Criteria** (what must be TRUE):
  1. Agent completes a coding task (edit file, run tests, commit, open PR) with zero human interaction
  2. Work log entry created for every autonomous execution with accurate duration and cost
  3. PR description accurately summarizes changes made
  4. Conventional commit messages include goal/task ID linkage
  5. Execution output is visible in dashboard via SSE
**Plans**: TBD

### Phase 11: Autonomous Scheduling
**Goal**: Agent works while you sleep — recurring execution loop with distributed lock, token budget, and CI self-healing
**Depends on**: Phase 9, Phase 10
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04
**Success Criteria** (what must be TRUE):
  1. Autonomous session runs on schedule, picks up a task, completes it, and logs the work
  2. Second session attempt while one is running is rejected (no dual execution)
  3. Session aborts cleanly when token budget is exhausted (no partial commits)
  4. CI self-heal creates a PR fixing a real test failure after 2-cycle confirmation
**Plans**: TBD

### Phase 12: Work Journal & Standup
**Goal**: Browsable activity log of everything the agent does, with daily standup summaries delivered proactively
**Depends on**: Phase 10
**Requirements**: JRNL-01, JRNL-02, JRNL-03, JRNL-04
**Success Criteria** (what must be TRUE):
  1. Dashboard shows chronological timeline of all agent activity for any date range
  2. Daily standup is accurate, concise, and delivered before configured morning hour
  3. Journal entries link to the correct PRs and commits
  4. Journal supports full-text search across all entries
**Plans**: TBD

### Phase 13: Financial Tracking
**Goal**: Know exactly what the agent costs — per request, per goal, per day — with budget enforcement and optimization suggestions
**Depends on**: Phase 10
**Requirements**: FIN-01, FIN-02, FIN-03, FIN-04
**Success Criteria** (what must be TRUE):
  1. Every LLM call has an accurate dollar cost persisted within the request lifecycle
  2. Dashboard shows cost breakdown by any dimension (day, goal, model, agent)
  3. Budget alert fires within 1 minute of threshold breach
  4. Cost optimization suggestions generated based on usage patterns
**Plans**: TBD

### Phase 14: Multi-Project Awareness
**Goal**: Agent understands all your projects, infrastructure, and how they relate — can switch context and reason across projects
**Depends on**: Phase 8
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04
**Success Criteria** (what must be TRUE):
  1. Agent can switch between 2+ registered projects and maintain correct context for each
  2. VPS container status is queryable and accurate
  3. Agent flags potential cross-project impact when making changes
  4. Per-project RAG namespace scopes memories correctly
**Plans**: TBD

### Phase 15: Content Automations
**Goal**: YouTube pipeline and n8n workflows are managed tasks the agent can trigger, monitor, and report on
**Depends on**: Phase 10, Phase 12
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04
**Success Criteria** (what must be TRUE):
  1. YouTube pipeline is triggerable from dashboard as a one-click managed pipeline
  2. n8n execution history visible in dashboard with status and timing
  3. Content outputs appear in work journal with links to published content
  4. Content pipelines can be scheduled via autonomous scheduling
**Plans**: TBD

### Phase 16: Dashboard Command Center
**Goal**: Dashboard becomes the single pane of glass — work journal, approvals, costs, projects, notifications, and settings all in one place
**Depends on**: Phase 9, Phase 12, Phase 13, Phase 14
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. All 6 new dashboard pages/components render correctly with real data
  2. Approval actions from dashboard update agent execution within 2s
  3. Settings changes take effect immediately without server restart
  4. Multi-project switcher correctly changes workspace context
  5. Notification center shows real-time updates
**Plans**: TBD

## Progress

**Execution Order:** 8 & 9 (parallel) → 10 → 11, 12, 13 (parallel) → 14, 15 → 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Queue Foundation | v1.0 | 3/3 | Complete | 2026-03-08 |
| 2. SSE Migration | v1.0 | 2/2 | Complete | 2026-03-08 |
| 3. Authentication | v1.0 | 2/2 | Complete | 2026-03-08 |
| 4. Tests & Quick Wins | v1.0 | 2/2 | Complete | 2026-03-09 |
| 5. Pipeline List + Navigation | v1.1 | 1/1 | Complete | 2026-03-09 |
| 6. Pipeline Detail | v1.1 | 2/2 | Complete | 2026-03-09 |
| 7. Pipeline Trigger | v1.1 | 1/1 | Complete | 2026-03-09 |
| 8. Memory & Session Foundation | v2.0 | 0/3 | Planned | — |
| 9. Autonomy & Approval System | v2.0 | 0/0 | Pending | — |
| 10. Autonomous Execution Engine | v2.0 | 0/0 | Pending | — |
| 11. Autonomous Scheduling | v2.0 | 0/0 | Pending | — |
| 12. Work Journal & Standup | v2.0 | 0/0 | Pending | — |
| 13. Financial Tracking | v2.0 | 0/0 | Pending | — |
| 14. Multi-Project Awareness | v2.0 | 0/0 | Pending | — |
| 15. Content Automations | v2.0 | 0/0 | Pending | — |
| 16. Dashboard Command Center | v2.0 | 0/0 | Pending | — |

---
*v1.0 roadmap created: 2026-03-07*
*v1.1 roadmap created: 2026-03-09*
*v1.1 archived: 2026-03-09*
*v2.0 roadmap created: 2026-03-09*
