# Pitfalls Research

**Domain:** Autonomous AI agent platform — adding terminal access, persistent RAG memory, tiered autonomy, daily standup/journal, financial tracking, multi-project awareness
**Researched:** 2026-03-09
**Confidence:** HIGH (codebase-verified + current search sources)

---

## Critical Pitfalls

### Pitfall 1: Real Terminal Access Bypasses the Sandbox Boundary

**What goes wrong:**
The existing system uses Docker sandbox (`packages/sandbox`) for code execution — fully isolated. The new milestone needs "real terminal access" to actually build, deploy, and manage projects. If a `run_shell` or `execute_terminal` tool is added naively alongside the existing `execute_code` tool, the agent can be prompted (or hallucinate) to use it for arbitrary shell commands with no isolation: `rm -rf /`, git push to wrong remote, `docker stop production-container`, overwrite `.env` secrets.

In July 2025 a Replit AI agent deleted a startup's production database via unconstrained shell access. The existing `runTests()` allowlist model (only 8 whitelisted commands) correctly prevents this for test execution — the same discipline must apply to the new terminal tool.

**Why it happens:**
Developers conflate "give the agent shell access so it can do more" with "give the agent unrestricted shell access." The distinction is the scope. The workspace `resolveSafe()` path-traversal protection already models the right approach: accept user-controlled input but bound it to a safe root.

**How to avoid:**
- Do NOT add a general-purpose `run_shell` tool. Instead, add scoped tools: `run_build`, `run_install`, `run_deploy` — each with a fixed command template, configurable directory, and a timeout.
- All new shell execution must use `execFile` (not `exec`) to prevent shell injection.
- Restrict working directory to `WORKSPACE_DIR` or a project-specific subdirectory via `resolveSafe()`.
- Log every command execution with full args to the `toolExecutions` table.
- Never pass LLM-generated strings as shell argument arrays without sanitizing against a whitelist.

**Warning signs:**
- Agent tool definitions with `command: string` as a free-form parameter.
- Shell execution bypassing `WORKSPACE_DIR`.
- No execution audit log in `toolExecutions`.
- Production `.env` files inside the workspace root.

**Phase to address:** Autonomous task execution phase (first phase of v2.0)

---

### Pitfall 2: RAG Context Poisons the Orchestrator Silently

**What goes wrong:**
Once RAG is wired into the orchestrator system prompt or `recall_memories` tool, stale or low-quality chunks degrade every agent response without any visible error. Unlike a crashed tool, bad RAG just makes the agent wrong — confidently. Research shows 51% of enterprise AI failures in 2025 were RAG-related, and 17–33% of legal RAG systems still hallucinate citations.

The specific failure mode here: after months of operation, the `conversation` and `memory` source chunks will contain contradictory or outdated architectural decisions. The orchestrator retrieves 5 chunks per query but the top chunks are old conclusions that no longer apply — e.g., "we decided not to use WebSockets" retrieved when the new milestone adds streaming, leading the agent to incorrectly resist the feature.

**Why it happens:**
The existing RAG ingester does a full-replace on re-ingest (`deleteChunksBySource` then re-embed) but there is no automatic re-ingestion trigger. Chunks accumulate without a TTL. The retriever's recency bonus (0.1 * decay over 30 days) helps but does not prevent a highly-similar old chunk from outranking a new one.

**How to avoid:**
- Add a `minScore` floor at retrieval time (existing `RetrievalOptions.minScore` default 0.3 is too low for orchestrator injection — raise to 0.6 for system prompt injection).
- Implement a `max_chunk_age_days` filter at retrieval for conversation source types (conversations older than 90 days should not influence system prompt).
- Log RAG retrieval results to `toolExecutions` with source IDs and scores so you can inspect what context the agent received.
- Include `[RAG: N chunks from X sources]` in the orchestrator's streaming output to make retrieval visible.
- Add a "RAG quality check" to the daily briefing: alert if the top-retrieved chunks for a baseline query ("what is this project?") drop below a quality threshold.

