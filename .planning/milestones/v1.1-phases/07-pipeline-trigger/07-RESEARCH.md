# Phase 7: Pipeline Trigger - Research

**Researched:** 2026-03-09
**Domain:** React dashboard form UX — TanStack Query mutations, React Router navigation, controlled multi-step form state
**Confidence:** HIGH

## Summary

Phase 7 completes the pipeline dashboard by adding the ability to submit new runs. The backend is already fully implemented: `POST /api/pipelines` (custom stages) and `POST /api/pipelines/goal/:goalId` (standard 3-stage shortcut) both exist in `apps/agent-server/src/routes/pipeline.ts`. The ApiClient already has `submitPipeline()` and `submitGoalPipeline()`. The `SubmitPipelineResponse` type returns `{ jobId, status, stageCount }`.

The existing `SubmitPipelineDialog` in `pipelines.tsx` is a skeleton that only covers goal-ID input for the goal-based shortcut. It does NOT satisfy the requirements: it doesn't navigate to the new run after submission (TRIGGER-04), it doesn't show the job ID on success (TRIGGER-03), and it lacks the custom stage builder (TRIGGER-02). The goal-based form asks for a raw UUID — the requirements say "goal description", suggesting the standard pipeline should accept a text prompt rather than requiring the user to know a UUID.

The project's established `CreateGoalDialog` component is the gold standard to follow: it uses `useNavigate` from `react-router` inside the `onSuccess` callback to redirect after mutation, which is exactly the pattern needed for TRIGGER-04. All new UI must use existing primitives: Dialog, Input, Textarea, Select, Button from `@/components/ui/`.

