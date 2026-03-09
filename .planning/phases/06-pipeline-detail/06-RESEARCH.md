# Phase 6: Pipeline Detail - Research

**Researched:** 2026-03-09
**Domain:** React dashboard — TanStack Query polling, expand/collapse stage rows, pipeline data rendering
**Confidence:** HIGH

## Summary

Phase 6 builds the full pipeline detail page by replacing the Phase 5 stub in `pipeline-detail.tsx`. All foundational work is already done: the `usePipeline` hook exists with 5-second auto-refresh built in, the `PipelineDetail` type is defined in the API client, the `StageProgress` and `StageIcon` components were extracted to `components/pipelines/stage-progress.tsx` in Phase 5, and the `PipelineStateBadge` is exported from `pipelines.tsx`. The backend `GET /api/pipelines/:jobId` returns full stage definitions plus stage results from `job.returnvalue`.

The core design challenge is the stage list with expandable output text. Each stage row displays a status icon, agent name, and duration inline. Clicking a row expands it to show output text and any error message. A `useState` set (or a single expanded-index state) tracks which stages are expanded. The overall metadata card (state, goal link, timestamps) should render above the stage list.

**Primary recommendation:** Rewrite `pipeline-detail.tsx` in one task, add a second task for tests. Reuse `StageIcon` from `stage-progress.tsx`, `PipelineStateBadge` from `pipelines.tsx`, `formatDuration` (duplicate locally or import from a shared location), `formatDate` from `@/lib/utils`, and `RelativeTime` from `@/components/common/relative-time`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DETAIL-01 | User can view a pipeline's stages with per-stage status indicators (pending, active, completed, failed, skipped) | `StageIcon` component already in `stage-progress.tsx` covers all 5 statuses. Status is derived from `result.stageResults` (completed/failed/skipped) + `currentStage` field (active) + default pending. |
| DETAIL-02 | User can expand a stage to see its output text and error details | `useState` toggle per stage index; `result.stageResults[i].output` and `.error` from `PipelineDetail.result.stageResults`. Output may be long text — use `<pre>` or `<p className="whitespace-pre-wrap">`. |
| DETAIL-03 | User can see timing information for each completed stage | Stage-level timing is NOT returned by the backend — no per-stage timestamps exist. The overall pipeline duration is available (`finishedAt - createdAt`). Per-stage duration cannot be shown. Planner must scope DETAIL-03 to overall pipeline duration displayed on the metadata card, or the requirement needs to be interpreted as "each completed stage shows the pipeline duration" — the safest approach is to display overall pipeline duration in the metadata section and note per-stage timing is unavailable from backend data. |
| DETAIL-04 | User can see the pipeline's overall state, goal link, and created/finished timestamps | `PipelineDetail` has `state`, `goalId`, `createdAt`, `finishedAt`. `goalId` can link to `/dashboard/goals` (no goal detail route currently, so just display the ID). |
| DETAIL-05 | User can see active pipeline details auto-refresh every 5 seconds | `usePipeline` hook already implements `refetchInterval: 5_000` (stops when state is `completed` or `failed`). No new code needed for this requirement. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component rendering | Already in project |
| TanStack Query | 5.x | Server state + polling | `usePipeline` hook already handles refetchInterval |
| React Router | 7.x | `useParams`, `Link` | Already used in `pipeline-detail.tsx` |
| Tailwind CSS v4 | 4.x | Styling | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | latest | Icons (ChevronDown, ChevronRight, AlertTriangle, ArrowLeft, Clock, Check, X, SkipForward, Loader2) | Icon components |
| `@ai-cofounder/api-client` | workspace | Types: `PipelineDetail`, `PipelineStageDefinition`, `PipelineStageResult`, `PipelineRunState` | All type imports |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `useState` expand/collapse | accordion UI component | No accordion in project UI lib; `useState` is simpler and already used in goals detail |
| Per-stage duration from backend | Not available | Backend does not persist per-stage start/end times in BullMQ job data |

