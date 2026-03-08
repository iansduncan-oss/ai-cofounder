# Features Research: Infrastructure & Reliability

## Message Queue Features

### Table Stakes
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Job enqueue/dequeue | Low | Submit jobs from HTTP handlers, process in workers |
| Job retries with backoff | Low | Failed jobs retry with exponential backoff (BullMQ built-in) |
| Job status tracking | Low | Query job state (waiting, active, completed, failed) |
| Graceful shutdown | Medium | Workers finish current job before exiting (SIGTERM handling) |
| Connection health checks | Low | Redis connection monitoring, reconnect on failure |
| Job completion callbacks | Medium | Notify caller when async job completes (via SSE or polling) |

### Differentiators
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Job priorities | Low | Urgent tasks processed before routine ones (BullMQ built-in) |
| Concurrency control | Low | Limit parallel jobs per worker to prevent resource exhaustion |
| Dead letter queue | Medium | Failed jobs after max retries moved to DLQ for manual review |
| Job progress events | Medium | Real-time progress updates during long-running jobs |
| Bull Board dashboard | Low | Web UI for monitoring queue health, job states, metrics |

### Anti-Features
| Feature | Why Not |
|---------|---------|
| Multi-queue routing | Over-engineered for single worker process — one queue is sufficient |
| Job scheduling/cron via BullMQ | Already have cron scheduler in services/scheduler.ts |
| Redis Cluster | Single VPS doesn't need cluster mode |
| Queue-based pub/sub | SSE already handles real-time updates to clients |

**Dependencies:** Job completion callbacks depend on job status tracking. Dead letter queue depends on retries.

---

## JWT Authentication Features

### Table Stakes
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Login endpoint | Low | POST /api/auth/login with email/password, returns JWT |
| Password hashing | Low | bcrypt hash on registration, verify on login |
| Access token (short-lived) | Low | JWT with 15-30 min expiry for API requests |
| Refresh token (long-lived) | Medium | HttpOnly cookie with 7-day expiry for token renewal |
| Protected route middleware | Low | Fastify onRequest hook that verifies JWT |
| Logout (token invalidation) | Low | Clear refresh cookie, optionally blacklist access token |

### Differentiators
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Token refresh endpoint | Medium | POST /api/auth/refresh to get new access token |
| Password change | Low | Authenticated endpoint to update password |
| Session listing | Medium | Track active sessions, allow revoking specific ones |
| Rate limiting on login | Low | Prevent brute force (already have rate limiting infrastructure) |

### Anti-Features
| Feature | Why Not |
|---------|---------|
| OAuth providers | Single user — no need for Google/GitHub login flows |
| Email verification | Single user creates account manually or via seed |
| Password reset via email | Single user can reset via DB directly |
| Multi-factor auth | Over-engineered for single-user dashboard |
| Role-based access control | Single user = single role |

**Dependencies:** Refresh tokens depend on access tokens. Token refresh endpoint depends on refresh tokens.

---

## E2E Integration Test Features

### Table Stakes
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Full goal lifecycle test | High | Create goal → dispatch → orchestrator loop → completion |
| API endpoint integration tests | Medium | Test actual HTTP handlers with real DB |
| Test database isolation | Medium | Separate DB (or transactions) for test runs |
| Test fixtures/factories | Medium | Generate realistic test data (goals, tasks, conversations) |
| CI integration | Low | Tests run in GitHub Actions pipeline |

### Differentiators
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Mocked LLM responses | Medium | Deterministic LLM responses for reproducible tests |
| Queue integration tests | Medium | Test job enqueue → worker process → completion |
| Auth flow tests | Low | Login → access protected route → token refresh → logout |
| Bot command integration tests | High | Simulate Discord/Slack commands through full stack |

### Anti-Features
| Feature | Why Not |
|---------|---------|
| Browser E2E tests | Dashboard is React SPA — API tests cover the important paths |
| Load/performance tests | Not needed at current scale |
| Snapshot tests | Already have unit tests for components |
| Contract tests | TypeScript types + api-client provide compile-time contracts |

**Dependencies:** Queue integration tests depend on message queue being implemented. Auth flow tests depend on JWT auth.

---

## Quick Win Features

### Table Stakes
| Feature | Complexity | Description |
|---------|-----------|-------------|
| deleteFile tool | Low | Workspace tool with path validation and safety checks |
| deleteDirectory tool | Low | Recursive delete with confirmation for non-empty dirs |
| GET /api/agents/roles | Low | List available agent roles and descriptions |

### Differentiators
| Feature | Complexity | Description |
|---------|-----------|-------------|
| Conversation export JSON | Low | GET /api/conversations/:id/export — full conversation with messages |
| OpenAPI spec generation | Medium | @fastify/swagger integration with existing route schemas |
| Swagger UI | Low | Browse API docs at /api/docs |