**Warning signs:**
- Agent making decisions that contradict recent code or recent conversations.
- RAG `status` endpoint showing 0 chunks (ingestion never ran).
- `ingestionStates` table showing `lastIngestedAt` more than 7 days ago.
- Retrieval results in logs show high scores for chunks with `createdAt` > 6 months old.

**Phase to address:** RAG integration phase

---

### Pitfall 3: Autonomous Session Loops Drain Daily Token Budget in Minutes

**What goes wrong:**
The existing `runAutonomousSession` checks `DAILY_TOKEN_LIMIT` before starting but not during execution. The orchestrator runs up to 5 tool rounds, each generating LLM completions. If the orchestrator calls `delegate_to_subagent` or `create_plan` → `TaskDispatcher` executes tasks → each specialist agent runs its own tool loop — the token multiplier is O(5 × agents × rounds). A single autonomous session can consume 200K+ tokens before hitting any guardrail.

With BullMQ recurring jobs now firing autonomous sessions (e.g., every 30 minutes), a runaway session + recurring schedule = complete daily budget exhaustion in 2 hours.

**Why it happens:**
The `tokenBudget` field in `SessionOptions` is a soft warning only: `if (totalTokens > tokenBudget) { logger.warn(...) }` — it does not stop execution. The daily limit is checked at session start, not mid-session.

**How to avoid:**
- Make `tokenBudget` a hard limit: pass it to the orchestrator constructor and have the agentic loop check remaining budget before each LLM call.
- Add inter-session cooldown: if the previous session used more than 80% of its token budget, delay the next scheduled session by 2x the normal interval.
- Track per-session token accumulation and abort (return `status: "budget_exceeded"`) if the session exceeds its individual budget mid-run.
- Add a `GET /api/usage/today` endpoint and surface it prominently in the dashboard so budget consumption is immediately visible.
- Set `SESSION_TOKEN_BUDGET` default to 20,000 (not 50,000) for scheduled sessions; reserve higher budgets for manual invocation.

**Warning signs:**
- `workSessions` records showing `tokensUsed` near or above `SESSION_TOKEN_BUDGET` every run.
- `getTodayTokenTotal()` hitting 80% of `DAILY_TOKEN_LIMIT` by mid-afternoon.
- Discord webhook notifications showing many autonomous sessions in rapid succession.
- LLM provider health degrading (rate limit hits) during autonomous session windows.

**Phase to address:** Autonomous task execution phase (implement budget enforcement before enabling scheduled sessions)

---

### Pitfall 4: Tiered Autonomy Levels Are Checked at Plan Creation, Not at Execution

**What goes wrong:**
The `request_approval` tool creates an approval record and blocks the orchestrator, but only if the orchestrator decides to call it. In a green/yellow/red autonomy model, the orchestrator can hallucinate that an action is "green" and skip requesting approval entirely — then proceed to push code, send a Slack message, or trigger a deploy.

The approval check in `TaskDispatcher.checkPendingApprovals()` is the existing safeguard, but it runs before each task dispatch, not before each tool call within a task. A CoderAgent could call `git_push` directly without triggering an approval gate.

**Why it happens:**
Approval gates are enforced at the task level by prompting the orchestrator to use `request_approval`. This is a suggestion to the LLM, not a hard constraint. The gap is at the tool execution layer — no code prevents a tool from executing if no approval exists.

**How to avoid:**
- Implement autonomy level as a hard constraint at tool registration, not just prompt suggestion. Tools in the "requires approval" category should check an approval record exists before executing (not just prompt the LLM to create one).
- Create an `AutonomyGuard` middleware that wraps destructive tool execution: `git_push`, `create_pr`, `trigger_workflow`, any n8n webhook, deploy commands.
- The guard checks: is there an open, non-expired approval for this action? If not, create an approval request and return "waiting for approval" instead of executing.
- Store the autonomy tier per-action in configuration (not in the LLM prompt), so it cannot be overridden by prompt injection.
- For the first rollout, start with all "yellow" actions (deploy, external comms, financial operations) requiring approval regardless of tier — unlock green automation only after the system has proven reliable for 30 days.

