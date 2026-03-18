# v3.1 Deferred Fixes

Complete the 4 minor gaps identified in the v3.0 audit (`tasks/v3-audit.md`). These are all small, well-scoped tasks.

## Steps

### 1. DEPLOY-04: Deploy dry-run mode

Add a `--dry-run` flag to the deploy workflow that builds and validates without actually deploying.

- Add a `workflow_dispatch` input `dry_run` (boolean, default false) to `.github/workflows/deploy.yml`
- When `dry_run=true`: run build steps (Docker build, config validation) but skip `docker compose up` and rollback logic
- Still run the CI smoke checks (typecheck, lint, build, test)
- Print a summary of what *would* be deployed (image SHA, services affected)
- Add `npm run deploy:dry-run` script to root `package.json` that triggers the workflow via `gh workflow run deploy.yml -f dry_run=true`
- Test by running `gh workflow run` manually

### 2. DASH-Q-03: Fix 3 component tests to use renderWithProviders

Migrate these 3 test files from bare `render()` to `renderWithProviders()`:

- `apps/dashboard/src/__tests__/components/auth-guard.test.tsx` — currently uses custom `renderWithRouter()`
- `apps/dashboard/src/__tests__/components/status-badge.test.tsx` — currently uses bare `render()`
- `apps/dashboard/src/__tests__/components/tool-call-card.test.tsx` — currently uses bare `render()`

For each file:
1. Import `renderWithProviders` from `../__tests__/test-utils`
2. Replace `render()` / `renderWithRouter()` calls with `renderWithProviders()`
3. Remove any custom wrapper functions that `renderWithProviders` already handles
4. Run the tests to confirm they still pass

### 3. DASH-Q-04: Add keyboard navigation tests

Add keyboard navigation tests for key dashboard pages. Create `apps/dashboard/src/__tests__/a11y/keyboard-nav.test.tsx`:

- **Tab order**: Verify that Tab moves focus through interactive elements in logical order
- **Escape key**: Verify modals/drawers close on Escape
- **Enter/Space**: Verify buttons and links are activatable via keyboard
- **Focus visible**: Verify focus indicators are present on interactive elements
- Test at least 3 pages: Chat, Overview, Goal Detail
- Use `@testing-library/user-event` for keyboard simulation
- Use `renderWithProviders()` for test setup

### 4. DOC-01: Verify Phase 22 SUMMARY

The Phase 22 SUMMARY was created during the audit. Verify it's accurate by checking:
- All files referenced actually exist
- Test counts are correct
- Requirements mapping is accurate

If everything checks out, mark DOC-01 as complete in `v3.0-REQUIREMENTS.md`.

## Verification

After all fixes:
1. Run `npm run test -w @ai-cofounder/dashboard` — all dashboard tests pass
2. Run `npm run test` from root — full suite passes
3. Update `v3.0-REQUIREMENTS.md` — mark DEPLOY-04, DASH-Q-03, DASH-Q-04, DOC-01 as complete
4. Update `v3.0-ROADMAP.md` — remove v3.1 deferred section (all items resolved)
5. Commit with message: `fix(v3.1): complete deferred items — dry-run deploy, test consistency, keyboard a11y`
