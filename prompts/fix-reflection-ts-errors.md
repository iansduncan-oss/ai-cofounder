# Fix reflection.ts TypeScript Errors

## Problem

`apps/agent-server/src/services/reflection.ts` has 2 TS errors at lines 292-293 caused by a drizzle-orm `SQL` type mismatch. The dynamic `import("drizzle-orm")` creates a separate type namespace from the one used by `@ai-cofounder/db`, so the `sql` tagged template literal produces an `SQL<unknown>` that doesn't match the expected type for `.where()` and `.orderBy()`.

## Errors

```
reflection.ts(292,16): error TS2345: Argument of type 'SQL<unknown>' is not assignable to parameter of type 'SQL<unknown> | ...'
  Types have separate declarations of a private property 'shouldInlineParams'.

reflection.ts(293,18): error TS2769: No overload matches this call.
  Argument of type 'SQL<unknown>' is not assignable to parameter of type '...'
```

## Root Cause

Lines 288-293 use `await import("drizzle-orm")` to get the `sql` tag, but the Drizzle schema types in `@ai-cofounder/db` resolve `SQL` from a different module instance. The `shouldInlineParams` private property mismatch is the classic dual-package/dual-resolution TypeScript error.

## Fix

Replace the dynamic `import("drizzle-orm")` with the proper Drizzle query operators that are already available. Two approaches (pick one):

### Option A: Use drizzle-orm operators directly (preferred)

Import `gte` and `asc` from `drizzle-orm` at the top of the file (static import), then:

```typescript
import { gte, asc } from "drizzle-orm";
// ...
actions = await this.db
  .select()
  .from(userActions)
  .where(gte(userActions.createdAt, thirtyDaysAgo))
  .orderBy(asc(userActions.createdAt));
```

Remove the `const { sql: sqlTag } = await import("drizzle-orm");` line.

### Option B: Re-export `sql` from `@ai-cofounder/db`

If `sql` is already re-exported from `@ai-cofounder/db`, use that instead of importing from `drizzle-orm` directly.

## Files to Modify

- `apps/agent-server/src/services/reflection.ts` — lines ~288-293

## Verification

```bash
npx tsc --noEmit -p apps/agent-server/tsconfig.json 2>&1 | grep reflection
# Should produce no output
```