**Primary recommendation:** Replace the skeleton `SubmitPipelineDialog` in `pipelines.tsx` with a two-mode dialog (`GoalPipelineForm` / `CustomPipelineForm`) that calls `useSubmitGoalPipeline` or a new `useSubmitPipeline` mutation, shows the job ID in a toast, and calls `navigate(\`/dashboard/pipelines/\${jobId}\`)` on success. Move the dialog to `components/pipelines/` to keep parity with the `CreateGoalDialog` component pattern.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRIGGER-01 | User can submit a goal-based pipeline (default 3-stage: planner → coder → reviewer) from the dashboard | Backend `POST /api/pipelines/goal/:goalId` exists; `submitGoalPipeline()` in ApiClient; `useSubmitGoalPipeline` mutation hook exists — needs redirect on success |
| TRIGGER-02 | User can build a custom pipeline with configurable stages (agent role, prompt, dependency flag) | Backend `POST /api/pipelines` accepts `{ goalId, stages[] }` — stages have `agent`, `prompt`, `dependsOnPrevious`; `PipelineStageDefinition` type is defined; `PipelineAgentRole` enum has 5 values |
| TRIGGER-03 | User receives confirmation with job ID after successful pipeline submission | `SubmitPipelineResponse.jobId` returned on success; `sonner` toast already imported and used by all mutations; show `jobId` in toast message |
| TRIGGER-04 | User is redirected to the pipeline detail view after submission | `useNavigate` from `react-router` + `navigate(\`/dashboard/pipelines/\${jobId}\`)` in `onSuccess`; identical pattern to `CreateGoalDialog` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-router | v6/v7 (router v7 per package) | Navigation after mutation | Already used via `useNavigate` in `create-goal-dialog.tsx` |
| @tanstack/react-query | v5 | Mutation + cache invalidation | All mutations use `useMutation` + `useQueryClient` |
| sonner | current | Toast notifications | All existing mutations call `toast.success()` / `toast.error()` |
| React controlled state | — | Multi-field form state | `useState` per field, consistent with all existing dialogs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | current | Icons (Plus, Trash2, GripVertical) | Button icons, stage row actions |
| @/components/ui/* | project | Dialog, Input, Textarea, Select, Button | All form primitives |
| @/components/pipelines/stage-progress | project | StageIcon | Can import for visual affordance in stage builder |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom controlled state | react-hook-form | Project uses raw useState for all dialogs — consistency > ergonomics |
| Inline toast only | Dedicated success screen | Requirements say "confirmation message" — toast + redirect satisfies both TRIGGER-03 and TRIGGER-04 |
| Tab switcher in one dialog | Two separate dialogs | Single dialog with mode toggle is lighter, matches the one-dialog pattern in the codebase |

**No new packages needed.** All dependencies are already installed.

## Architecture Patterns

### Recommended File Structure
```
apps/dashboard/src/
├── components/pipelines/
│   ├── stage-progress.tsx          # EXISTING - StageIcon, StageProgress
│   └── submit-pipeline-dialog.tsx  # NEW - replaces inline SubmitPipelineDialog
├── api/
│   └── mutations.ts                # ADD useSubmitPipeline mutation
├── routes/
│   └── pipelines.tsx               # REPLACE SubmitPipelineDialog import
└── __tests__/pages/
    └── pipelines.test.tsx          # EXTEND with trigger tests
```

### Pattern 1: Mutation with Navigate (TRIGGER-04)
**What:** Call `navigate()` inside `onSuccess` callback of `useMutation`
**When to use:** Any time a create/submit action should redirect to the new resource
**Example:**
```typescript
// Source: apps/dashboard/src/components/goals/create-goal-dialog.tsx
const navigate = useNavigate();
const mutation = useSubmitPipeline();

mutation.mutate(payload, {
  onSuccess: (data) => {
    onClose();
    toast.success(`Pipeline submitted — Job ID: ${data.jobId}`);
    navigate(`/dashboard/pipelines/${data.jobId}`);
  },
});
```

### Pattern 2: Two-Mode Dialog with Mode Toggle
**What:** Single Dialog with a `mode` state switching between "goal" and "custom" forms
**When to use:** When two related flows share a trigger button but have different forms
**Example:**
```typescript
type DialogMode = "goal" | "custom";

function SubmitPipelineDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<DialogMode>("goal");
  // render GoalPipelineForm or CustomPipelineForm based on mode
}
```

### Pattern 3: Dynamic Stage List (TRIGGER-02)
**What:** An array of stage objects in state, with add/remove/edit operations
**When to use:** Custom pipeline builder needing N configurable stages
**Example:**
```typescript
interface StageInput {
  agent: PipelineAgentRole;
  prompt: string;
  dependsOnPrevious: boolean;
}

const [stages, setStages] = useState<StageInput[]>([
  { agent: "planner", prompt: "", dependsOnPrevious: false },
]);

function addStage() {
  setStages((prev) => [
    ...prev,
    { agent: "coder", prompt: "", dependsOnPrevious: true },
  ]);
}

function removeStage(index: number) {
  setStages((prev) => prev.filter((_, i) => i !== index));
}

function updateStage(index: number, field: keyof StageInput, value: unknown) {
  setStages((prev) =>
    prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
  );
}
```

### Pattern 4: Existing Mutation Hook (TRIGGER-01)
**What:** `useSubmitGoalPipeline` already exists in `mutations.ts` but needs `onSuccess` redirect added inline
**When to use:** Goal-based pipeline — call `submitGoalPipeline(goalId, context)`
**Critical:** The existing hook calls `toast.success("Pipeline submitted")` without the job ID. The new dialog must pass an `onSuccess` callback to override this or show the job ID separately.

**Note on goal identification:** The current skeleton dialog asks for a raw UUID ("Goal ID"). TRIGGER-01 says "enter a goal description". Two options:
1. Accept a goal UUID (current approach) — simple, matches backend exactly
2. Accept a text goal prompt and create a goal first — more UX-friendly but requires two API calls

The backend `POST /api/pipelines/goal/:goalId` requires an existing `goalId`. The simpler approach (option 1, keep UUID input) is consistent with how the existing code works and avoids adding goal-creation complexity. The plan should accept goal UUID.

### Anti-Patterns to Avoid
- **Navigating in `onSuccess` of the hook definition (not the callsite):** The existing `useSubmitGoalPipeline` hook doesn't navigate because it doesn't know where to go. Navigate at the call site via the `onSuccess` callback override.
- **Closing dialog before navigation:** Close the dialog first (`onClose()`), then navigate, to avoid a visible flash of the empty dialog over the detail page.
- **Not resetting form state on close:** Always reset all `useState` fields when the dialog closes, otherwise stale values appear on next open.
- **Not invalidating `queryKeys.pipelines.all` after submit:** The list query must be invalidated so the new run appears immediately when the user lands back on the list page.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal/dialog | Custom portal | `Dialog` from `@/components/ui/dialog` | Has escape key, focus trap, scroll lock, aria-modal built in |
| Form validation | Custom validator | HTML `required` + `disabled={!valid}` pattern | All existing dialogs use this; sufficient for the fields here |
| Navigation after action | Custom redirect logic | `useNavigate` from `react-router` | Handles browser history correctly |
| Toast notifications | Custom toast | `sonner` `toast.success()` / `toast.error()` | Already used by every mutation in the project |
| Agent role options | Magic strings | `PipelineAgentRole` type + derived array | Type-safe, catches typos at compile time |

**Key insight:** The entire feature is UI wiring. The backend, types, ApiClient methods, and mutation hooks are all already implemented. The work is replacing the skeleton dialog and adding tests.

## Common Pitfalls

### Pitfall 1: useSubmitGoalPipeline toast duplicates job ID
**What goes wrong:** The existing `useSubmitGoalPipeline` hook calls `toast.success("Pipeline submitted")` unconditionally in its own `onSuccess`. If the dialog also calls `toast.success(\`Job: \${data.jobId}\`)`, the user sees two toasts.
**Why it happens:** TanStack Query's `onSuccess` at the hook definition level runs before the caller's `onSuccess`. Both fire.
**How to avoid:** Either (a) update `useSubmitGoalPipeline` to include the job ID in its own toast, or (b) add a new `useSubmitPipeline` hook that doesn't call toast (letting the dialog do it). Option (a) is simpler — update the existing hook's toast to `toast.success(\`Pipeline submitted — Job ${data.jobId.slice(0,8)}\`)`.
**Warning signs:** Two toast messages appearing on submission.

### Pitfall 2: useNavigate called outside Router context in tests
**What goes wrong:** Tests fail with "useNavigate() may be used only in the context of a <Router> component" even when using `renderWithProviders`.
**Why it happens:** `renderWithProviders` wraps with `MemoryRouter` which provides a router context. But if the component is rendered outside `renderWithProviders` (e.g., direct `render()`), it breaks.
**How to avoid:** Always use `renderWithProviders` for any component containing `useNavigate`. The existing test for `CreateGoalDialog` demonstrates the correct pattern.
**Warning signs:** Test error: "useNavigate() may be used only in the context of a <Router> component".

### Pitfall 3: Stage array minimum validation
**What goes wrong:** User submits the custom pipeline form with all stages removed (empty array). The backend returns 400 "goalId and at least one stage are required".
**Why it happens:** The UI doesn't enforce a minimum of 1 stage.
**How to avoid:** Disable the "Remove" button on the last stage. Disable submit when `stages.length === 0`.
**Warning signs:** 400 error appearing in toast.

### Pitfall 4: Dialog max-width too narrow for custom stage builder
**What goes wrong:** The existing `Dialog` component hardcodes `max-w-md` (448px). With 3+ stages each containing a Select, a Textarea, and a checkbox, the form becomes cramped.
**Why it happens:** The `Dialog` component class string is `w-full max-w-md`.
**How to avoid:** The Dialog component accepts `children` rendered inside a fixed-class div. Use a wrapping class override or accept that `max-w-md` is fine with the compact layout used in pipeline-detail.tsx.
**Note:** The `Dialog` component in `dialog.tsx` does NOT accept a `className` prop on the outer content div — it's hardcoded. Either accept the constraint or add a `size` prop when building the dialog.

### Pitfall 5: Stale goalId in form after closing
**What goes wrong:** User opens dialog, types a goal ID, closes without submitting, reopens — the old value is still there.
**Why it happens:** `useState` persists across renders unless explicitly reset.
**How to avoid:** Call reset functions in `onClose`. The `CreateGoalDialog` resets in `onSuccess`; do the same in an `onClose` handler or use a `useEffect` on `open` going from `true → false`.

## Code Examples

Verified patterns from project source:

### Mutation with navigate on success
```typescript
// Source: apps/dashboard/src/components/goals/create-goal-dialog.tsx
const navigate = useNavigate();
const createGoal = useCreateGoal();

createGoal.mutate(payload, {
  onSuccess: (goal) => {
    onClose();
    setTitle("");
    navigate(`/dashboard/goals/${goal.id}`);
  },
});
```

### Adding useSubmitPipeline mutation (for custom stages)
```typescript
// Source: apps/dashboard/src/api/mutations.ts (to be added)
export function useSubmitPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SubmitPipelineInput) => apiClient.submitPipeline(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      toast.success(`Pipeline queued — Job ${data.jobId.slice(0, 8)}`);
    },
    onError: (err) => {
      toast.error(`Failed to submit pipeline: ${err.message}`);
    },
  });
}
```

### Dynamic stage state with add/remove/update
```typescript
// Pattern for TRIGGER-02 custom pipeline builder
const [stages, setStages] = useState<PipelineStageDefinition[]>([
  { agent: "planner", prompt: "", dependsOnPrevious: false },
]);

// Add a stage
setStages((prev) => [...prev, { agent: "coder", prompt: "", dependsOnPrevious: true }]);

// Remove stage at index i (keep minimum 1)
setStages((prev) => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

// Update a field
setStages((prev) =>
  prev.map((s, idx) => idx === i ? { ...s, agent: value } : s)
);
```

### Agent role options derived from type
```typescript
// Source: packages/api-client/src/types.ts — PipelineAgentRole
const AGENT_ROLES: PipelineAgentRole[] = ["planner", "coder", "reviewer", "debugger", "researcher"];

// In JSX:
<Select value={stage.agent} onChange={(e) => updateStage(i, "agent", e.target.value)}>
  {AGENT_ROLES.map((role) => (
    <option key={role} value={role}>{role}</option>
  ))}
</Select>
```

### Mocking navigate in tests
```typescript
// Source: apps/dashboard/src/__tests__/routes/login.test.tsx
const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Assert redirect happened:
expect(mockNavigate).toHaveBeenCalledWith("/dashboard/pipelines/job-xyz");
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `SubmitPipelineDialog` in `pipelines.tsx` asks for raw goal UUID, no redirect | Refactored dialog in `components/pipelines/submit-pipeline-dialog.tsx` with mode toggle + navigate | Satisfies all 4 TRIGGER requirements |
| Single "Pipeline submitted" toast | Toast shows `Job ${jobId.slice(0,8)}` | Satisfies TRIGGER-03 |
| Goal-based form only | Goal-based + custom stage builder | Satisfies TRIGGER-01 and TRIGGER-02 |

**Key existing work that is complete (no changes needed):**
- Backend: `pipeline.ts` routes — both POST endpoints work
- ApiClient: `submitPipeline()`, `submitGoalPipeline()` methods
- Types: `SubmitPipelineInput`, `SubmitPipelineResponse`, `PipelineStageDefinition`, `PipelineAgentRole`
- Query keys: `queryKeys.pipelines.all`, `queryKeys.pipelines.list`
- Mutation hook: `useSubmitGoalPipeline` (exists, needs toast updated)

## Open Questions

1. **Goal identification UX: UUID vs description**
   - What we know: Backend requires `goalId` (UUID). The requirement says "enter a goal description".
   - What's unclear: Does the user know goal IDs? Should we fetch a goal list to show a picker?
   - Recommendation: Accept goal UUID in the input field (labeled "Goal ID") with placeholder text showing the UUID format. This is what the skeleton already does and avoids a secondary API call. The requirement wording "goal description" likely means descriptive label ("goal-based pipeline"), not that the input must be free-text.

2. **Dialog width for custom stage builder**
   - What we know: `Dialog` component hardcodes `max-w-md`. Custom builder with 3+ stages may be cramped.
   - What's unclear: Whether the planner wants to extend the Dialog component or live with `max-w-md`.
   - Recommendation: Plan to extend Dialog with an optional `size="lg"` prop (`max-w-lg` or `max-w-2xl`) or use inline `className` override if Dialog is refactored to accept it. Alternatively, keep compact by using a single-line layout per stage.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom + @testing-library/react |
| Config file | `apps/dashboard/vite.config.ts` (test section) |
| Quick run command | `npm run test -w @ai-cofounder/dashboard` |
| Full suite command | `npm run test -w @ai-cofounder/dashboard` |
| Estimated runtime | ~10 seconds |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRIGGER-01 | Goal-based pipeline form renders and submits via `useSubmitGoalPipeline` | unit | `npm run test -w @ai-cofounder/dashboard` (pipelines.test.tsx) | ✅ yes (extend existing) |
| TRIGGER-02 | Custom stage builder renders stages, add/remove/edit works, submits via `useSubmitPipeline` | unit | `npm run test -w @ai-cofounder/dashboard` (pipelines.test.tsx) | ✅ yes (extend existing) |
| TRIGGER-03 | Job ID appears in toast/UI after successful submission | unit | `npm run test -w @ai-cofounder/dashboard` (pipelines.test.tsx) | ✅ yes (extend existing) |
| TRIGGER-04 | `navigate('/dashboard/pipelines/:jobId')` called after submit | unit | `npm run test -w @ai-cofounder/dashboard` (pipelines.test.tsx) | ✅ yes (extend existing) |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/dashboard`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~10 seconds

### Wave 0 Gaps (must be created before implementation)
None — existing test infrastructure covers all phase requirements. The test file `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` already exists and tests the `PipelinesPage`. New TRIGGER tests extend that file. The `useNavigate` mock pattern is established in `login.test.tsx`.

## Sources

### Primary (HIGH confidence)
- Direct code reading: `apps/agent-server/src/routes/pipeline.ts` — both POST endpoints confirmed
- Direct code reading: `packages/api-client/src/client.ts` — `submitPipeline()`, `submitGoalPipeline()` confirmed
- Direct code reading: `packages/api-client/src/types.ts` — `SubmitPipelineInput`, `SubmitPipelineResponse`, `PipelineAgentRole`, `PipelineStageDefinition` confirmed
- Direct code reading: `apps/dashboard/src/api/mutations.ts` — `useSubmitGoalPipeline` confirmed
- Direct code reading: `apps/dashboard/src/components/goals/create-goal-dialog.tsx` — `useNavigate` + `onSuccess` navigate pattern confirmed
- Direct code reading: `apps/dashboard/src/components/ui/dialog.tsx` — Dialog API confirmed (no className on content div)
- Direct code reading: `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` — existing test infrastructure confirmed

### Secondary (MEDIUM confidence)
- Project-wide grep for `useNavigate` — 3 files confirmed, pattern is consistent

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present and in use
- Architecture: HIGH — pattern directly derived from `create-goal-dialog.tsx` (same project)
- Pitfalls: HIGH — identified from direct code reading (Dialog hardcoded width, duplicate toasts, missing navigate in existing hook)

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable codebase, not fast-moving)
