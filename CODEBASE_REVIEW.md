# Observatory QA — Codebase Review

**Date**: 2026-03-14
**Scope**: Full codebase review — security, performance, correctness, architecture

---

## Critical Issues

### 1. Cross-Tenant Data Leak via `getUser()` and `getUserByUsername()`

**Files**: `server/storage/types.ts:109-110`, `server/db/pg-storage.ts:103-111`

Both `getUser(id)` and `getUserByUsername(username)` do **not** take `orgId` as a parameter, unlike every other storage method. This means:

- In `server/auth.ts:340`, `storage.getUser(id)` during deserialization fetches a user by ID without org scoping. A user ID from one org could theoretically collide or be guessed.
- In `server/routes/admin.ts:270`, `storage.getUser(req.params.id)` is called without orgId — there's a manual `user.orgId !== req.orgId` check afterward, but the data was already fetched cross-tenant.
- `getUserByUsername()` is inherently global (usernames are globally unique), but this means username enumeration across orgs is possible.

**Recommendation**: Add `orgId` parameter to `getUser()` or at minimum ensure all callers verify `user.orgId` matches. Consider making usernames org-scoped (e.g., `username@orgSlug`) for true multi-tenant isolation.

---

### 2. Duplicate Check Loads ALL Calls into Memory

**File**: `server/routes/calls.ts:386-388`

```typescript
const existingCalls = await storage.getCallsWithDetails(req.orgId!, {});
const duplicate = existingCalls.find(c => c.fileHash === fileHash && c.status !== "failed");
```

On every file upload, **all calls with full details** (transcripts, analyses, sentiments) are loaded into memory just to check for a duplicate hash. For an org with thousands of calls, this is:
- A severe memory spike (transcripts can be large)
- An O(n) scan that should be a database index lookup

**Recommendation**: Add a `getCallByFileHash(orgId, fileHash)` method to the storage interface backed by a database index on `(org_id, file_hash)`.

---

### 3. WebSocket Org Resolution Only Works for Env Users

**File**: `server/services/websocket.ts:46`, `server/auth.ts:399-402`

```typescript
export function resolveUserOrgId(userId: string): string | undefined {
  const user = envUsers.find((u) => u.id === userId);
  return user?.orgId;
}
```

`resolveUserOrgId()` only searches `envUsers` (loaded from `AUTH_USERS` env var). **Database users** (created via registration, invitation, or admin UI) will always return `undefined`, causing their WebSocket connections to be **rejected with 403**. This means real-time call processing updates are broken for all DB-created users.

**Recommendation**: Fall back to `storage.getUser(userId)` for DB users when the env user lookup fails.

---

### 4. No Rate Limiting on Registration Endpoint

**File**: `server/routes/registration.ts:24`, `server/index.ts:136`

Only `/api/auth/login` has rate limiting. The `/api/auth/register` endpoint is unprotected, allowing:
- Automated org/user creation spam
- Resource exhaustion (each registration creates an org + user + potentially triggers DB writes)

**Recommendation**: Apply rate limiting to `/api/auth/register` (e.g., 3 registrations per IP per hour).

---

### 5. Organization Settings Update Accepts Arbitrary JSON

**File**: `server/routes/admin.ts:300-312`

```typescript
const updatedSettings = { ...org.settings, ...req.body };
```

The `PATCH /api/organization/settings` endpoint spreads `req.body` directly into org settings with no validation against `orgSettingsSchema`. An admin could inject arbitrary keys or override critical fields like `aiProvider` with invalid values.

**Recommendation**: Validate `req.body` against `orgSettingsSchema.partial()` before merging.

---

## High Priority Issues

### 6. `console.log` / `console.warn` Used Instead of Structured Logger

**Files**: Throughout `server/routes/calls.ts`, `server/auth.ts`, `server/services/websocket.ts`, and others

The project has a proper Pino structured logger (`server/services/logger.ts`), but many files still use `console.log`/`console.warn`/`console.error`. This means:
- Log output is unstructured and not captured by Betterstack
- No log levels, timestamps, or correlation IDs
- HIPAA audit trail is incomplete for console-logged events

**Recommendation**: Replace all `console.*` calls with `logger.*` equivalents. Grep shows ~50+ instances.

---

### 7. Password Hashing Logic Duplicated in 3 Places

**Files**: `server/auth.ts:76-79`, `server/routes/registration.ts:11-14`, `server/routes/admin.ts:203-208`

The scrypt password hashing is copy-pasted in three separate files. If the hashing parameters need to change (e.g., increasing scrypt cost), all three must be updated in sync.

