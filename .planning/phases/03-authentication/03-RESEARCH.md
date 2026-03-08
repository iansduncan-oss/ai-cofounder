# Phase 3: Authentication - Research

**Researched:** 2026-03-08
**Domain:** JWT authentication, Fastify plugins, bcrypt, HttpOnly cookies, React token management
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can log in via POST /api/auth/login with email and password | Login route in new `authPlugin`, bcrypt compare, JWT sign |
| AUTH-02 | Successful login returns short-lived access token (JWT, 15min expiry) | `reply.jwtSign({ sub: userId }, { expiresIn: '15m' })` via @fastify/jwt |
| AUTH-03 | Successful login sets long-lived refresh token as HttpOnly + Secure + SameSite=Strict cookie | `reply.setCookie('refreshToken', token, { httpOnly: true, secure: true, sameSite: 'strict' })` via @fastify/cookie |
| AUTH-04 | Protected API routes verify JWT via onRequest hook, reject unauthorized with 401 | Fastify encapsulation: register protected routes inside a scoped plugin with addHook('onRequest', jwtVerify) |
| AUTH-05 | POST /api/auth/refresh issues new access token using the refresh token cookie | Read `request.cookies.refreshToken`, verify with separate JWT config, return new accessToken |
| AUTH-06 | POST /api/auth/logout clears the refresh cookie | `reply.clearCookie('refreshToken')` — stateless logout (no token blacklist for v1) |
| AUTH-07 | Admin user auto-created on startup from ADMIN_EMAIL + ADMIN_PASSWORD env vars | Server `onReady` hook in authPlugin: check adminUser table, insert if none |
| AUTH-08 | Passwords hashed with bcrypt cost factor 12, never stored in plaintext | `bcryptjs.hash(password, 12)` + `bcryptjs.compare(candidate, hash)` |
| AUTH-09 | Bot endpoints (Discord/Slack webhook routes) use separate API key auth, not affected by JWT | Fastify encapsulation: bot routes registered OUTSIDE the JWT-protected scope; existing API_SECRET bearer auth covers them |
| AUTH-10 | Dashboard stores access token in memory (not localStorage), includes as Authorization: Bearer header | `useAuth` hook with React state + sessionStorage-backed fallback; update `ApiClient` to accept a dynamic token getter |
</phase_requirements>

---

## Summary

This phase adds JWT-based login to the AI Cofounder dashboard. The existing codebase already has a partial auth scaffold: a `LoginPage` that validates against `API_SECRET`, an `AuthGuard` that reads from `localStorage`, and an `ApiClient` that injects a static bearer token. All three need to be replaced or upgraded.

The server side requires three new things: (1) a new Drizzle schema addition — email + password_hash columns on a new `adminUsers` table (separate from the existing `users` table which is for Discord/Slack/platform users), (2) a new `authPlugin` with three routes (login, refresh, logout) and an onReady admin seed, and (3) a scoped Fastify plugin that applies JWT verification as an `onRequest` hook to all `/api/*` routes except `/api/auth/*`, `/api/webhooks/*`, and `/api/channels/*` (bot routes). The existing `API_SECRET` bearer check in `securityPlugin` handles bot endpoints and can coexist with JWT on other routes — the JWT check should be additive, not a replacement.

The dashboard side replaces localStorage token storage with in-memory state (React context or module-level variable) so XSS cannot exfiltrate the access token. A silent refresh mechanism on 401 responses calls `/api/auth/refresh` (using the HttpOnly cookie automatically) and retries the original request with the new token.

