# ADR-001: TanStack Query with WebSocket Invalidation

## Status

Accepted

## Context

The dashboard needs real-time updates for goals, tasks, approvals, monitoring, and queue status. Three approaches were considered:

1. **Polling** — TanStack Query `refetchInterval` on each query (original approach)
2. **Full WebSocket state** — Push complete state over WebSocket, bypass TanStack Query
3. **WebSocket-triggered invalidation** — WebSocket sends lightweight `invalidate` messages; TanStack Query refetches via its cache

Polling was the initial implementation. It worked but created unnecessary load (every query refetching on a timer regardless of changes) and introduced latency (up to the poll interval before updates appeared).

Full WebSocket state would eliminate HTTP round-trips but requires duplicating the server's data serialization on the WebSocket channel, managing partial updates, and losing TanStack Query's caching/deduplication/error-retry benefits.

## Decision

Use **WebSocket-triggered cache invalidation** (option 3).

- A single WebSocket connection (`/ws`) with JWT auth handles all real-time channels
- The server broadcasts `{ type: "invalidate", channel: "tasks" }` messages when data changes
- The dashboard's `useRealtimeSync` hook maps channels to TanStack Query keys and calls `queryClient.invalidateQueries()`
- TanStack Query handles the actual refetch, deduplication, and caching
- SSE endpoints are preserved for backward compatibility (voice UI, bots)

## Consequences

**Benefits:**
- Minimal WebSocket payload (just channel names, not full data)
- Reuses TanStack Query's existing fetch logic, error handling, and cache
- Single WebSocket connection replaces N polling intervals
- Updates appear within milliseconds of server-side changes
- No duplication of data serialization between REST and WebSocket

**Trade-offs:**
- Each invalidation triggers an HTTP refetch (not zero-latency)
- Requires mapping between WS channels and query keys (`WS_CHANNEL_QUERY_KEYS`)
- WebSocket reconnection logic needed (exponential backoff implemented in `useRealtimeSync`)

**Files:** `plugins/websocket.ts`, `plugins/ws-emitter.ts`, `hooks/use-realtime-sync.ts`, `packages/shared/src/ws-types.ts`
