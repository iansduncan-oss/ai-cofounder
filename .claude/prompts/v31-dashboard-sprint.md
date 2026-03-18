# v3.1 Sprint: Dashboard, UX & Observability

Expand the dashboard with 6+ missing pages, add execution debugging tools, improve observability, and expand bot integrations. These upgrades expose the 20+ backend features currently invisible to users.

> **Reference:** `.claude/prompts/v31-deep-research.md` sections 6, 8, 9 for full implementation details.

## Context

Read these files first:
- `.claude/primer.md` — current project state
- `.claude/prompts/v31-deep-research.md` — implementation details for each task
- `apps/dashboard/src/routes.tsx` — existing dashboard routes
- `apps/dashboard/src/hooks/` — existing query/mutation hooks

## Tasks

### Phase 1: Execution Replay & DAG Visualization

**1.1 Execution Replay Page**
- New page: `/dashboard/goals/:id/replay`
- Backend: `GET /api/goals/:id/execution-steps` — returns ordered list of tool calls, results, timing, tokens, cost from `toolExecutions` table
- If reasoning traces exist (from intelligence sprint), include them
- Frontend: timeline scrubber component, step-by-step display showing:
  - Agent thinking (if traces available)
  - Tool call with args (syntax highlighted JSON)
  - Tool result (collapsible, with copy button)
  - Duration and token cost per step
- Playback controls: previous, play (auto-advance), next, speed selector
- Link from goal detail page to replay
- ApiClient: `getExecutionSteps(goalId)` method + types
- Tests: route test, component render test, playback state management

**1.2 DAG Visualization Component**
- Install `@xyflow/react` and `elkjs` as dashboard dependencies
- New component: `TaskDAGView` in `src/components/goals/`
- Convert task `dependsOn` arrays to React Flow nodes + edges
- Auto-layout with ELK (layered, top-down direction)
- Node styling: color by status (pending=gray, in_progress=blue, completed=green, failed=red, blocked=amber)
- Animated edges for in-progress tasks
- MiniMap for large DAGs
- Interactive: click node to see task details in sidebar
- Integrate into goal detail page (toggle between list view and DAG view)
- Tests: verify node/edge generation from task data, layout computation

### Phase 2: Missing Dashboard Pages

**2.1 RAG Document Management**
- New page: `/dashboard/documents`
- Backend routes needed: `GET /api/rag/documents` (list ingested docs with status), `GET /api/rag/documents/:id/chunks` (show chunks for a document), `POST /api/rag/search` (search playground)
- Frontend: document list with ingestion status, chunk count, last updated
- Search playground: input query → show retrieved chunks with relevance scores
- Upload: drag-and-drop file upload for manual ingestion
- Tests: page render, search interaction, upload flow

**2.2 Decision Audit Trail**
- New page: `/dashboard/decisions`
- Backend: `GET /api/decisions` already exists — verify response shape
- Frontend: timeline view of agent decisions with:
  - Decision description and reasoning
  - Alternatives considered (if available)
  - Outcome (success/failure)
  - Link to related goal/task
- Filter by date range, goal, agent type
- Tests: page render, filtering

**2.3 Subagent Dashboard Enhancement**
- Enhance existing `/dashboard/subagents` page
- Add: status visualization (running/completed/failed counts)
- Add: performance metrics (avg duration, token usage per subagent type)
- Add: failure analysis (common error categories)
- Add: detail view for individual subagent runs (tool calls, results)
- Tests: verify metrics calculation, detail view rendering

**2.4 Pipeline Template Browser**
- New page: `/dashboard/pipelines/templates`
- Backend: `GET /api/pipeline-templates` — list available templates
- Frontend: card grid of templates with: name, description, stage count, estimated duration
- Quick-submit button: start pipeline from template with optional parameter overrides
- Template detail view: stage-by-stage breakdown
- Tests: page render, template submission

### Phase 3: UX Polish & Accessibility

**3.1 Optimistic Updates**
- For goal status changes: show updated status immediately, revert on error
- For task completion: mark task done in UI before server confirms
- For memory creation: show new memory in list immediately
- Use TanStack Query's `onMutate`/`onError`/`onSettled` pattern
- Tests: verify optimistic state, verify revert on error

**3.2 Skeleton Loaders**
- Replace generic `<ListSkeleton>` with per-component skeletons:
  - HUD page: 10 metric card skeletons (pulse animation)
  - Goal detail: header + task list skeleton
  - Chat: message bubble skeletons
  - Analytics: chart placeholder skeletons
- Use Tailwind `animate-pulse` with proper sizing to match final content
- Tests: verify skeletons render during loading state

**3.3 Accessibility Improvements**
- Add `aria-live="polite"` regions for streaming chat messages
- Add text labels alongside color-only status indicators (dots → dot + text)
- Keyboard navigation: ensure all interactive elements are reachable via Tab
- Focus indicators: visible focus rings on all buttons, links, inputs
- Skip-to-content link on main layout
- Screen reader labels for icon-only buttons
- Tests: axe-core automated accessibility audit on 5 key pages

