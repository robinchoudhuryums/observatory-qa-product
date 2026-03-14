# Observatory QA — Comprehensive Codebase Review

**Date**: 2026-03-14
**Scope**: Full codebase review — security, performance, correctness, architecture, frontend, workers, deployment, testing

---

## Critical Issues

### 1. Cross-Tenant Data Leak via `getUser()` and `getUserByUsername()`

**Files**: `server/storage/types.ts:109-110`, `server/db/pg-storage.ts:103-111`

Both `getUser(id)` and `getUserByUsername(username)` do **not** take `orgId` as a parameter, unlike every other storage method. This means:

- In `server/auth.ts:340`, `storage.getUser(id)` during deserialization fetches a user by ID without org scoping
- In `server/routes/admin.ts:270`, `storage.getUser(req.params.id)` is called without orgId — there's a manual `user.orgId !== req.orgId` check afterward, but the data was already fetched cross-tenant
- `getUserByUsername()` is inherently global (usernames are globally unique), enabling username enumeration across orgs

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

`resolveUserOrgId()` only searches `envUsers` (loaded from `AUTH_USERS` env var). **Database users** (created via registration, invitation, or admin UI) will always return `undefined`, causing their WebSocket connections to be **rejected with 403**. Real-time call processing updates are broken for all DB-created users.

**Recommendation**: Fall back to `storage.getUser(userId)` for DB users when the env user lookup fails.

---

### 4. No Rate Limiting on Registration Endpoint

**File**: `server/routes/registration.ts:24`, `server/index.ts:136`

Only `/api/auth/login` has rate limiting. The `/api/auth/register` endpoint is unprotected, allowing:
- Automated org/user creation spam
- Resource exhaustion (each registration creates an org + user + DB writes)

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

### 6. `insertUserSchema` Has Optional `orgId`

**File**: `shared/schema.ts:40`

```typescript
export const insertUserSchema = z.object({
  orgId: z.string().optional(), // ← SHOULD BE REQUIRED
```

Multi-tenant safety violation — `orgId` should never be optional on user creation. A user created without an org breaks tenant isolation.

**Recommendation**: Make `orgId` required in `insertUserSchema`.

---

### 7. Unvalidated `JSON.parse` — DoS/Crash Risk

**File**: `server/routes/onboarding.ts:326`

```typescript
appliesTo: appliesTo ? JSON.parse(appliesTo) : undefined,
```

User-supplied `appliesTo` parameter parsed without try-catch. Malformed JSON crashes the request handler.

**Also in**: `server/routes/reports.ts:338,353,485,499` — stored analysis data parsed without error handling; corrupted DB data crashes the endpoint.

**Recommendation**: Wrap all `JSON.parse` calls in try-catch or use a safe parsing utility.

---

### 8. No CI/CD Pipeline

No `.github/workflows/`, `.gitlab-ci.yml`, or any CI configuration exists. This means:
- No automated tests on PRs
- No automated builds or deployments
- No gated quality checks before merge

**Recommendation**: Add GitHub Actions workflow for test, typecheck, and build on every PR.

---

## High Priority Issues

### 9. `console.log` / `console.warn` Used Instead of Structured Logger

**Files**: `server/routes/calls.ts`, `server/auth.ts`, `server/services/websocket.ts`, `server/services/bedrock.ts`, `server/services/assemblyai.ts`, `server/services/notifications.ts`, and others (~50+ instances)

The project has Pino structured logging (`server/services/logger.ts`) with Betterstack transport, but many files use `console.*`. This is a **HIPAA compliance gap** — unstructured console logs bypass the audit trail and aren't captured by Betterstack.

**Recommendation**: Replace all `console.*` calls with `logger.*` equivalents.

---

### 10. Password Hashing Logic Duplicated in 3 Places

**Files**: `server/auth.ts:76-79`, `server/routes/registration.ts:11-14`, `server/routes/admin.ts:203-208`

The scrypt password hashing is copy-pasted in three files. If hashing parameters change, all three must update in sync.

**Recommendation**: Export `hashPassword()` from `server/auth.ts` and import elsewhere.

---

### 11. Bulk Re-analysis Runs Unbounded in Background (Not Using Queue)

**File**: `server/routes/admin.ts:117-155`

The re-analysis endpoint processes calls sequentially in an async IIFE — no backpressure, no cancellation, no persistence. Jobs are lost on process crash. The BullMQ `bulk-reanalysis` queue already exists but isn't used here.

