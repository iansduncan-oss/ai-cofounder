# Lessons Learned

Patterns to avoid and rules to follow, captured from corrections and debugging sessions.

## Test Infrastructure

- **Always close Fastify servers in tests.** Any test file that calls `buildServer()` must call `await app.close()` in `afterAll`. Leaked servers cause port conflicts and hanging processes.
- **Create server in `beforeAll`, not `beforeEach`.** Creating a new Fastify server per test leaks all but the last one since `afterAll` only closes the final reference.
- **New workspaces need a `vitest.config.ts`.** Use `defineProject` with a unique `name` and add the directory to root config's `projects` array. Without this, `vitest run` from within the workspace resolves root config project paths relative to the workspace dir (wrong).
- **`passWithNoTests: true`** must be set in workspace configs that have no test files (like test-utils), otherwise vitest exits with code 1 and cascades turbo failures.
- **Don't use `declare const` hacks for vitest globals.** Import directly from `"vitest"` — the package is always available in test contexts.
- **Don't duplicate utility logic across setup files.** The agent-server setup should import `snapshotEnv()` from test-utils rather than re-implementing env snapshot/restore.

## Code Changes

- **When removing an import, check all usages.** Changing `beforeEach` to `beforeAll` in an import but still using `beforeEach` in the body causes a runtime ReferenceError. Always verify the import covers all identifiers used.