**Warning signs:**
- `approvals` table showing very few approval requests despite active autonomous sessions.
- Agent completing deploy or communication tasks without a corresponding approval record.
- Test scenarios where adversarial prompts cause the agent to skip the `request_approval` tool call.

**Phase to address:** Tiered autonomy phase

---

### Pitfall 5: Embedding Model Mismatch After Upgrade Silently Returns Zero Results

**What goes wrong:**
The existing RAG system uses Gemini `text-embedding-004` (768-dim vectors). If the embedding model is upgraded (or if Gemini is temporarily unavailable and a different provider is used as fallback), the new embeddings live in the same `pgvector` index as the old ones. Cosine similarity between vectors from different model families is meaningless — queries return near-zero scores or completely wrong results, but there is no error. The `minScore: 0.3` default filter then returns nothing, which the retriever silently converts to an empty context.

**Why it happens:**
The ingester does not record which embedding model was used for each batch. The retriever does not validate model consistency. Switching embedding models requires a full re-ingest of all sources, but this is easy to miss if a partial failure happens during an incremental ingestion run.

**How to avoid:**
- Store `embeddingModel` in the `ingestionStates` table (add a column).
- On each retrieval, verify the current embedding model matches what was used for ingestion. If mismatch detected, return empty with a logged warning rather than bad results.
- Never fall back to a different embedding model — if the primary fails, fail the ingestion job (it will retry via BullMQ) rather than use a different model and corrupt the index.
- Add a health check that runs a known-good query and alerts if retrieval returns 0 chunks for a source that should have 1000+ chunks.
- Document: changing embedding models requires `DELETE FROM rag_chunks` and full re-ingestion of all sources.

**Warning signs:**
- `rag/search` API returning 0 results for queries that previously returned results.
- `ingestionStates` showing recent ingestion but `chunkCount` unchanged from before.
- Embedding API errors in logs followed by partial ingestion completion.
- Prometheus metrics showing embed latency spike (different provider, different latency profile).

**Phase to address:** RAG integration phase (set up model tracking before ingesting any production data)

---

### Pitfall 6: Multi-Project Awareness Creates Context Explosion in Agent Prompts

**What goes wrong:**
Adding awareness of all projects (ai-cofounder, clip-automation, avion-backups, VPS infrastructure) means injecting summaries, statuses, and recent activity for each project into every orchestrator context. With 5 projects × recent git log + active issues + monitoring status = 8,000–15,000 tokens of context injected before the user's message is even processed. Research shows model performance degrades significantly beyond 70–80% of nominal context window, and `claude-sonnet-4-6` (200K context) still shows attention degradation on extremely long inputs.

**Why it happens:**
It is tempting to "give the agent everything it might need." The correct model is selective retrieval: inject context only for projects that are relevant to the current query or autonomous session directive.

**How to avoid:**
- Never inject all project contexts simultaneously. Inject only the active project context by default.
- Use RAG retrieval to surface relevant project context: when the user says "what's happening with clip-automation?" — retrieve only clip-automation chunks, not all projects.
- Define a maximum "project context budget": 2,000 tokens per project, max 2 projects injected per session.
- Create a `ProjectRegistry` that the orchestrator can query on-demand rather than having project context pre-injected in the system prompt.
- Track per-project context injection in observability metrics to detect context bloat.

