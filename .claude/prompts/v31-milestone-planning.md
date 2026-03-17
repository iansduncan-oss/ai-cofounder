# v3.1 Milestone Planning

Plan the next milestone for AI Cofounder. v3.0 is complete — this defines what comes next.

## Steps

1. **Review current state** — Read `.claude/primer.md`, MEMORY.md, and recent git log to understand where the project stands.

2. **Identify candidate features** — Consider these areas:
   - **Agent intelligence** — Better planning strategies, multi-agent collaboration patterns, agent memory improvements, smarter tool selection
   - **Dashboard UX** — Real-time agent visualization, task dependency graph view, memory browser, conversation search/filter, dark mode
   - **Reliability** — Retry/circuit-breaker patterns, graceful degradation when providers are down, better error reporting to users
   - **Integrations** — Calendar, email, GitHub deeper integration, webhook receivers for external events
   - **Developer experience** — Better local dev setup, more comprehensive API docs, OpenAPI spec improvements
   - **Performance** — Query optimization, caching layer, connection pooling tuning, bundle size for dashboard

3. **Prioritize with user** — Present the candidates grouped by theme. Ask the user to pick 3-5 items for v3.1 scope. Don't over-scope — a focused milestone ships faster.

4. **Write the roadmap** — Create `tasks/v31-roadmap.md` with:
   - Milestone goal (one sentence)
   - Phases with clear deliverables
   - Dependencies between phases
   - Success criteria for each phase

5. **Update project files** — Update MEMORY.md and primer with the new milestone info.

6. **Commit** — Commit the roadmap and updated docs.
