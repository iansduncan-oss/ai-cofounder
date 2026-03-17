# Fix Migration File Ordering Bugs

## Context

The project uses `db:push` for dev and has 30 migration files (0000-0029) tracked in a Drizzle migrations table. However, several migration files have bugs that would break `runMigrations()` if used in production:

- **0022** uses an invalid enum value in a COALESCE expression
- **0023** references a nonexistent `deployments` table

These need to be fixed so `runMigrations()` works end-to-end for fresh installs and future CI pipelines.

---

## 1. Audit All Migration Files

**Directory:** `packages/db/drizzle/`

Read every migration file (0000 through 0029) and check for:
- References to tables/columns that don't exist at that migration's point in time
- Invalid enum values used in DEFAULT or COALESCE expressions
- Dependency ordering issues (migration N references something created in migration N+2)
- SQL syntax errors

Create a list of all issues found before making any changes.

---

## 2. Fix Migration 0022

**File:** `packages/db/drizzle/0022_*.sql`

Fix the invalid enum in the COALESCE expression. The enum values must match what's defined in the schema at that point. Check `packages/db/src/schema.ts` for the correct enum values and adjust the migration accordingly.

---

## 3. Fix Migration 0023

**File:** `packages/db/drizzle/0023_*.sql`

This migration references a `deployments` table that was never created. Either:
- **Option A**: Remove the reference if the deployment tracking was dropped from scope
- **Option B**: Add the missing `CREATE TABLE deployments` to an earlier migration if the table is in the current schema

Check if `deployments` exists in `packages/db/src/schema.ts` to decide which option.

---

## 4. Fix Any Other Issues Found in Audit

Apply fixes to any other broken migrations discovered in step 1.

---

## 5. Test the Full Migration Chain

Run the complete migration sequence against a fresh database to verify everything works:

```bash
# Start a clean Postgres (or use a temp DB)
npm run db:migrate
```

If `db:migrate` isn't wired to use `runMigrations()`, test manually:
1. Create a temporary database
2. Run all migrations in order against it
3. Verify the final schema matches what `db:push` produces

---

## 6. Sync VPS Migration Tracking

After fixing migrations locally, the VPS migration tracking table may need updating. Note any changes to migration file names or content hashes that would affect the tracking table at `/opt/ai-cofounder`.

---

## Verification

1. **Fresh DB test**: `runMigrations()` completes without errors on an empty database
2. **Existing DB test**: `db:push` still works and reports no drift
3. **Schema match**: Final schema from migrations matches schema from `db:push`
4. **Tests pass**: `npm run test -w @ai-cofounder/db` — all DB tests still green
5. **No data loss**: Existing data in dev/prod databases is unaffected

## Files to Modify

| File | Change |
|------|--------|
| `packages/db/drizzle/0022_*.sql` | Fix invalid enum in COALESCE |
| `packages/db/drizzle/0023_*.sql` | Fix missing deployments table reference |
| Any other broken migration files | Fixes found during audit |
