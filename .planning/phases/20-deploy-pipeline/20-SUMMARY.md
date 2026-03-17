# Phase 20 — Deploy Pipeline Modernization: Summary

## Overview

Phase 20 modernizes the CI/CD pipeline with local reproducibility, deeper health verification, and dry-run capability. **Status: PENDING**.

## What Exists

### Current Deploy Pipeline

- GitHub Actions workflow (`.github/workflows/deploy.yml`)
- CI → deploy trigger via `workflow_run` on `main`
- Tailscale SSH → VPS, `git pull`, Docker build, `docker-compose up -d`
- Health check via `/health/deep` (6 attempts × 5s)
- Auto-rollback to previous image SHA on health failure
- Discord webhook notifications on success/failure
- Deploy webhook to agent-server (`POST /api/deploys/webhook`)
- Circuit breaker pattern — auto-pauses deploys after repeated failures

### Deploy Circuit Breaker (from Phase 17)

- `DeployCircuitBreakerService` — tracks failures, pauses after threshold
- Deploy webhook checks circuit breaker before accepting `deploy_started`
- Dashboard shows circuit breaker status + resume button

## Planned Work

| ID | Requirement | Status |
|----|-------------|--------|
| DEPLOY-01 | `npm run ci:local` via `act` | Pending |
| DEPLOY-02 | `/health/deep` verifies DB + Redis + LLM | Done (already implemented) |
| DEPLOY-03 | Auto-rollback on health failure within 60s | Done (already implemented) |
| DEPLOY-04 | `npm run deploy:dry-run` builds without deploying | Pending |