**Recommendation**: Export `hashPassword()` from `server/auth.ts` and import it in registration and admin routes.

---

### 8. Bulk Re-analysis Runs Unbounded in Background

**File**: `server/routes/admin.ts:117-155`

The re-analysis endpoint processes calls sequentially in an async IIFE with no backpressure, no cancellation mechanism, and no job queue usage. If an admin queues 50 calls, the server will:
- Make 50 sequential AI provider calls (each taking 10-30s)
- Consume the connection for 8-25 minutes
- Have no visibility into progress (only a final broadcast)
- No way to cancel mid-flight

**Recommendation**: Use BullMQ queue (already defined as `bulk-reanalysis` in `server/services/queue.ts`) instead of inline processing. The queue infrastructure already exists.

---

### 9. `getCallsWithDetails` Called Excessively for Reporting

**File**: `server/routes/reports.ts` (5 calls), `server/routes/insights.ts:12`

Reports endpoints load ALL completed calls with full details into memory to compute aggregates. This is an O(n) memory pattern that won't scale.

**Recommendation**: Add aggregate query methods to the storage interface (e.g., `getPerformanceMetrics(orgId, dateRange)`) that compute averages/distributions at the database level.

---

### 10. No File Size Limit on Audio Upload

**File**: `server/routes/calls.ts:366`, `server/routes/helpers.ts` (multer config)

The multer upload configuration should enforce a maximum file size. Without it, a user could upload a multi-GB file, causing:
- Memory exhaustion (`fs.readFileSync` at line 384 reads the entire file into a Buffer)
- Extended processing times
- Large S3 storage costs

**Recommendation**: Set `limits: { fileSize: 100 * 1024 * 1024 }` (100MB) in multer config, and use streaming instead of `readFileSync`.

---

### 11. Missing CSRF Protection

**File**: `server/index.ts`

The app uses cookie-based sessions with `sameSite: "lax"`. While `lax` prevents CSRF on POST from cross-origin `<form>` submissions, it doesn't protect against:
- Requests from same-site subdomains
- Certain redirect-based attacks

For a HIPAA-compliant system, explicit CSRF token protection (e.g., `csurf` or double-submit cookie pattern) would be more robust.

---

## Medium Priority Issues

### 12. In-Memory Rate Limiter Never Cleans Up on `req.path` Variations

**File**: `server/index.ts:17`

The rate limit key is `${req.ip}:${req.path}`. Since `req.path` can include query strings or trailing slashes differently, the same logical endpoint could create multiple rate limit entries. Also, `req.ip` may be `undefined` behind proxies without `trust proxy`.

---

### 13. No Pagination on List Endpoints

**Files**: `server/routes/calls.ts:316-328`, `server/routes/admin.ts:167-183`, others

`GET /api/calls`, `GET /api/users`, `GET /api/employees`, etc. return all records with no pagination. As data grows, response sizes will become unmanageable.

**Recommendation**: Add `limit`/`offset` or cursor-based pagination to all list endpoints.

---

### 14. `mapConcurrent` Has a Race Condition

**File**: `server/storage/types.ts:40-53`

```typescript
while (index < items.length) {
  const i = index++;
}
```

While JavaScript is single-threaded and `index++` won't race in practice, the pattern is fragile. If the `fn` callback uses `await`, control can yield and multiple workers could read the same `index` before it's incremented — though in practice, `index++` is atomic in the event loop.

**Status**: Not a real bug in Node.js, but the pattern is misleading. Consider using a proper async pool library.

---

### 15. `setInterval` Timers Not Stored for Cleanup

**File**: `server/index.ts:58-63`, `server/auth.ts:21-28`

Multiple `setInterval` calls (rate limit cleanup, lockout cleanup, retention scheduling) are not stored in variables for cleanup during graceful shutdown. This can cause the process to hang on shutdown.

**Recommendation**: Store interval handles and clear them in the shutdown handler.

---

### 16. SigV4 Signing Code Duplicated

**Files**: `server/services/s3.ts`, `server/services/bedrock.ts`, `server/services/embeddings.ts`

AWS SigV4 signing logic is implemented independently in three files. Any signing bug or credential handling change must be fixed in all three.

**Recommendation**: Extract a shared `signAwsRequest()` utility.

---

### 17. No Input Sanitization on Search Endpoints

**File**: `server/routes/calls.ts:318`, `server/routes/reports.ts` (various)

