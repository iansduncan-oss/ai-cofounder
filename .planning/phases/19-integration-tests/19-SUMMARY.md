# Phase 19 — Integration Test Suite: Summary

## Overview

Phase 19 adds end-to-end integration tests that exercise cross-service flows the unit tests miss. **Status: IN PROGRESS** (separate session).

## What Exists

### Integration Test Files (from prior phases)

| File | Coverage |
|------|----------|
| `e2e-full-workflow.test.ts` | End-to-end complete workflow |
| `e2e-goal-lifecycle.test.ts` | Goal create → execute → complete |
| `e2e-execution.test.ts` | Execution flow testing |

These files were created during earlier phases and test some integration paths but are mocked at the DB/LLM boundary. Phase 19 aims to add a true integration harness with a test database.

## Planned Work

### INT-01: Integration Test Harness
- Boot agent-server with a real (test) PostgreSQL database
- Migrate schema, seed minimal data, tear down on completion
- Shared `integrationSetup()` / `integrationTeardown()` helpers

### INT-02: Goal Lifecycle Integration Test
- Create → plan → execute → verify → complete
- Exercises orchestrator + dispatcher + DB in concert

### INT-03: Approval Flow Integration Test
- Yellow-tier tool triggers approval request
- Approval resolved → execution resumes
- Verifies autonomy tier enforcement end-to-end

### INT-04: Dashboard API Contract Tests
- TanStack Query hooks validated against real server responses
- Ensures type contracts between api-client and server hold

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| INT-01 | Integration test harness with real DB | Pending |
| INT-02 | Goal lifecycle integration test | Pending |
| INT-03 | Approval flow integration test | Pending |
| INT-04 | Dashboard API contract tests | Pending |
