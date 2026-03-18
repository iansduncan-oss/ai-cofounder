# v3.1 Milestone Planning

Plan the next milestone for AI Cofounder. v3.0 is complete — this defines what comes next.

> **Deep research available:** See `.claude/prompts/v31-deep-research.md` for comprehensive analysis of 100+ upgrade possibilities with TypeScript/SQL implementation details, priority matrix, and suggested milestone phasing.

## Steps

1. **Review current state** — Read `.claude/primer.md`, MEMORY.md, and recent git log to understand where the project stands.

2. **Review deep research** — Skim `.claude/prompts/v31-deep-research.md` for the priority matrix (end of document). This contains Tier 1-4 prioritized features with effort/impact ratings.

3. **Identify candidate features** — Consider these areas (with specific options from research):

   **Agent Intelligence** (biggest ROI)
   - Reasoning traces — `<thinking>` tags logged + visible in dashboard for debugging
   - Tool precondition validation — hide unavailable tools, save 20% tokens
   - Tool result caching — avoid redundant searches/reads within a conversation
   - Tool efficacy tracking — bias toward faster/cheaper tools
   - Dynamic replanning — auto-recover from task failures mid-DAG
   - Multi-agent debate — generator→critic→refinement loops for critical outputs
   - Self-improvement — failure pattern DB, procedural memory, meta-prompting
   - Tree-of-thoughts — generate multiple plans, score, select best

   **RAG & Knowledge** (second biggest ROI)
   - Hybrid search — BM25 + vector with RRF (PostgreSQL native, ~49% better retrieval)
   - Reranking — LLM-based or cross-encoder second stage
   - Agentic RAG — orchestrator decides when/what to retrieve iteratively
   - Contextual retrieval — prepend chunk context before embedding (~67% improvement)
   - Document file watchers — auto re-ingest on changes
   - GraphRAG / Knowledge graphs — entity extraction + relation tracking
   - RAG evaluation — RAGAS metrics for automated quality testing

   **Memory System**
   - Episodic memory — session summaries with key decisions, temporal indexing
   - Procedural memory — learned workflows from successful executions
   - Memory TTL & decay — temporal decay functions, consolidation, archival
   - Cross-project transfer — shared vs project-specific memory stores
   - In-context learning — dynamic few-shot examples from past successes

   **Dashboard & UX**
   - Execution replay — step-by-step playback with reasoning traces
   - DAG visualization — React Flow + ELK auto-layout for task dependencies
   - AI-powered queries — NL search ("show me failed goals this week")
   - Embedded terminal (xterm.js) + code editor (Monaco)
   - PWA + push notifications for mobile
   - 20+ unexposed backend features (RAG management, decision audit trail, etc.)
   - Theme toggle (dark/light)

   **Voice & Multimodal**
   - WebSocket bidirectional audio (replace POST-based SSE)
   - Pipecat framework for pipeline orchestration
   - Interruption handling and turn-taking
   - Vision — screenshot/image understanding for debugging
   - Ambient/proactive voice (agent initiates on events)

   **Security & Observability**
   - OpenTelemetry GenAI conventions — industry-standard tracing
   - Self-hosted Langfuse — prompt versioning, evaluation
   - Dynamic permission engine — context-aware tool authorization
   - Hardened Docker sandbox (seccomp, cap_drop, gVisor)
   - Per-trace cost attribution

   **Platform & Interop**
   - Claude Agent SDK — replace custom agent loop with production-hardened SDK
   - A2A Protocol — agent-to-agent interoperability standard
   - MCP Streamable HTTP — remote MCP access with OAuth 2.1
   - GitHub PR review bot + issue triage
   - Bot command expansion (11+ missing commands)
   - New platforms — Telegram, Linear, Calendar integration

   **Experimental**
   - Neuromorphic anomaly detection (snnTorch)
   - Computer use / GUI automation
   - Self-modifying agents
   - 3D topology visualization (React Three Fiber)
   - Digital twin infrastructure simulation
   - Reservoir computing for predictive monitoring

4. **Prioritize with user** — Present the candidates grouped by theme. Ask the user to pick 3-5 items for v3.1 scope. Don't over-scope — a focused milestone ships faster. Reference the Tier system from the research doc.

5. **Write the roadmap** — Create `.planning/milestones/v3.1-REQUIREMENTS.md` and `v3.1-ROADMAP.md` with:
   - Milestone goal (one sentence)
   - Phases with clear deliverables
   - Dependencies between phases
   - Success criteria for each phase

6. **Update project files** — Update MEMORY.md and primer with the new milestone info.

7. **Commit** — Commit the roadmap and updated docs.