Query parameters like `status`, `sentiment`, `employee` are passed directly to storage without validation. While the storage layer does string comparison (not SQL injection), unexpected values could cause confusing results.

**Recommendation**: Validate query parameters against allowed values using Zod.

---

### 18. Error Handler Exposes Error Messages

**File**: `server/index.ts:165-173`

```typescript
const message = err.message || "Internal Server Error";
res.status(status).json({ message });
```

For 500 errors, the raw error message is sent to the client. This could leak internal details (database connection strings, file paths, etc.) in production.

**Recommendation**: For status >= 500, always return a generic message to the client and log the real error server-side.

---

## Lower Priority / Improvements

### 19. TypeScript Strictness

- `tsconfig.json` should enable `strict: true` if not already
- Several `as any` casts throughout the codebase (e.g., `server/routes/admin.ts:249`, `server/routes/billing.ts:381`)
- `req.orgId!` non-null assertions are used extensively — consider making the type non-optional after `injectOrgContext`

### 20. Missing Test Coverage

The following modules have **no test coverage**:
- `server/services/bedrock.ts` — SigV4 signing, API calls
- `server/services/s3.ts` — SigV4 signing, S3 operations
- `server/services/gemini.ts` — Gemini API integration
- `server/services/websocket.ts` — WebSocket connection handling
- `server/services/stripe.ts` — Stripe integration
- `server/services/rag.ts` — RAG retrieval
- `server/services/chunker.ts` — Document chunking
- `server/services/embeddings.ts` — Embedding generation
- `server/storage/pg-storage.ts` — PostgreSQL storage (integration tests)
- `server/routes/billing.ts` — Billing/checkout flows
- `server/routes/onboarding.ts` — Onboarding flow
- All frontend components/pages

### 21. Package Naming

**File**: `package.json:2`

Package name is `"rest-express"` — a generic placeholder from project scaffolding. Should be `"observatory-qa"` or `"@observatoryqa/platform"`.

### 22. Replit Dev Dependencies in Production Build

**File**: `package.json:96-98`

```json
"@replit/vite-plugin-cartographer": "^0.3.1",
"@replit/vite-plugin-dev-banner": "^0.1.1",
"@replit/vite-plugin-runtime-error-modal": "^0.0.3",
```

These Replit-specific plugins are in devDependencies (fine for builds) but may cause confusion in non-Replit environments. Consider removing if no longer deploying on Replit.

### 23. `tailwindcss` Version Mismatch

**File**: `package.json:99,117`

`@tailwindcss/vite: ^4.1.3` (Tailwind v4 plugin) is listed alongside `tailwindcss: ^3.4.17` (v3). These are incompatible versions — the v4 Vite plugin expects Tailwind v4 CSS syntax.

### 24. Unused `next-themes` Dependency

**File**: `package.json:70`

`next-themes` is a Next.js-specific package. This project uses Vite + Wouter, not Next.js. Dark mode is implemented with custom CSS. This dependency appears unused.

---

## Architecture Observations

### Strengths
- **Solid multi-tenant isolation** at the storage layer — `orgId` is required on nearly all storage methods
- **Graceful degradation** — every external dependency has a fallback (Redis, S3, AI providers)
- **HIPAA-aware design** — audit logging, session timeouts, security headers, encryption considerations
- **Clean separation** — routes, services, storage, and shared schemas are well-organized
- **Per-org AI provider configuration** is a strong multi-tenant feature
- **RAG system** is well-architected with hybrid search (semantic + BM25)

### Areas for Growth
- **No database migrations versioning** — schema changes rely on `drizzle-kit push` which can be destructive. Production should use versioned migrations
- **No health check for AI providers** — the `/api/health` endpoint should verify AI provider connectivity
- **No request ID / correlation ID** — makes debugging distributed issues difficult
- **No graceful handling of concurrent uploads** for the same file — the duplicate check is not atomic
- **Worker processes share no health monitoring** — no way to know if a worker is stuck or dead

---

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| Critical | 5 | Cross-tenant data access, WebSocket auth for DB users, memory-heavy duplicate check |
| High | 6 | Console logging, code duplication, no pagination, file size limits |
| Medium | 7 | Rate limiting gaps, CSRF, error message leaks, input validation |
| Low | 6 | Package config, test coverage, TypeScript strictness |

The highest-impact fixes are:
1. Fix WebSocket org resolution for DB users (#3)
2. Add `getCallByFileHash()` to avoid loading all calls on upload (#2)
3. Validate org settings updates (#5)
4. Rate-limit registration (#4)
5. Replace `console.*` with structured logger (#6)