**Primary recommendation:** Use `@fastify/jwt` v9+ and `@fastify/cookie` v10+ (both Fastify 5 compatible). Use `bcryptjs` (pure JS, no native build needed). New `adminUsers` table separate from `users`. Protect routes via Fastify encapsulation. Token in-memory on dashboard via React context + retry-on-401 pattern in ApiClient.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/jwt | ^9.x | JWT sign/verify, decorates `request.jwtVerify()` and `reply.jwtSign()` | Official Fastify plugin, Fastify 5 compatible from v9, uses fast-jwt internally |
| @fastify/cookie | ^10.x | HttpOnly cookie read/write, required by @fastify/jwt for cookie mode | Official Fastify plugin, Fastify 5 compatible from v10 |
| bcryptjs | ^2.x | Password hashing with cost factor 12, no native build required | Pure JS, zero deps, same API as `bcrypt`, TypeScript types via @types/bcryptjs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/bcryptjs | ^2.x | TypeScript types for bcryptjs | Always (dev dep) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bcryptjs | bcrypt (native) | bcrypt is faster but requires node-gyp/Python build toolchain; bcryptjs works everywhere, Docker included |
| bcryptjs | argon2 | argon2 is stronger but more complex; bcrypt at cost 12 is adequate for single-admin use case |
| In-memory access token | sessionStorage | sessionStorage survives page refresh but accessible to XSS; pure in-memory is safer for AUTH-10 |
| Stateless logout | Token blacklist / Redis | Blacklist adds Redis dependency per requirement; stateless logout is fine for single-user admin dashboard with 15min token TTL |

**Installation (agent-server):**
```bash
npm install @fastify/jwt @fastify/cookie bcryptjs -w @ai-cofounder/agent-server
npm install --save-dev @types/bcryptjs -w @ai-cofounder/agent-server
```

**No dashboard package changes needed** — token management is handled in-browser with existing React + fetch stack.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
apps/agent-server/src/
├── plugins/
│   ├── auth.ts          # @fastify/jwt + @fastify/cookie registration + admin seed (onReady)
│   └── jwt-guard.ts     # Scoped Fastify plugin: onRequest JWT verification for /api/* routes
├── routes/
│   └── auth.ts          # POST /api/auth/login, /refresh, /logout
packages/db/src/
├── schema.ts            # Add adminUsers table (email, passwordHash, createdAt)
├── repositories.ts      # Add: findAdminByEmail, createAdminUser, countAdminUsers
├── drizzle/
│   └── 0018_add_admin_users.sql   # Migration
apps/dashboard/src/
├── hooks/
│   └── use-auth.ts      # Replace auth-guard.tsx — React context with in-memory token
├── api/
│   └── client.ts        # Update: accept token getter fn; 401 → refresh → retry
└── routes/
    └── login.tsx        # Replace: email+password form posting to /api/auth/login
```

### Pattern 1: Fastify Plugin Encapsulation for Route Protection

**What:** Register all JWT-protected routes inside a scoped plugin (NOT using fastify-plugin wrapper). The scoped plugin's `addHook('onRequest', ...)` applies only to routes registered within that scope.

**When to use:** Anytime you need to protect a subset of routes without applying a global hook.

**Example:**
```typescript
// plugins/jwt-guard.ts — NOT wrapped in fp(), so it creates a new scope
export async function jwtGuardPlugin(app: FastifyInstance) {
  // This hook only applies to routes registered INSIDE this plugin scope
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth routes themselves
    if (request.url.startsWith('/api/auth/')) return;
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Register all protected API routes here
  app.register(goalRoutes, { prefix: '/api/goals' });
  app.register(agentRoutes, { prefix: '/api/agents' });
  // ... all other API routes EXCEPT auth/webhooks/channels
}

// In server.ts:
// Bot-accessible routes (outside protected scope):
app.register(authRoutes, { prefix: '/api/auth' });
app.register(webhookRoutes, { prefix: '/api/webhooks' });
app.register(channelRoutes, { prefix: '/api/channels' });  // bot commands use this
// Everything else goes through JWT guard:
app.register(jwtGuardPlugin);
```

**Why this over global onRequest check:** Fastify encapsulation is the idiomatic pattern. No URL matching logic to maintain — route membership in the scope determines protection.

### Pattern 2: Two-Token JWT Setup

**What:** Two separate JWT sign/verify operations — access token (15min, returned in response body) and refresh token (7-day, set as HttpOnly cookie).

**Example:**
```typescript
// plugins/auth.ts
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