**Installation:** No new packages needed — all dependencies already installed.

## Architecture Patterns

### Recommended Project Structure
```
apps/dashboard/src/
├── routes/
│   └── pipeline-detail.tsx          # Full implementation (replace stub)
├── components/pipelines/
│   └── stage-progress.tsx           # Already exists — StageIcon + StageProgress
└── __tests__/pages/
    └── pipeline-detail.test.tsx     # New test file
```

### Pattern 1: Detail Page with Metadata Card + Stage List
**What:** A two-section layout — metadata card at top, stage list below.
**When to use:** Any entity detail page with a list of child items.
**Example:**
```typescript
// Source: apps/dashboard/src/routes/pipeline-detail.tsx (existing stub)
// Extend the data-loaded section to two cards:
{data && (
  <div className="space-y-4">
    {/* Metadata card */}
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <PipelineStateBadge state={data.state} />
          <span className="text-sm text-muted-foreground">
            {data.stages.length} stage{data.stages.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Goal: <span className="font-mono">{data.goalId.slice(0, 8)}</span></p>
          {data.createdAt && <p>Created: {formatDate(data.createdAt)}</p>}
          {data.finishedAt && data.createdAt && (
            <p>Duration: {formatDuration(data.createdAt, data.finishedAt)}</p>
          )}
          {data.finishedAt && <p>Finished: {formatDate(data.finishedAt)}</p>}
          {data.failedReason && (
            <p className="text-destructive">Error: {data.failedReason}</p>
          )}
        </div>
      </CardContent>
    </Card>

    {/* Stage list */}
    <div className="space-y-2">
      {data.stages.map((stage, i) => (
        <StageRow key={i} ... />
      ))}
    </div>
  </div>
)}
```

### Pattern 2: Expand/Collapse Stage Row
**What:** Each stage row has a click handler that toggles a local state set.
**When to use:** When output text can be large and should be hidden by default.
**Example:**
```typescript
// Source: goal-detail.tsx pattern adapted for stages
const [expanded, setExpanded] = useState<Set<number>>(new Set());

function toggleStage(i: number) {
  setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
}

// Stage row:
<div
  role="button"
  aria-expanded={expanded.has(i)}
  onClick={() => toggleStage(i)}
  className="flex items-center justify-between cursor-pointer rounded-lg border bg-card p-3 hover:bg-accent transition-colors"
>
  <div className="flex items-center gap-2">
    <StageIcon status={derivedStatus} />
    <span className="text-sm font-medium capitalize">{stage.agent}</span>
    {stageResult?.status === "completed" && (
      <span className="text-xs text-muted-foreground">completed</span>
    )}
  </div>
  {expanded.has(i) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
</div>

{expanded.has(i) && (stageResult?.output || stageResult?.error) && (
  <div className="rounded-b-lg border-x border-b bg-muted/50 px-3 pb-3 pt-2">
    {stageResult.output && (
      <p className="whitespace-pre-wrap text-xs font-mono">{stageResult.output}</p>
    )}
    {stageResult.error && (
      <p className="whitespace-pre-wrap text-xs text-destructive">{stageResult.error}</p>
    )}
  </div>
)}
```

### Pattern 3: Deriving Stage Status
**What:** Map stage index to a status enum from backend data.
**When to use:** Every stage row needs to know its visual state.
**Example:**
```typescript
// Source: apps/dashboard/src/components/pipelines/stage-progress.tsx (existing)
// The same logic used in StageProgress should be replicated for the detail rows
const resultMap = new Map(data.result?.stageResults?.map((r) => [r.stageIndex, r]));

function getStageStatus(i: number): "completed" | "failed" | "skipped" | "active" | "pending" {
  const result = resultMap.get(i);
  if (result) return result.status;
  if (data.state === "active" && i === data.currentStage) return "active";
  return "pending";
}
```

