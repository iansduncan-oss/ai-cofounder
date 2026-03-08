# Stack Research: Infrastructure & Reliability

## Message Queue

| Library | Version | Rationale | Confidence |
|---------|---------|-----------|------------|
| **BullMQ** | ^5.x | Production-grade job queue built on Redis. Supports priorities, retries, delayed jobs, rate limiting, concurrency control. Used by major Node.js projects. Native TypeScript. | High |
| **ioredis** | ^5.x | Redis client required by BullMQ. Superior to `redis` package for pub/sub, Lua scripting, cluster support. BullMQ's recommended client. | High |
| **Redis** | 7.x (Docker) | In-memory data store. BullMQ requires Redis 5+. Use official `redis:7-alpine` Docker image for small footprint. | High |

**Not recommended:**
- `bull` (v3) — Legacy, BullMQ is the maintained successor
- `bee-queue` — Simpler but lacks BullMQ's features (priorities, flow graphs)
- `agenda` / `bree` — MongoDB/file-based, wrong model for job queues
- Raw Redis pub/sub — No retry, no persistence, no job management
- RabbitMQ / Kafka — Over-engineered for single-VPS deployment

## Authentication

| Library | Version | Rationale | Confidence |
|---------|---------|-----------|------------|
| **@fastify/jwt** | ^9.x | Official Fastify JWT plugin. Decorates request with `jwtVerify()`, integrates with Fastify lifecycle hooks. | High |
| **bcrypt** | ^5.x | Password hashing. Industry standard, adaptive cost factor. Use cost factor 12. | High |
| **@fastify/cookie** | ^11.x | Cookie support for refresh token storage. HttpOnly + Secure flags. | High |

**Not recommended:**
- `jsonwebtoken` directly — `@fastify/jwt` wraps it with Fastify integration
- `passport` — Heavy, designed for Express. Fastify has its own auth patterns
- `@fastify/auth` — Adds complexity; simple `onRequest` hook with `jwtVerify` is sufficient for single-user

## E2E Testing

| Library | Version | Rationale | Confidence |
|---------|---------|-----------|------------|
| **vitest** | (existing) | Already used for unit tests. Supports integration test patterns with longer timeouts. | High |
| **@fastify/inject** | (built-in) | Fastify's `server.inject()` for HTTP-level testing without actual network. Already available. | High |
| **testcontainers** | ^10.x | Spin up real PostgreSQL + Redis in Docker for integration tests. Guarantees isolation, auto-cleanup. | Medium |

**Not recommended:**
- `supertest` — Express-oriented; Fastify's built-in `inject()` is superior
- `jest` — Already using vitest, no reason to switch
- Playwright/Cypress — Browser E2E; not needed for API-level integration tests
- `docker-compose` in tests — testcontainers is cleaner for programmatic container management

## Quick Wins

| Library | Version | Rationale | Confidence |
|---------|---------|-----------|------------|
| **@fastify/swagger** | ^9.x | OpenAPI spec generation from Fastify route schemas. Auto-generates docs. | High |
| **@fastify/swagger-ui** | ^5.x | Serves Swagger UI at configurable endpoint. | High |

## Summary

The stack is straightforward — BullMQ is the clear winner for Node.js job queues, @fastify/jwt is the idiomatic Fastify auth solution, and vitest + Fastify inject handles E2E testing without new test frameworks. The only new infrastructure dependency is Redis (Docker container).