export const authPlugin = fp(async (app: FastifyInstance) => {
  // Register cookie plugin (required for refresh token cookie)
  await app.register(cookie, {
    secret: requireEnv('COOKIE_SECRET'),  // for signed cookies
  });

  // Register JWT plugin (for access token verification)
  await app.register(jwt, {
    secret: requireEnv('JWT_SECRET'),
    sign: { expiresIn: '15m' },
  });

  // Admin seed on startup
  app.addHook('onReady', async () => {
    const email = optionalEnv('ADMIN_EMAIL', '');
    const password = optionalEnv('ADMIN_PASSWORD', '');
    if (!email || !password) return;
    const count = await countAdminUsers(app.db);
    if (count === 0) {
      const hash = await bcrypt.hash(password, 12);
      await createAdminUser(app.db, { email, passwordHash: hash });
    }
  });
});
```

```typescript
// routes/auth.ts — login handler
const { email, password } = request.body;
const admin = await findAdminByEmail(app.db, email);
if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
  return reply.code(401).send({ error: 'Invalid credentials' });
}

// Access token — short-lived, returned in body
const accessToken = await reply.jwtSign({ sub: admin.id, email: admin.email });

// Refresh token — long-lived, set as HttpOnly cookie
const refreshToken = app.jwt.sign(
  { sub: admin.id, type: 'refresh' },
  { expiresIn: '7d' }
);
reply.setCookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth/refresh',  // Scope cookie to refresh endpoint only
  maxAge: 7 * 24 * 60 * 60,  // 7 days in seconds
});

return { accessToken };
```

```typescript
// routes/auth.ts — refresh handler
const refreshToken = request.cookies.refreshToken;
if (!refreshToken) return reply.code(401).send({ error: 'No refresh token' });

try {
  const payload = app.jwt.verify<{ sub: string; type: string }>(refreshToken);
  if (payload.type !== 'refresh') throw new Error('Wrong token type');
  const accessToken = await reply.jwtSign({ sub: payload.sub });
  return { accessToken };
} catch {
  reply.clearCookie('refreshToken');
  return reply.code(401).send({ error: 'Invalid refresh token' });
}
```

### Pattern 3: Dashboard In-Memory Token + 401 Retry

**What:** Access token stored in a module-level variable (or React context state). ApiClient accepts a `getToken()` function. On 401 response, call refresh endpoint, update stored token, retry original request once.

**Example:**
```typescript
// hooks/use-auth.ts
import { createContext, useContext, useState, useCallback } from 'react';

interface AuthContextValue {
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
}

// Module-level token — survives React re-renders, cleared on page reload
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}
```

```typescript
// api/client.ts — updated ApiClient with retry-on-401
private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = this.getToken?.();
  const headers = { ...this.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401 && this.onUnauthorized) {
    const newToken = await this.onUnauthorized();
    if (newToken) {
      const headers2 = { ...this.headers, Authorization: `Bearer ${newToken}` };
      const res2 = await fetch(`${this.baseUrl}${path}`, { method, headers: headers2, body: body ? JSON.stringify(body) : undefined });
      if (res2.ok) return res2.json() as Promise<T>;
    }
    throw new ApiError(401, 'Session expired');
  }
  // ... existing error handling
}
```

### Pattern 4: DB Schema for Admin Users

**What:** Separate `adminUsers` table from existing `users` table. The `users` table is for Discord/Slack/platform identities. Admin auth needs email + password_hash.

**Why separate:** Existing `users` table lacks email/password columns and is used by bots. Adding nullable columns to `users` would create confusion and break existing queries. A clean `adminUsers` table keeps concerns separated.

```typescript
// packages/db/src/schema.ts addition
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