### Pattern 4: Auto-Refresh Indicator
**What:** Show "Auto-refreshing every 5s" when the pipeline is still active.
**When to use:** Active pipelines only — stop showing once completed/failed.
**Example:**
```typescript
// Conditionally render below the page header:
{(data?.state === "active" || data?.state === "waiting") && (
  <p className="mb-4 text-xs text-muted-foreground">Auto-refreshing every 5s</p>
)}
```

### Anti-Patterns to Avoid
- **Importing `formatDuration` from `pipelines.tsx`:** That function is not exported. Duplicate it locally in `pipeline-detail.tsx` (or extract to a shared utility — but duplication is simpler for now).
- **Relying on per-stage timing from backend:** The `PipelineDetail` type has no per-stage `startedAt`/`finishedAt`. DETAIL-03 must use overall pipeline duration on the metadata card.
- **Rendering `StageProgress` (mini icon strip) from `stage-progress.tsx`:** That component is for the list page's compact row view. The detail page needs full stage rows with expand/collapse, not the mini strip.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stage status icons | Custom icon logic | `StageIcon` from `@/components/pipelines/stage-progress.tsx` | Already covers all 5 statuses (pending, active, completed, failed, skipped) with correct colors |
| State badge | New badge component | `PipelineStateBadge` exported from `@/routes/pipelines` | Already covers all 5 pipeline run states |
| Date formatting | Custom date formatter | `formatDate` from `@/lib/utils` | Already in project, returns localized date string |
| Relative time display | Custom relative time | `RelativeTime` from `@/components/common/relative-time` | Live-updating component that ticks every 60s |
| Polling / auto-refresh | Manual interval | `usePipeline` hook — already has `refetchInterval: 5_000` | Stops polling automatically on terminal states |

**Key insight:** Nearly all building blocks exist. Phase 6 is primarily composition work — wiring existing components and data types into a fuller layout.

## Common Pitfalls

### Pitfall 1: Stage Results vs Stage Definitions
**What goes wrong:** `data.stages` is the list of `PipelineStageDefinition[]` (agent + prompt + dependsOnPrevious). `data.result?.stageResults` is `PipelineStageResult[]` (stageIndex + agent + status + output + error). Conflating these two arrays will crash or render incorrectly.
**Why it happens:** The data model has two separate arrays. `stages` is always present; `result` is null until the pipeline finishes.
**How to avoid:** Always index into `stageResults` by `stageIndex`, not by array position directly. Build a `Map<number, PipelineStageResult>` keyed by `stageIndex`.
**Warning signs:** TypeScript error accessing `.output` on a `PipelineStageDefinition`.

### Pitfall 2: Null `result` on Active Pipelines
**What goes wrong:** `data.result` is null while the pipeline is running. Accessing `data.result.stageResults` throws.
**Why it happens:** BullMQ's `job.returnvalue` is null until the worker completes.
**How to avoid:** Always use optional chaining: `data.result?.stageResults ?? []`.
**Warning signs:** Runtime error "Cannot read properties of null".

### Pitfall 3: `currentStage` Is Index, Not Count
**What goes wrong:** Displaying "Stage 1 of 3" using `currentStage` directly. `currentStage: 0` means stage index 0, i.e., the first stage is active.
**Why it happens:** Off-by-one interpretation.
**How to avoid:** When displaying as human-readable: `Stage ${data.currentStage + 1} of ${data.stages.length}`.

### Pitfall 4: Circular Import from `pipelines.tsx`
**What goes wrong:** `pipeline-detail.tsx` already imports `PipelineStateBadge` from `@/routes/pipelines`. That import is fine. But if someone moves `formatDuration` to `pipelines.tsx` and tries to import it from there, they create a route importing from another route.
**Why it happens:** Phase 5 deliberately kept `formatDuration` private in `pipelines.tsx`.
**How to avoid:** Duplicate `formatDuration` in `pipeline-detail.tsx` rather than importing from the sibling route file. Or extract to `@/lib/utils`.