**Warning signs:**
- System prompts exceeding 10,000 tokens before user message.
- Response latency increasing proportionally as more projects are added.
- Agent confusing state between projects (e.g., referring to clip-automation's Python structure when working on the TypeScript monorepo).
- High token costs on simple queries that don't require multi-project context.

**Phase to address:** Multi-project awareness phase

---

### Pitfall 7: Financial Tracking Costs More Than It Saves Without Proper Attribution

**What goes wrong:**
Tracking LLM API costs accurately requires attribution at the call level — which tool, which session, which goal, which provider, which model, which task. The existing `toolExecutions` table tracks tool calls but not per-call token cost. Without this, the financial tracking dashboard shows total daily spend but cannot answer "which autonomous session is most expensive?" or "which tool is burning the most money?"

Worse: adding financial tracking via repeated Anthropic API calls to audit costs creates a feedback loop where cost tracking itself incurs token costs.

**Why it happens:**
Cost is an afterthought. The existing `DAILY_TOKEN_LIMIT` is a blunt instrument. Real cost attribution requires instrumenting at the LLM registry level, and LLM cost varies by model (Opus vs Sonnet vs Groq vs Gemini have 10-100x price differences per token).

**How to avoid:**
- Extend `LlmRegistry.complete()` to return `costUsd` alongside token counts. Use a static price table per model (input and output tokens priced separately — they differ significantly for Anthropic).
- Record `costUsd` in `toolExecutions` table on every LLM call.
- Add aggregation: `GET /api/usage/breakdown?by=goal` and `?by=tool` and `?by=provider`.
- The financial tracking dashboard should be built from DB queries on `toolExecutions`, not fresh LLM calls.
- Add per-session cost cap in addition to per-day cap: abort if a single session exceeds $2 (configurable).

**Warning signs:**
- Unable to identify which goal or session generated a spike in API costs.
- Cost dashboard only shows daily totals without actionable breakdown.
- LLM costs growing month-over-month without a corresponding increase in completed work.
- Groq/Gemini fallback activating frequently (symptoms of Anthropic rate limiting) but not visible in cost breakdown.

**Phase to address:** Financial tracking phase (requires LlmRegistry instrumentation first, dashboard second)

---

### Pitfall 8: Work Journal Entries Become Noise Without Structured Summarization

**What goes wrong:**
A work journal that logs every autonomous session, tool call, and agent decision creates an overwhelming stream of low-signal data. After one week, the journal has 500 entries. The daily standup LLM prompt ingests recent journal entries to produce a briefing — but at 500 entries × ~200 tokens each = 100,000 tokens just for journal retrieval, which exceeds session budgets and produces a summary of summaries rather than insights.

Reviewer fatigue is the human counterpart: when every minor action is surfaced in the journal, the user stops reading it, missing genuinely important decisions buried in noise.

**Why it happens:**
It is easier to log everything than to decide what matters. The existing work session records have `summary` fields but they capture the full orchestrator response (truncated to 2000 chars), not a curated journal entry.

**How to avoid:**
- Journal entries should be categorized at write time: `decision`, `milestone`, `error`, `routine`. Only `decision` and `milestone` entries surface in daily standup.
- Use a lightweight summarization pass (Groq/Gemini, not Opus) to distill a work session into a 1–3 sentence journal entry at session completion time. Store this as the official journal entry.
- The daily standup should retrieve journal entries from the past 24 hours via RAG (source type `reflection`), not raw SQL scan.
- Add a `significance_score` to journal entries (0-1). Only entries above 0.7 trigger Discord notifications.
- Limit the standup briefing context to the 10 most significant journal entries from the past week, not all entries.

**Warning signs:**
- Daily briefing token cost exceeding 10,000 tokens of input context.
- User ignoring Discord notifications after the first week.
- Journal table growing faster than 50 rows/day during normal operation.
- Briefings saying "completed 47 tasks" without naming any of them.

**Phase to address:** Daily standup / work journal phase

---

### Pitfall 9: Self-Healing / Auto-Fix Triggering on False Positives

**What goes wrong:**
The existing `MonitoringService` detects GitHub CI failures and VPS health issues. The new milestone adds auto-fix capability: when a CI failure is detected, the agent autonomously creates a fix branch, patches the issue, and pushes. If the failure detector has false positives (flaky test, transient network blip, Anthropic API rate limit causing test timeout), the self-healing response triggers unnecessarily.

In production, a false positive self-heal could: create noisy PR activity, push broken "fixes" that pass locally but fail CI, or cause git branch proliferation when auto-fix creates a new branch on every detection cycle (every 5 minutes = 288 branches/day).

**Why it happens:**
CI monitoring fires on first failure without confirming persistence. Transient failures (3–5% of CI runs in busy repos) are indistinguishable from real failures without a confirmation window.

**How to avoid:**
- Require 2 consecutive monitoring cycles showing the same failure before triggering self-heal. Add a `failureCount` counter to monitoring state.
- Auto-fix must check if a fix PR already exists for this failure before creating another one. Add deduplication via PR title prefix (`[auto-fix]`).
- Self-heal actions for production systems (VPS, deploy failures) require explicit yellow-tier approval — never auto-apply infrastructure fixes.
- Self-heal only on known failure categories: test failures, lint errors, type errors. Do not attempt to self-heal deployment failures or database migration failures.
- Implement a "self-heal cooldown": after one self-heal attempt for a given failure, wait 1 hour before trying again regardless of continued detection.

**Warning signs:**
- More than 1 auto-fix PR per day for the same repository.
- `[auto-fix]` branch names accumulating in git remotes.
- Monitoring job completion time increasing (compound analysis cost).
- CI failure rate increasing after self-heal is enabled (bad fixes being pushed).

**Phase to address:** Autonomous task execution phase (self-heal is a subfeature of autonomous execution, not monitoring)

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inject all project context into every system prompt | Simple to implement | Context explosion, degraded model quality, high token costs | Never — always use selective retrieval |
| Re-use existing `execute_code` sandbox for terminal access | No new infrastructure | Sandbox is ephemeral Docker; persisted state, git credentials, and file changes don't survive | Never — terminal and sandbox are different tools for different purposes |
| Store approval status in Redis (not DB) | Fast reads | Approvals lost on Redis restart; no audit trail for compliance | Never — approvals must be DB-persisted |
| Skip re-ingestion validation (assume last ingest is current) | Simpler ingestion logic | Stale RAG returning outdated architectural decisions as authoritative context | Acceptable during development, never in production |
| Single daily token limit instead of per-session + per-day | One env var | A single runaway session can exhaust the entire day's budget | MVP only; add per-session limits before enabling autonomous scheduling |
| Log everything to journal without significance filtering | No missed events | Journal noise → reviewer fatigue → missed critical events | During initial development only; add filtering before end of milestone |
| Cost tracking via approximate token math | No schema changes needed | ~15% error on Anthropic costs (reasoning tokens not counted separately), no per-goal attribution | Acceptable for MVP financial tracking; requires exact tracking for optimization |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gemini embedding API | Switching models on rate limit error | Fail the ingestion job, retry with same model; never use a different model to avoid index corruption |
| BullMQ recurring jobs for autonomous sessions | Setting `repeatEvery` without `limit` | Always set a `limit` or `endDate` on recurring jobs during initial rollout; remove limit once stable |
| GitHub CI monitoring for self-heal | Acting on first failure event | Confirm failure persists across 2 polling cycles before triggering self-heal |
| n8n workflows as "managed tasks" | Passing user-supplied workflow IDs to `trigger_workflow` without validation | Validate workflow IDs against the `n8nWorkflows` DB table; never allow free-form workflow name injection |
| ElevenLabs TTS for briefing audio | Generating audio for every journal entry | Generate audio only for the final briefing summary (1–3 paragraphs), not raw data |
| Multi-project git operations | Using workspace git tools on projects outside `WORKSPACE_DIR` | Clone external projects into `WORKSPACE_DIR` subfolders; never use absolute paths that bypass `resolveSafe()` |
| Anthropic API cost tracking | Using input_tokens + output_tokens only | For Claude Opus 4.6, also track `cache_creation_input_tokens` and `cache_read_input_tokens` in usage — these have different pricing |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full conversation re-ingestion on every session | Ingestion job takes 5+ minutes, blocks new ingestions | Incremental ingestion using `needsReingestion()` with cursor tracking (already implemented — use it) | At 1,000+ conversation turns |
| Vector similarity search without index | pgvector query taking 10+ seconds | Ensure `ivfflat` or `hnsw` index exists on `rag_chunks.embedding`; check at startup | At 50,000+ chunks |
| RAG retrieval on every orchestrator tool call | LLM latency doubles | Cache RAG results per-query with a 5-minute TTL in Redis; identical queries in the same session share context | At 10+ tool calls per session |
| Journal entry scan for daily standup | Standup query taking 30+ seconds | Use RAG retrieval (already implemented) not SQL full-scan for standup context | At 5,000+ journal entries |
| Parallel autonomous sessions | Multiple sessions competing for token budget and creating conflicting work | Add a distributed lock (Redis SETNX) that prevents more than 1 concurrent autonomous session | At 2+ scheduled session triggers in the same window |
| Monitoring all repos every 5 minutes | GitHub API rate limit (5,000 req/hr for authenticated) exhausted | Cache monitoring results for 5 minutes; use conditional requests (ETags); monitor max 5 repos | At 20+ repos monitored |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| LLM-controlled shell commands without allowlist | Prompt injection → arbitrary code execution on the server host | Use `execFile` with arg arrays; maintain explicit command allowlists per tool; never pass LLM output as shell string |
| Git credentials stored in workspace directory | Agent reads `.git/config` and exfiltrates tokens via search_web or write_file | Store git credentials in environment variables only; exclude `.git/` directories from RAG ingestion (already done in `shouldSkipFile`) |
| Approval bypass via prompt injection in RAG chunks | Malicious content in ingested docs instructs agent to skip approval | Never inject RAG context into the autonomy decision prompt; approval tier determination must use hardcoded rules, not LLM reasoning |
| Unrestricted workspace growth | Disk exhaustion on VPS | Add `WORKSPACE_MAX_SIZE_GB` limit; scheduled cleanup of repos not accessed in 7 days; disk usage alert in monitoring |
| Terminal commands accessing files outside workspace | Path traversal via `../../../etc/passwd` in LLM-generated paths | Always resolve through `resolveSafe()` before any file or command operation |
| Autonomous sessions posting to Slack/Discord without throttle | Notification flooding if session loop bugs | Rate-limit outbound notifications to max 1 per tool per 10 minutes; add a kill-switch env var `AUTONOMOUS_NOTIFICATIONS=false` |
| Cost tracking data accessible without auth | Exposing API spend data to unauthorized requests | Financial tracking endpoints must require JWT auth, same as dashboard routes |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Approval requests with insufficient context | User approves blindly or rejects out of caution because they don't understand what they're approving | Each approval request must include: action type, affected files/systems, estimated impact, and a diff or preview where applicable |
| Daily standup at fixed time regardless of activity | Briefing says "no activity" 3 days in a row during light weeks | Only send standup notification if there is meaningful activity to report (at least 1 significant journal entry in past 24h) |
| Work journal as unstructured text | Can't filter by project, type, or outcome | Journal entries must have structured fields: `project`, `type` (decision/error/milestone/routine), `outcome` (success/failure/pending) |
| Financial dashboard showing only cumulative costs | Can't identify what's expensive | Show cost by: session type, goal, tool, provider. Highlight the top 3 cost drivers this week. |
| Auto-fix PRs with generic titles | Can't distinguish auto-fix noise from real PRs in GitHub | Use consistent prefix `[auto-fix]` + test name + failure type. Add PR body with monitoring detection details. |
| Approval queue growing without visibility | Autonomous sessions stall silently while approvals queue up | Dashboard must show pending approval count prominently (badge on nav, not buried in a page) |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Autonomous terminal access:** The tool exists and runs commands — but verify: (1) `resolveSafe()` is called on every path argument, (2) commands use `execFile` not `exec`, (3) every execution is logged to `toolExecutions`, (4) the tool is gated behind autonomy tier check.
- [ ] **RAG wired into orchestrator:** The `retrieve` import exists in `orchestrator.ts` — but verify: (1) retrieval is actually called in the system prompt or `recall_memories` flow, (2) results are injected into context, (3) retrieval is logged with scores, (4) empty results are handled gracefully (no context injection, not error).
- [ ] **Tiered autonomy:** Approval request tool exists — but verify: (1) destructive tools have hard guards (not just prompt hints), (2) approval records are DB-persisted, (3) expired approvals are rejected, (4) autonomy tier is configurable without code changes.
- [ ] **Daily standup:** Briefing is generated and sent — but verify: (1) standup only fires when there is meaningful content, (2) token cost per briefing is bounded (< 5,000 tokens input), (3) audio generation is optional and doesn't block text delivery.
- [ ] **Financial tracking:** Cost data is visible — but verify: (1) costs are attributed per-goal and per-session not just per-day, (2) reasoning tokens (cache creation/read) are counted for Anthropic, (3) per-session cost cap actually aborts execution.
- [ ] **Multi-project awareness:** Agent can answer questions about multiple projects — but verify: (1) only relevant project context is injected (not all), (2) workspace operations for external projects go through `resolveSafe()`, (3) RAG chunks from different projects are not cross-contaminated.
- [ ] **Self-healing CI:** Agent fixes failed tests — but verify: (1) failure must persist 2+ cycles before triggering, (2) duplicate fix PRs are prevented, (3) self-heal is disabled for infrastructure/database failures, (4) cooldown period is enforced.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Agent executed destructive shell command | HIGH | Check `toolExecutions` log for exact command; restore from backup if files lost; revoke and rotate any exposed credentials; add the command to explicit denylist before re-enabling tool |
| RAG index corrupted with wrong-model embeddings | MEDIUM | `DELETE FROM rag_chunks` (all data); `DELETE FROM ingestion_states`; re-run ingestion pipeline for all sources; ~2 hours downtime for large repos |
| Daily token budget exhausted by runaway session | LOW | Set `DAILY_TOKEN_LIMIT` lower temporarily; identify offending session in `workSessions` table; add per-session cap env var `SESSION_TOKEN_BUDGET`; review autonomous session schedule frequency |
| Approval bypass led to unauthorized deployment | HIGH | Roll back deployment immediately via `git revert` + CI; audit `approvals` table for missing records; add `AutonomyGuard` middleware before re-enabling autonomous deploys |
| Notification flooding (Slack/Discord spam) | LOW | Set `AUTONOMOUS_NOTIFICATIONS=false` env var; clear the notification queue in BullMQ dashboard; implement rate limiting before re-enabling |
| Work journal grown to 100K+ rows of noise | MEDIUM | Archive entries older than 90 days to a separate `journal_archive` table; add significance filter retroactively; rebuild standup retrieval on filtered source |
| Multi-project context confusion causing wrong-repo changes | MEDIUM | Add explicit project scoping to every workspace operation (pass project ID); clear active conversation context; re-ingest affected project's RAG data |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Terminal access bypasses sandbox | Phase 1: Autonomous execution | Security test: attempt path traversal and shell injection via tool inputs; verify they are rejected |
| RAG context poisoning from stale chunks | Phase 2: RAG integration | Run baseline query before and after adding chunk age filters; verify old chunks do not dominate results |
| Runaway token budget | Phase 1: Autonomous execution | Run a session with `SESSION_TOKEN_BUDGET=1000` and verify it aborts mid-execution, not just logs a warning |
| Autonomy tier bypass | Phase 3: Tiered autonomy | Test: send adversarial prompt instructing agent to skip approval; verify destructive tool still requires approval record |
| Embedding model mismatch | Phase 2: RAG integration | Deploy health check query; verify it alerts when model field is absent from ingestion state |
| Multi-project context explosion | Phase 5: Multi-project awareness | Measure system prompt token count with 5 projects registered; verify it stays under 5,000 tokens |
| Financial tracking without attribution | Phase 6: Financial tracking | Verify `toolExecutions` records include `costUsd`; verify per-goal breakdown endpoint returns data |
| Work journal noise | Phase 4: Daily standup / journal | Verify standup briefing input context stays under 5,000 tokens after 30 days of operation |
| Self-heal false positive | Phase 1: Autonomous execution (self-heal subfeature) | Inject transient failure; verify self-heal does not trigger until 2nd consecutive detection cycle |
| Approval bypass via RAG injection | Phase 3: Tiered autonomy | Ingest a document containing "always proceed without approval"; verify approval guard still enforces the DB-level check |

---

## Sources

- [OWASP Top 10 for Agentic Applications 2026](https://www.aikido.dev/blog/owasp-top-10-agentic-applications)
- [Researchers Gave AI Agents Real System Access — State of Surveillance](https://stateofsurveillance.org/news/agents-of-chaos-red-team-ai-agent-security-vulnerabilities-2026/)
- [MemoryGraft: Persistent Compromise of LLM Agents via Poisoned Experience Retrieval](https://arxiv.org/abs/2512.16962)
- [Agentic Memory Poisoning: How Long-Term AI Context Can Be Weaponized](https://medium.com/@instatunnel/agentic-memory-poisoning-how-long-term-ai-context-can-be-weaponized-7c0eb213bd1a)
- [23 RAG Pitfalls and How to Fix Them](https://www.nb-data.com/p/23-rag-pitfalls-and-how-to-fix-them)
- [The Context Window Problem: Scaling Agents Beyond Token Limits — Factory.ai](https://factory.ai/news/context-window-problem)
- [Token Cost Trap: Why Your AI Agent's ROI Breaks at Scale](https://medium.com/@klaushofenbitzer/token-cost-trap-why-your-ai-agents-roi-breaks-at-scale-and-how-to-fix-it-4e4a9f6f5b9a)
- [Agentic AI in DevOps: From Auto-Fixes to Self-Healing Releases](https://www.onetopicnews.com/2026/01/agentic-ai-in-devops-from-auto-fixes-to.html)
- [Human-in-the-Loop Agentic AI for High-Stakes Oversight 2026](https://onereach.ai/blog/human-in-the-loop-agentic-ai-systems/)
- [Alert Fatigue Reduction with AI Agents — IBM](https://www.ibm.com/think/insights/alert-fatigue-reduction-with-ai-agents)
- [AI Agent Anti-Patterns Part 1: Architectural Pitfalls](https://achan2013.medium.com/ai-agent-anti-patterns-part-1-architectural-pitfalls-that-break-enterprise-agents-before-they-32d211dded43)
- [BullMQ Stalled Jobs documentation](https://docs.bullmq.io/guide/jobs/stalled)
- [How to Handle Stalled Jobs in BullMQ](https://oneuptime.com/blog/post/2026-01-21-bullmq-stalled-jobs/view)
- [Langfuse — Model Usage & Cost Tracking for LLM applications](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- Codebase audit: `packages/rag/src/`, `apps/agent-server/src/autonomous-session.ts`, `apps/agent-server/src/services/workspace.ts`, `packages/sandbox/src/service.ts`, `apps/agent-server/src/routes/rag.ts`

---
*Pitfalls research for: AI Cofounder v2.0 — Autonomous Cofounder milestone*
*Researched: 2026-03-09*