**Recommendation**: Use `enqueueReanalysis()` from `server/services/queue.ts`.

---

### 12. `getCallsWithDetails` Called Excessively for Reporting

**File**: `server/routes/reports.ts` (5 calls), `server/routes/insights.ts:12`, `server/routes/admin.ts:87`

Reports load ALL completed calls with full details (transcripts, sentiments, analyses) into memory to compute aggregates. This is O(n) memory and won't scale.

**Recommendation**: Add aggregate query methods (e.g., `getPerformanceMetrics(orgId, dateRange)`) that compute at the database level.

---

### 13. No File Size Limit on Audio Upload

**File**: `server/routes/calls.ts:366,384`

No multer `limits.fileSize` configured. `fs.readFileSync` at line 384 reads the entire uploaded file into a Buffer.

**Recommendation**: Set `limits: { fileSize: 100 * 1024 * 1024 }` in multer config and consider streaming.

---

### 14. Missing Frontend Route Guards

**File**: `client/src/App.tsx:157-172`

All routes are accessible to any authenticated user regardless of role. Admin/manager-only pages (`/admin`, `/prompt-templates`, `/coaching`) rely solely on sidebar link filtering, which is UI-only.

**Recommendation**: Add a `ProtectedRoute` wrapper that checks `user.role` before rendering.

---

### 15. WebSocket Server Missing Error Handlers and Shutdown

**File**: `server/services/websocket.ts`

- No `wss.on("error")` handler — server errors go unlogged
- `broadcastCallUpdate()` calls `client.send()` without try-catch — broken pipe errors are swallowed
- No `closeWebSocket()` export — WebSocket server can't be shut down gracefully
- No `ws.on("close")` handler for explicit `clientOrgMap` cleanup

**Recommendation**: Add error handlers, wrap `send()` in try-catch, export shutdown function.

---

### 16. Indexing Worker Missing Error Handler

**File**: `server/workers/indexing.worker.ts:30-48`

The indexing worker is the only worker without a `.on("failed")` error handler. Failed RAG indexing jobs fail silently — users don't know their documents weren't processed.

**Recommendation**: Add `worker.on("failed", ...)` like the other workers.

---

## Medium Priority Issues

### 17. Missing CSRF Protection

**File**: `server/index.ts`

Cookie-based sessions with `sameSite: "lax"` — doesn't protect against same-site subdomain attacks or certain redirects. For HIPAA, explicit CSRF token protection is recommended.

---

### 18. Error Handler Exposes Internal Error Messages

**File**: `server/index.ts:165-173`

For 500 errors, `err.message` is sent to the client. Could leak database connection strings, file paths, or internal details.

**Recommendation**: Return generic "Internal Server Error" for status >= 500.

---

### 19. No Pagination on List Endpoints

**Files**: `server/routes/calls.ts:316`, `server/routes/admin.ts:167`, others

All list endpoints return unbounded results.

---

### 20. SigV4 Signing Code Duplicated in 3 Files

**Files**: `server/services/s3.ts`, `server/services/bedrock.ts`, `server/services/embeddings.ts`

**Recommendation**: Extract a shared `signAwsRequest()` utility.

---

### 21. `setInterval` Timers Not Stored for Cleanup

**Files**: `server/index.ts:58-63`, `server/auth.ts:21-28`, `server/index.ts:233`

Multiple `setInterval` calls aren't stored for cleanup during graceful shutdown, causing process hang.

---

### 22. CloudStorage N+1 Query Pattern

**File**: `server/storage/cloud.ts:189-204`

`getCallsWithDetails()` fetches all calls, then for EACH call makes 4 concurrent S3 requests (employee, transcript, sentiment, analysis). With 100 calls = 400 S3 API calls.

---

### 23. RAG Worker Database Pool Never Closed

**File**: `server/services/rag-worker.ts:15-25`

The in-process RAG worker creates a PostgreSQL pool that's never closed on shutdown, leaking connections.

---

### 24. Stripe Webhook Metadata Not Validated

**File**: `server/routes/billing.ts:334,364,394`

`orgId` from Stripe webhook metadata is trusted without validation. If the Stripe account is compromised, arbitrary org billing state could be manipulated.

---

### 25. In-Memory Rate Limiter Key Issues

**File**: `server/index.ts:17`

Rate limit key `${req.ip}:${req.path}` — `req.ip` may be `undefined` behind proxies. Path variations (trailing slash, query strings) create separate entries.

---

### 26. Build Script Missing Optimizations