### Pitfall 5: Test Needs `usePipeline` Mock (Not `useListPipelines`)
**What goes wrong:** Test file sets up `useListPipelines` mock but `PipelineDetailPage` calls `usePipeline(jobId)`.
**Why it happens:** The detail and list pages use different hooks.
**How to avoid:** The `vi.mock("@/api/queries")` block in the detail test must export `usePipeline`, not `useListPipelines`. The existing `pipelines.test.tsx` already mocks `usePipeline` in its `vi.mock` block (even though it doesn't use it) — follow that exact pattern.

### Pitfall 6: `useParams` Returns `undefined` in Tests Without Route Context
**What goes wrong:** `jobId` is `undefined` and `usePipeline(null)` is called, so the query is disabled and nothing renders.
**Why it happens:** `renderWithProviders` uses `MemoryRouter` but `useParams` only resolves when a route with `:jobId` parameter is matched.
**How to avoid:** In tests, either: (a) mock `useParams` to return `{ jobId: "test-job-id" }`, or (b) mock `usePipeline` directly and not rely on `useParams` resolving. Pattern (b) is consistent with how `pipelines.test.tsx` mocks at the query level.

## Code Examples

Verified patterns from project source:

### Deriving per-stage status (adapted from stage-progress.tsx)
```typescript
// Source: apps/dashboard/src/components/pipelines/stage-progress.tsx
const resultMap = new Map(data.result?.stageResults?.map((r) => [r.stageIndex, r]) ?? []);

function getStageStatus(i: number): "completed" | "failed" | "skipped" | "active" | "pending" {
  const result = resultMap.get(i);
  if (result) return result.status;
  if (data.state === "active" && i === data.currentStage) return "active";
  return "pending";
}
```

### usePipeline hook (already exists in queries.ts)
```typescript
// Source: apps/dashboard/src/api/queries.ts
export function usePipeline(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.pipelines.detail(jobId ?? ""),
    queryFn: () => apiClient.getPipeline(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "completed" || state === "failed") return false;
      return 5_000;
    },
  });
}
```

### Test mock pattern (from pipelines.test.tsx)
```typescript
// Source: apps/dashboard/src/__tests__/pages/pipelines.test.tsx
vi.mock("@/api/queries", () => ({
  useListPipelines: vi.fn(),
  usePipeline: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useSubmitGoalPipeline: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

import { usePipeline } from "@/api/queries";
const mockUsePipeline = vi.mocked(usePipeline);

// In beforeEach:
mockUsePipeline.mockReturnValue({
  data: mockPipelineDetail,
  isLoading: false,
  error: null,
} as unknown as ReturnType<typeof usePipeline>);
```

### Mock PipelineDetail shape
```typescript
// Based on PipelineDetail type in packages/api-client/src/types.ts
const mockPipelineDetail = {
  jobId: "job-test-1234",
  pipelineId: "pipe-test-abcdef12",
  goalId: "goal-test-abcdef12",
  stages: [
    { agent: "planner", prompt: "Create a plan", dependsOnPrevious: false },
    { agent: "coder", prompt: "Implement the plan", dependsOnPrevious: true },
    { agent: "reviewer", prompt: "Review the code", dependsOnPrevious: true },
  ],
  currentStage: 3,
  context: {},
  state: "completed" as const,
  createdAt: "2026-03-09T10:00:00Z",
  finishedAt: "2026-03-09T10:05:30Z",
  failedReason: null,
  result: {
    pipelineId: "pipe-test-abcdef12",
    goalId: "goal-test-abcdef12",
    status: "completed" as const,
    stageResults: [
      { stageIndex: 0, agent: "planner", status: "completed", output: "Here is the plan..." },
      { stageIndex: 1, agent: "coder", status: "completed", output: "Here is the code..." },
      { stageIndex: 2, agent: "reviewer", status: "completed", output: "LGTM" },
    ],
  },
};
```

### formatDuration (duplicate from pipelines.tsx)
```typescript
// Source: apps/dashboard/src/routes/pipelines.tsx (private function — duplicate, don't import)
function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 5 stub (placeholder text) | Full detail with stage rows + expand/collapse | Phase 6 | Replaces the "coming in Phase 6" placeholder |
| Per-stage timing (not available) | Overall pipeline duration only | n/a | Backend does not persist per-stage timestamps |

**Deprecated/outdated:**
- The "Detailed stage view coming in Phase 6" placeholder text in `pipeline-detail.tsx` must be removed and replaced with the real implementation.

## Open Questions

1. **DETAIL-03 interpretation: per-stage vs overall timing**
   - What we know: Backend returns no per-stage timestamps. `PipelineStageResult` has no `startedAt`/`finishedAt`. Only overall `createdAt`/`finishedAt` on the job.
   - What's unclear: Does the requirement intend to show per-stage duration or overall pipeline duration per completed stage row?
   - Recommendation: Interpret DETAIL-03 as "duration information is shown for completed pipelines" — display overall pipeline duration in the metadata card. Mark per-stage timing as N/A inline. This satisfies the spirit of the requirement with available data.

2. **Goal link from detail page**
   - What we know: `PipelineDetail` includes `goalId`. There is a `GoalDetailPage` at `/dashboard/goals/:id` (from `goal-detail.tsx`).
   - What's unclear: Should the goal ID link to the goal detail page or just display as text?
   - Recommendation: Render `goalId` as a `Link` to `/dashboard/goals/${data.goalId}` for navigability (DETAIL-04 says "linked goal reference").

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace config) |
| Config file | `vitest.config.ts` at root — dashboard uses its own `vitest.config.ts` via `npm test -w @ai-cofounder/dashboard` |
| Quick run command | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx --reporter=verbose` |
| Full suite command | `npm test -w @ai-cofounder/dashboard` |
| Estimated runtime | ~5-10 seconds |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETAIL-01 | Each stage shows the correct status indicator | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows stage status"` | ❌ Wave 0 gap |
| DETAIL-02 | Clicking a stage expands to show output/error | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "expands stage"` | ❌ Wave 0 gap |
| DETAIL-03 | Completed pipeline shows duration in metadata | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows duration"` | ❌ Wave 0 gap |
| DETAIL-04 | Metadata card shows state, goal link, timestamps | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows metadata"` | ❌ Wave 0 gap |
| DETAIL-05 | Auto-refresh indicator visible for active pipelines | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "auto-refresh"` | ❌ Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx --reporter=verbose`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~5 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx` — covers DETAIL-01 through DETAIL-05

*(All other test infrastructure exists — `test-utils.tsx`, `setup.ts`, vitest globals are configured)*

## Sources

### Primary (HIGH confidence)
- `apps/dashboard/src/routes/pipeline-detail.tsx` — existing Phase 5 stub (direct file read)
- `apps/dashboard/src/routes/pipelines.tsx` — existing Phase 5 list page with `PipelineStateBadge`, `formatDuration`, expand patterns (direct file read)
- `apps/dashboard/src/components/pipelines/stage-progress.tsx` — `StageIcon` + `StageProgress` components (direct file read)
- `packages/api-client/src/types.ts` — `PipelineDetail`, `PipelineStageDefinition`, `PipelineStageResult` types (direct file read)
- `apps/dashboard/src/api/queries.ts` — `usePipeline` hook with `refetchInterval: 5_000` (direct file read)
- `apps/agent-server/src/routes/pipeline.ts` — backend detail endpoint data shape (direct file read)

### Secondary (MEDIUM confidence)
- `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` — test patterns, mock setup, `renderWithProviders` usage (direct file read)
- `apps/dashboard/src/__tests__/pages/overview.test.tsx` — baseline test pattern comparison (direct file read)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed by direct file inspection
- Architecture: HIGH — based on existing Phase 5 implementation and data types
- Pitfalls: HIGH — derived from actual type definitions and existing code patterns
- Validation: HIGH — test infrastructure confirmed present

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable codebase, no rapidly moving dependencies)