**3.4 Theme Toggle**
- Add dark/light/system theme support
- Use Tailwind v4 CSS variables for theme colors
- Store preference in localStorage
- Toggle button in sidebar footer
- Respect `prefers-color-scheme` for system option
- Tests: verify theme switching, localStorage persistence

**3.5 Data Export**
- Add export buttons to: goals list, analytics page, tool stats
- Formats: CSV and JSON
- Frontend-only (no backend changes): serialize query data to file download
- Use `Blob` + `URL.createObjectURL` for download
- Tests: verify export generates valid CSV/JSON

### Phase 4: Observability & Monitoring

**4.1 OpenTelemetry GenAI Spans**
- Install `@opentelemetry/api` + `@opentelemetry/sdk-trace-node` + OTLP exporter
- Create `tracing.ts` plugin for agent-server
- Wrap agent execution in `agent.invoke` spans with GenAI semantic attributes
- Wrap LLM calls in `gen_ai.chat` spans (model, tokens, cost)
- Wrap tool calls in `gen_ai.tool` spans (name, args, duration)
- Export to stdout (development) or OTLP endpoint (production)
- Configuration via env: `OTEL_ENABLED`, `OTEL_EXPORTER_ENDPOINT`
- Tests: verify spans are created with correct attributes

**4.2 Per-Goal Cost Attribution**
- New table: `goal_costs` (goal_id, llm_cost, embedding_cost, tool_cost, compute_cost, total_cost)
- `CostTracker` class: accumulates costs per goal during execution
- Flush to DB on goal completion
- Dashboard: show cost badge on goal cards, cost breakdown in goal detail
- Add cost column to goals list with sorting
- Migration: `0033_goal_costs.sql` (or next available number)
- ApiClient: update goal types to include cost fields
- Tests: verify cost accumulation, flush, dashboard display

**4.3 SLO Dashboard Widget**
- New HUD card or dedicated section on monitoring page
- Display key SLIs: goal success rate, P50/P99 latency, tool error rate, LLM availability
- Calculate from existing data (goals, toolExecutions, providerHealth tables)
- Color coding: green (meeting SLO), yellow (at risk), red (breaching)
- Backend: `GET /api/monitoring/slos` endpoint
- Tests: verify SLO calculation logic

### Phase 5: Bot Command Expansion

**5.1 Add Missing Bot Commands**
Add these commands to both Discord and Slack bots via `@ai-cofounder/bot-handlers`:

- `/briefing` — Get today's daily briefing summary
  - Backend: `GET /api/briefings/latest`
  - Show: narrative summary, key metrics, pending approvals count

- `/monitor` — Quick system health check
  - Backend: `GET /api/monitoring/status`
  - Show: VPS status, CI status, provider health, queue depth

- `/pipeline list|run <template>` — Pipeline management
  - Backend: `GET /api/pipelines`, `POST /api/queue/pipeline`
  - List: active pipelines with stage progress
  - Run: trigger pipeline from template name

- `/journal <entry>` — Log a journal reflection
  - Backend: `POST /api/journal`
  - Show: confirmation with entry ID

- `/patterns` — View anticipatory suggestions
  - Backend: `GET /api/reflections/suggestions`
  - Show: top 3 triggered patterns with accept/dismiss buttons

- `/costs [today|week|month]` — Spending summary
  - Backend: `GET /api/usage/costs` with period parameter
  - Show: total spend, top models, top goals by cost

**5.2 Discord Rich Embeds**
- Upgrade bot responses from plain text to Discord embeds
- Goal execution updates: embedded progress bar, status colors
- Approval requests: embed with Approve/Reject buttons (Discord components)
- Briefings: formatted embed with sections for metrics, tasks, alerts

**5.3 Slack Block Kit**
- Approval requests: Block Kit buttons for approve/reject (interactive messages)
- Briefings: Section blocks with metrics, dividers, accessory images
- Goal updates: Context blocks with status badges

## Success Criteria

- [ ] Execution replay works for any completed goal (shows tool calls, timing, costs)
- [ ] DAG visualization renders task dependencies with auto-layout and status coloring
- [ ] At least 4 new dashboard pages functional (RAG docs, decisions, templates, enhanced subagents)
- [ ] Accessibility audit passes with 0 critical violations on 5 key pages
- [ ] Theme toggle works (dark/light/system)
- [ ] OTel spans export correctly for agent → LLM → tool hierarchy
- [ ] Per-goal cost tracking captures and displays accurate costs
- [ ] 6 new bot commands working in both Discord and Slack
- [ ] All new features have tests, all existing tests still pass

## Estimated Effort

- Phase 1: 4-5 days
- Phase 2: 5-6 days
- Phase 3: 4-5 days
- Phase 4: 3-4 days
- Phase 5: 3-4 days
- **Total: ~4 weeks**