```sql
-- 0018_add_admin_users.sql
CREATE TABLE IF NOT EXISTS "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

### Anti-Patterns to Avoid

- **Wrapping the JWT guard plugin with `fp()`:** fastify-plugin bypasses encapsulation, making the hook global. The guard plugin must NOT use `fp()` wrapper.
- **Token in localStorage:** AUTH-10 explicitly prohibits this. XSS can read localStorage; in-memory cannot be read by injected scripts.
- **JWT_SECRET as optionalEnv with empty default:** An empty or default secret means all tokens are signed with the same weak key. Must be `requireEnv('JWT_SECRET')` with startup failure if missing.
- **Storing refresh tokens in DB for v1:** Adds complexity without benefit for single-admin use case. Stateless is fine given 15min access token TTL.
- **Applying JWT middleware before bot routes:** Discord/Slack bots call `/api/channels/*` and `/api/webhooks/*` — they must remain outside JWT scope.
- **Checking `request.url` inside a global hook to skip paths:** Fragile string matching. Use Fastify encapsulation instead (proper pattern).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT sign/verify | Custom HMAC + base64 encoding | @fastify/jwt | Algorithm agility, expiry handling, aud/iss claims, timing-safe compare |
| Password hashing | SHA-256/MD5 | bcryptjs at cost 12 | bcrypt provides adaptive work factor and built-in salting; SHA is fast = brute-forceable |
| Cookie parsing | Manual `Cookie:` header parse | @fastify/cookie | Handles encoding, multiple cookies, signed cookies, SameSite serialization |
| Token expiry checking | `Date.now() > exp * 1000` | Let @fastify/jwt verify() handle it | JWT verify rejects expired tokens automatically; hand-rolling misses clock skew, alg confusion |

**Key insight:** The JWT algorithm confusion attack (accepting `alg: none`) is why you must never build your own verifier. @fastify/jwt uses fast-jwt which rejects `none` by default.

---

## Common Pitfalls

### Pitfall 1: Bot Routes Breaking After JWT Middleware

**What goes wrong:** Discord/Slack bots call `/api/channels/:id/conversation` and `/api/webhooks/github` without JWT headers. After JWT protection is applied globally, all bot commands return 401.

**Why it happens:** The team registers JWT guard as a global plugin wrapping all `/api/*` routes, including channel and webhook routes the bots depend on.

**How to avoid:** Keep bot-accessible routes (`/api/channels/*`, `/api/webhooks/*`) registered OUTSIDE the JWT-protected Fastify scope. Register them directly on `app` before the `jwtGuardPlugin` registration.

**Warning signs:** Discord bot `/ask` or `/goals` commands returning errors after Phase 3 deploy.

### Pitfall 2: HttpOnly Cookie Not Sent by Browser

**What goes wrong:** Browser does not send refresh cookie to `/api/auth/refresh`, causing refresh to always return 401.

**Why it happens:** Cookie has `path: '/api/auth/refresh'` but the refresh request URL is slightly different, OR the `sameSite: 'strict'` setting blocks it on the same page reload, OR `secure: true` rejects it on localhost HTTP.

**How to avoid:**
- Set `path: '/api/auth/refresh'` exactly matching the refresh endpoint URL.
- In development, use `secure: process.env.NODE_ENV === 'production'` to allow HTTP.
- Test the full login→refresh cycle in dev before production deploy.

**Warning signs:** `request.cookies.refreshToken` is `undefined` in the refresh handler.

### Pitfall 3: JWT_SECRET Not Set in Production

**What goes wrong:** Server starts with empty JWT_SECRET, all tokens are signed with empty string, any attacker who knows the secret ("") can forge tokens.

**Why it happens:** Using `optionalEnv('JWT_SECRET', '')` instead of `requireEnv('JWT_SECRET')`.

**How to avoid:** Always use `requireEnv('JWT_SECRET')` in the auth plugin. Add `JWT_SECRET` and `COOKIE_SECRET` to Docker Compose env in production. Add to `.env.example`.

**Warning signs:** Server starts without error but tokens are signed with empty key.

### Pitfall 4: Admin Seed Running Every Startup

**What goes wrong:** Admin password gets reset on every server restart if the seed logic doesn't check for existing admin.

**Why it happens:** Seed logic inserts without checking if admin already exists.

**How to avoid:** Check `countAdminUsers(app.db) > 0` before seeding. If already exists, skip seed entirely.

**Warning signs:** Admin password changes on every deploy.

### Pitfall 5: Token Expiry Race — Dashboard Shows Logged Out Briefly

**What goes wrong:** User makes a request, gets 401 (token expired), retry-on-401 calls refresh, gets new token, retries original — user sees a flash of error state or empty data before retry completes.

**Why it happens:** React Query shows error state immediately on 401 before the retry completes.

**How to avoid:** Implement the 401-catch-and-retry inside the `request()` method of `ApiClient`, BEFORE the error propagates to React Query. The retry is transparent to the UI layer.

**Warning signs:** Users briefly see "Unauthorized" errors during normal usage.

### Pitfall 6: @fastify/cookie Not Registered Before @fastify/jwt

**What goes wrong:** @fastify/jwt tries to read cookies but `request.cookies` is undefined because `@fastify/cookie` was not registered first.

**Why it happens:** Registration order matters — `@fastify/cookie` must be registered before `@fastify/jwt` in the auth plugin.

**How to avoid:** Always register cookie plugin first, then JWT plugin, inside the same `authPlugin` wrapped with `fp()`.

---

## Code Examples

### Register Auth Plugin (server.ts change)

```typescript
// Source: Fastify plugin encapsulation documentation
import { authPlugin } from './plugins/auth.js';
import { jwtGuardPlugin } from './plugins/jwt-guard.js';
import { authRoutes } from './routes/auth.js';

// In buildServer():
app.register(authPlugin);  // registers jwt + cookie + admin seed (global, uses fp())

// Public/bot routes — outside JWT scope:
app.register(healthRoutes);
app.register(authRoutes, { prefix: '/api/auth' });
app.register(webhookRoutes, { prefix: '/api/webhooks' });
app.register(channelRoutes, { prefix: '/api/channels' });  // bots need this

// All other API routes — inside JWT-protected scope:
app.register(jwtGuardPlugin);  // NOT wrapped in fp(), creates new scope
```

### JWT Guard Plugin (scoped, no fp())

```typescript
// apps/agent-server/src/plugins/jwt-guard.ts
// Source: Fastify encapsulation docs
import type { FastifyInstance } from 'fastify';
import { goalRoutes } from '../routes/goals.js';
// ... all other protected route imports

export async function jwtGuardPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // All routes that require JWT:
  app.register(agentRoutes, { prefix: '/api/agents' });
  app.register(goalRoutes, { prefix: '/api/goals' });
  app.register(taskRoutes, { prefix: '/api/tasks' });
  // ... all other protected routes
}
```

### bcryptjs Hashing Pattern

```typescript
// Source: bcryptjs npm documentation
import bcrypt from 'bcryptjs';

// Hash on registration/admin-seed:
const SALT_ROUNDS = 12;
const hash = await bcrypt.hash(plainTextPassword, SALT_ROUNDS);

// Compare on login:
const isValid = await bcrypt.compare(candidatePassword, storedHash);
if (!isValid) return reply.code(401).send({ error: 'Invalid credentials' });
```

### Dashboard Auth Hook (in-memory token)

```typescript
// apps/dashboard/src/hooks/use-auth.ts
// Module-level — not in React state, not in localStorage
let _accessToken: string | null = null;

export function getAccessToken() { return _accessToken; }
export function setAccessToken(token: string | null) { _accessToken = token; }

export function useAuth() {
  const isAuthenticated = !!_accessToken;

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    const { accessToken } = await res.json() as { accessToken: string };
    setAccessToken(accessToken);
  };

  const logout = async () => {
    setAccessToken(null);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/dashboard/login';
  };

  const refresh = async (): Promise<string | null> => {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) { setAccessToken(null); return null; }
    const { accessToken } = await res.json() as { accessToken: string };
    setAccessToken(accessToken);
    return accessToken;
  };

  return { isAuthenticated, login, logout, refresh };
}
```

### Updated AuthGuard (checks in-memory token)

```typescript
// apps/dashboard/src/components/auth/auth-guard.tsx
import { Navigate } from 'react-router';
import type { ReactNode } from 'react';
import { getAccessToken } from '@/hooks/use-auth';

export function AuthGuard({ children }: { children: ReactNode }) {
  // Check in-memory token (not localStorage per AUTH-10)
  if (!getAccessToken()) {
    return <Navigate to="/dashboard/login" replace />;
  }
  return <>{children}</>;
}
```

### Updated LoginPage (email + password)

```typescript
// apps/dashboard/src/routes/login.tsx — replaces API secret form
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    await login(email, password);  // calls useAuth().login
    navigate('/dashboard');
  } catch {
    setError('Invalid email or password');
  }
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `localStorage` for auth tokens | In-memory module variable | Security best practice since ~2020 | XSS cannot steal token; page reload triggers re-login |
| Global bearer token check (API_SECRET) | JWT with short-lived tokens + refresh | Phase 3 | Proper expiry; multiple user support possible later |
| LoginPage with API secret field | Email + password form | Phase 3 | Proper credentials flow |
| auth-guard.tsx reads localStorage | Reads in-memory token | Phase 3 | AUTH-10 compliance |

**Deprecated/outdated (in this codebase):**
- `localStorage.getItem("ai-cofounder-token")` in `auth-guard.tsx`: Replace with `getAccessToken()` from new hook.
- `apiClient = new ApiClient({ apiSecret: localStorage.getItem(...) })` in `api/client.ts`: Replace with dynamic token getter.
- LoginPage's API secret field: Replace with email + password form posting to `/api/auth/login`.

---

## Open Questions

1. **Interaction between existing `API_SECRET` bearer check and new JWT check**
   - What we know: `securityPlugin` has `if (apiSecret && url.startsWith('/api/') && !isInternalRequest(...)) { check bearer }`. This runs globally for all `/api/*` requests.
   - What's unclear: If both `API_SECRET` and JWT are active, dashboard requests will fail because they don't have `API_SECRET` in headers.
   - Recommendation: When `JWT_SECRET` is set (Phase 3 active), the security plugin's bearer check should be disabled or made JWT-aware. Simplest approach: In `securityPlugin`, skip the `API_SECRET` check if `JWT_SECRET` is configured (they are mutually exclusive auth mechanisms). Or the planner can choose to always disable `API_SECRET` in Phase 3 since JWT supersedes it.

2. **Cookie `credentials: 'include'` requirement for cross-origin dev**
   - What we know: Dashboard at port 3200 (dev), API at 3100. HttpOnly cookies require `credentials: 'include'` in fetch + CORS `credentials: true` on server.
   - What's unclear: Production is same-origin (dashboard served by agent-server), so this only matters in dev.
   - Recommendation: Add `credentials: 'include'` to all ApiClient fetch calls in dev. Set `allowedCredentials: true` in CORS config. Planner should document this as a dev-only concern.

3. **Token persistence across page reload**
   - What we know: In-memory token is lost on page reload (required by AUTH-10). User will need to log in again after reload.
   - What's unclear: Is this acceptable UX for a developer dashboard? The refresh cookie persists, so auto-refresh on load is possible.
   - Recommendation: On app init (`main.tsx`), attempt a silent refresh via `/api/auth/refresh` (uses HttpOnly cookie automatically). If cookie exists and is valid, restore access token silently. If not, redirect to login. This gives the best of both worlds — no localStorage, but survives page reload.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` at monorepo root |
| Quick run command | `npm run test -w @ai-cofounder/agent-server` |
| Full suite command | `npm run test` |
| Estimated runtime | ~15-20 seconds (existing suite ~40 tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | POST /api/auth/login returns 200 with accessToken on valid credentials | unit (inject) | `npm run test -w @ai-cofounder/agent-server -- --grep "auth routes"` | ❌ Wave 0 gap |
| AUTH-01 | POST /api/auth/login returns 401 on wrong password | unit (inject) | same | ❌ Wave 0 gap |
| AUTH-02 | Returned access token JWT has 15min expiry | unit | same | ❌ Wave 0 gap |
| AUTH-03 | Login response sets HttpOnly + Secure + SameSite=Strict refresh cookie | unit (inject, check reply.cookies) | same | ❌ Wave 0 gap |
| AUTH-04 | GET /api/goals without Authorization header returns 401 | unit (inject) | same | ❌ Wave 0 gap |
| AUTH-04 | GET /api/goals with valid JWT returns 200 | unit (inject) | same | ❌ Wave 0 gap |
| AUTH-05 | POST /api/auth/refresh with valid cookie returns new accessToken | unit (inject, set cookie) | same | ❌ Wave 0 gap |
| AUTH-05 | POST /api/auth/refresh without cookie returns 401 | unit (inject) | same | ❌ Wave 0 gap |
| AUTH-06 | POST /api/auth/logout clears the refreshToken cookie | unit (inject, check clearCookie) | same | ❌ Wave 0 gap |
| AUTH-07 | Admin user created on startup when none exists | unit (mock db, spy onReady) | same | ❌ Wave 0 gap |
| AUTH-07 | Admin user NOT created when one already exists | unit | same | ❌ Wave 0 gap |
| AUTH-08 | Stored password is bcrypt hash (starts with $2b$) | unit | same | ❌ Wave 0 gap |
| AUTH-08 | bcrypt.compare validates correct password | unit | same | ❌ Wave 0 gap |
| AUTH-09 | POST /api/channels/:id/conversation works without JWT | unit (inject, no auth header) | same | ❌ Wave 0 gap |
| AUTH-09 | POST /api/webhooks/github works without JWT | unit (inject, no auth header) | same | ❌ Wave 0 gap |
| AUTH-10 | Dashboard AuthGuard redirects to /dashboard/login when no in-memory token | unit (RTL) | `npm run test -w @ai-cofounder/dashboard` | ❌ Wave 0 gap (existing test uses localStorage) |
| AUTH-10 | Dashboard LoginPage posts to /api/auth/login (not validates against health) | unit (RTL) | same | ❌ Wave 0 gap |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~15-20 seconds

### Wave 0 Gaps (must be created before implementation)

- [ ] `apps/agent-server/src/__tests__/auth-routes.test.ts` — covers AUTH-01 through AUTH-09
- [ ] `apps/dashboard/src/__tests__/components/auth-guard.test.tsx` — UPDATE existing test to use in-memory token not localStorage (covers AUTH-10)
- [ ] `apps/dashboard/src/__tests__/routes/login.test.tsx` — covers AUTH-10 login form

Note on test structure: Agent-server tests follow the established pattern of mocking `@ai-cofounder/db`, `@ai-cofounder/llm`, and `@ai-cofounder/shared` at the top, then importing `buildServer` dynamically. The new `auth-routes.test.ts` must also mock `bcryptjs`.

---

## Sources

### Primary (HIGH confidence)

- Context: Direct code inspection of existing codebase (server.ts, security.ts, auth-guard.tsx, login.tsx, schema.ts, repositories.ts, api/client.ts)
- [@fastify/jwt GitHub README](https://github.com/fastify/fastify-jwt) — registration API, sign/verify, cookie integration, TypeScript patterns
- [@fastify/cookie GitHub](https://github.com/fastify/fastify-cookie) — HttpOnly/Secure/SameSite cookie API, version 10.x for Fastify 5
- [Fastify Plugins docs](https://fastify.dev/docs/latest/Reference/Plugins/) — encapsulation pattern for selective route protection

### Secondary (MEDIUM confidence)

- [bcryptjs npm](https://www.npmjs.com/package/bcryptjs) — pure JS bcrypt, @types/bcryptjs, cost factor 12
- WebSearch: bcryptjs vs bcrypt comparison — verified: both use same API, bcryptjs avoids native build issues
- WebSearch: @fastify/jwt v9 Fastify 5 compatibility — verified: v9+ supports Fastify 5

### Tertiary (LOW confidence)

- WebSearch: JWT refresh token HttpOnly cookie pattern — standard web security practice, cross-referenced with requirement AUTH-10 text

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @fastify/jwt v9+, @fastify/cookie v10+, bcryptjs all verified via official GitHub and npm
- Architecture: HIGH — Fastify encapsulation pattern verified via official docs; code patterns derived from direct codebase inspection
- Pitfalls: HIGH — Bot route breaking (directly observed in STATE.md as a known concern), cookie/credential issues are standard HttpOnly pitfalls, JWT_SECRET empty-default is a known security mistake

**Research date:** 2026-03-08
**Valid until:** 2026-05-08 (stable ecosystem, 60-day window)