**File**: `package.json:8`

```json
"build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist"
```

Missing `--minify`, `--sourcemap`, and doesn't run `tsc` type check first. Production bundles are unoptimized and undebuggable.

---

## Lower Priority / Improvements

### 27. ~70% Test Coverage Gap

12 test files exist but the following have **zero tests**:
- All external services (AssemblyAI, Bedrock, S3, Stripe)
- Entire RAG system (rag.ts, chunker.ts, embeddings.ts)
- Infrastructure services (Redis, BullMQ, WebSocket, audit logging)
- 12 of 17 route files (including core `calls.ts`)
- All frontend components/pages
- Storage implementations (pg-storage.ts, cloud.ts)

### 28. Package Naming

`package.json:2` — Package named `"rest-express"`, should be `"observatory-qa"`.

### 29. Tailwind Version Mismatch

`package.json:99,117` — `@tailwindcss/vite: ^4.1.3` (v4 plugin) alongside `tailwindcss: ^3.4.17` (v3). Incompatible.

### 30. Unused Dependencies

- `next-themes` (`package.json:70`) — Next.js package, not used in this Vite project
- Replit-specific plugins (`package.json:96-98`) — remove if not deploying on Replit

### 31. Dashboard/Admin Error States Not Displayed

**Files**: `client/src/pages/dashboard.tsx:19-28`, `client/src/pages/admin.tsx:20`

Query errors are fetched but never rendered — users see blank screens on API failure.

### 32. Deployment Scripts Incomplete

**File**: `deploy/ec2/user-data.sh:45-48`

Git clone step is commented out. No database migration step in `deploy.sh`. No rollback mechanism. `.env` stored in plaintext on EBS (HIPAA encryption-at-rest gap).

### 33. 16 npm Dependency Vulnerabilities

4 high-severity (body-parser, express, express-session, multer), 7 moderate (esbuild, vite, rollup), 5 low.

### 34. Provider Cache Race Condition

**File**: `server/services/ai-factory.ts:49-71`

Multiple concurrent requests can create duplicate provider instances for the same org before caching.

---

## Architecture Observations

### Strengths
- **Solid multi-tenant isolation** at the storage layer — `orgId` required on nearly all methods
- **Graceful degradation** — every external dependency has a fallback
- **HIPAA-aware design** — audit logging, session timeouts, security headers, account lockout
- **Clean code organization** — routes, services, storage, and shared schemas well-separated
- **AI provider configuration** via `ai-factory.ts`
- **RAG system** well-architected with hybrid search (semantic + BM25)
- **Worker concurrency control** — bounded concurrency prevents resource exhaustion
- **Strong systemd hardening** in deployment service file
- **API key security** — SHA-256 hashed, never stored plaintext

### Areas for Growth
- **No database migrations versioning** — `drizzle-kit push` is destructive. Use versioned migrations
- **No health check for AI providers** — `/api/health` should verify AI connectivity
- **No request ID / correlation ID** — makes distributed debugging difficult
- **No graceful concurrent upload handling** — duplicate check is not atomic
- **Worker health monitoring** — no way to know if a worker is stuck/dead
- **No secrets management** — `.env` plaintext instead of AWS Secrets Manager / KMS

---

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| Critical | 8 | Cross-tenant access, WebSocket auth, memory-heavy queries, no CI/CD, crash-prone JSON.parse |
| High | 8 | Console logging, code duplication, no route guards, missing error handlers |
| Medium | 10 | CSRF, error leaks, no pagination, SigV4 duplication, pool leaks, webhook validation |
| Low | 8 | Package config, test coverage, dependency vulns, deployment scripts |

### Top 10 Highest-Impact Fixes

1. **Fix WebSocket org resolution for DB users** (#3) — real-time updates completely broken for registered users
2. **Add `getCallByFileHash()`** (#2) — prevents OOM on upload for orgs with many calls
3. **Add CI/CD pipeline** (#8) — no automated quality gates currently
4. **Make `orgId` required in `insertUserSchema`** (#6) — tenant isolation gap
5. **Validate org settings updates** (#5) — arbitrary JSON injection
6. **Rate-limit registration** (#4) — abuse vector
7. **Replace `console.*` with structured logger** (#9) — HIPAA compliance gap
8. **Wrap `JSON.parse` calls in try-catch** (#7) — crash risk
9. **Add frontend route guards** (#14) — role bypass via URL
10. **Add WebSocket error handlers** (#15) — unlogged errors, broken pipe crashes
