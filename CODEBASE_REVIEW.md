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

| Severity | Count | Resolved | Key Areas |
|----------|-------|----------|-----------|
| Critical | 8 | 8 | Cross-tenant access, WebSocket auth, memory-heavy queries, CI/CD, crash-prone JSON.parse |
| High | 8 | 7 | Console logging, code duplication, route guards, error handlers, bulk reanalysis queue |
| Medium | 10 | 2 | CSRF, error leaks, no pagination, SigV4 duplication, pool leaks, webhook validation |
| Low | 8 | 1 | Package config, test coverage, dependency vulns, deployment scripts |

### Top 10 Highest-Impact Fixes — Status

1. ~~**Fix WebSocket org resolution for DB users** (#3)~~ — **RESOLVED**: `resolveUserOrgId()` falls back to `storage.getUser()` for DB users
2. ~~**Add `getCallByFileHash()`** (#2)~~ — **RESOLVED**: Added to IStorage interface and all backends with DB index lookup
3. ~~**Add CI/CD pipeline** (#8)~~ — **RESOLVED**: `.github/workflows/ci.yml` — typecheck, test, build on every PR
4. ~~**Make `orgId` required in `insertUserSchema`** (#6)~~ — **RESOLVED**: Changed from `z.string().optional()` to `z.string()`
5. ~~**Validate org settings updates** (#5)~~ — **RESOLVED**: Uses `orgSettingsSchema.partial().safeParse()` before merging
6. ~~**Rate-limit registration** (#4)~~ — **RESOLVED**: 3 registrations per IP per hour via `distributedRateLimit()`
7. ~~**Replace `console.*` with structured logger** (#9)~~ — **RESOLVED**: All server code uses Pino logger; remaining `console.*` only in bootstrap/migration scripts
8. ~~**Wrap `JSON.parse` calls in try-catch** (#7)~~ — **RESOLVED**: `safeJsonParse()` in reports, try-catch in onboarding
9. ~~**Add frontend route guards** (#14)~~ — **RESOLVED**: `ProtectedRoute` component with `minRole` on admin/manager routes
10. ~~**Add WebSocket error handlers** (#15)~~ — **RESOLVED**: `wss.on("error")`, try-catch on `send()`, `closeWebSocket()` export

### Additional Fixes Applied

- **#10 Password hashing duplication** — **RESOLVED**: `hashPassword()` exported from `server/auth.ts`, imported elsewhere
- **#11 Bulk re-analysis not using queue** — **RESOLVED**: Uses `enqueueReanalysis()` with BullMQ, in-process fallback when Redis unavailable
- **#12 Reporting loads all calls into memory** — **RESOLVED**: Added `getCallSummaries()` method that skips transcript data; reports/insights use it instead of `getCallsWithDetails()`
- **#13 No file size limit on upload** — **RESOLVED**: 100MB limit set in multer config with file type validation
- **#16 Indexing worker missing error handler** — **RESOLVED**: `worker.on("failed")` handler added
- **#18 Error handler exposes internal messages** — **RESOLVED**: Returns generic "Internal Server Error" for status >= 500
- **#28 Package naming** — **RESOLVED**: Changed from `"rest-express"` to `"observatory-qa"`

---

# Review Pass #2 — 2026-03-20

## Executive Summary

Follow-up review after initial fixes were applied. Focus areas: **query performance at scale**, **frontend optimization**, **schema correctness**, **test gaps**, and **architecture evolution**. The P0 query issues from the initial review (#2, #12) were partially addressed, but deeper patterns remain.

---

## P0 — Critical Performance (Will Break at Scale)

### 35. SearchCalls Still Loads All Calls Then Filters In-Memory

**File**: `server/db/pg-storage.ts` — `searchCalls()` method

Even after `getCallByFileHash()` was added (#2), the search endpoint still:
1. Queries `transcripts` for ILIKE matches
2. Calls `getCallsWithDetails(orgId)` loading **every call** for the org
3. Filters the full result set in memory

For an org with 10K calls where search matches 5 results, this loads all 10K calls with transcripts, sentiments, and analyses.

**Fix**: Replace with a JOIN query:
```sql
SELECT c.* FROM calls c
JOIN transcripts t ON c.id = t.call_id
WHERE t.text ILIKE $1 AND c.org_id = $2
LIMIT $3 OFFSET $4
```

### 36. getCallsWithDetails Fetches All Related Data Without Filtering

**File**: `server/db/pg-storage.ts` — `getCallsWithDetails()` method

Loads ALL employees, transcripts, sentiments, and analyses for the entire org in separate queries, then joins in memory. Even with `getCallSummaries()` added for reports (#12), the original method is still called from search, dashboard, and call detail endpoints.

**Fix**: Accept optional `callIds?: number[]` parameter and filter in SQL:
```sql
WHERE org_id = $1 AND call_id = ANY($2::int[])
```

### 37. getTopPerformers Aggregates All Calls In-Memory

**File**: `server/db/pg-storage.ts` — `getTopPerformers()` method

Loads all calls, manually computes per-employee averages, then sorts. Should use SQL aggregation:
```sql
SELECT employee_id, AVG(performance_score::numeric) as avg_score
FROM call_analyses WHERE org_id = $1
GROUP BY employee_id
ORDER BY avg_score DESC
LIMIT $2
```

---

## P1 — High Priority

### 38. Score Fields Typed as Strings Instead of Numbers in Zod Schemas

**File**: `shared/schema.ts`

| Field | Current Type | Should Be |
|-------|-------------|-----------|
| `overallScore` (Sentiment) | `z.string().optional()` | `z.number().optional()` |
| `performanceScore` (Analysis) | `z.string().optional()` | `z.number().optional()` |
| `confidenceScore` (Analysis) | `z.string().optional()` | `z.number().optional()` |

Server code does `transcriptConfidence * 0.4` (numeric ops) but schema allows strings. Frontend string comparison: `"9" > "80"` evaluates to `true`.

**Fix**: Use `z.coerce.number().optional()` during migration, then enforce `z.number()`.

### 39. orgId Still Optional on 8+ Insert Schemas

**File**: `shared/schema.ts`

Despite #6 fixing `insertUserSchema`, these still have `orgId: z.string().optional()`:
- `insertEmployeeSchema`, `insertCallSchema`, `insertTranscriptSchema`
- `insertSentimentAnalysisSchema`, `insertCallAnalysisSchema`
- `insertAccessRequestSchema`, `insertInvitationSchema`, `insertCoachingSessionSchema`

In multi-tenant SaaS, orgId must never be optional at the storage layer.

### 40. Reference Document Cache Key Mismatch

**File**: `server/routes/calls.ts` — refDocCache

Cache stores documents keyed by `orgId` but lookups use `${orgId}:${callCategory}`, causing cache misses even when documents are already cached for a different category.

### 41. No Timeouts on External API Calls

**Files**: `server/services/bedrock.ts`, `server/services/assemblyai.ts`

AI analysis and transcription calls have no timeout. A hung Bedrock or AssemblyAI request blocks the pipeline indefinitely.

**Fix**: Add `AbortController` with timeout (120s for AI, 300s for transcription polling).

### 42. Frontend: WebSocket Event Listener Memory Leak

**File**: `client/src/components/upload/file-upload.tsx` lines ~40-62

Uses `window.addEventListener("ws:call_update", handler)` without cleanup on unmount. Repeated mount/unmount cycles accumulate dangling listeners.

### 43. Frontend: TanStack Query Key Fragmentation

Same API endpoint (`/api/calls`) cached under different keys depending on filter object shapes (empty strings vs undefined). Causes duplicate network requests and stale cache.

**Fix**: Centralized query key factory with normalized filter shapes.

---

## P2 — Medium Priority

### 44. In-Memory Rate Limit Maps Grow Unbounded

**File**: `server/index.ts`

Rate limiting maps use periodic cleanup but grow unbounded under sustained load. Use LRU cache or ensure Redis-backed rate limiting is primary.

### 45. AUTH_USERS Parsing Breaks on Colons in Passwords

**File**: `server/auth.ts`

Splits on `:` without limit — passwords containing colons silently corrupt parsing.

### 46. Missing React.memo on List Item Components

**Files**: `client/src/components/search/call-card.tsx`, employee/metric cards

List items re-render on every parent state change. For 50+ items, creates visible jank.

### 47. Dashboard Computed Arrays Not Memoized

**File**: `client/src/pages/dashboard.tsx`

`flaggedCalls`, `badCalls`, `goodCalls` recomputed every render. Wrap in `useMemo`.

### 48. No Debouncing on Table Filters

**File**: `client/src/components/tables/calls-table.tsx`

Filter changes trigger immediate refetches. Add 300ms debounce.

### 49. Accessibility Gaps

- Icon-only sort buttons lack `aria-label` (calls-table.tsx)
- Sidebar uses `<div>` instead of `<nav>` element
- Custom branding colors not validated against WCAG AA contrast
- Logo images lack meaningful `alt` text
- No `prefers-reduced-motion` check for Framer Motion animations

### 50. Stripe Price IDs Missing from .env.example

`STRIPE_PRICE_*` variables referenced in billing routes but not documented in `.env.example`.

---

## P3 — Tech Debt

### 51. Expired API Keys Never Purged
Checked at request time but never cleaned from database. Add periodic cleanup job.

### 52. Inconsistent Pagination
`/api/calls` supports limit/offset, `/api/reports/filtered` doesn't, `/api/dashboard/performers` supports limit only.

### 53. No Centralized Error Codes
API returns freeform messages. Add structured error codes for client-side handling:
```json
{ "error": { "code": "CALL_NOT_FOUND", "message": "..." } }
```

### 54. No E2E Tests
Package references Playwright but no test files exist. Critical flows (upload → transcription → analysis → dashboard) need coverage.

### 55. SigV4 Signing Still Duplicated
`server/services/s3.ts`, `bedrock.ts`, `embeddings.ts` each have their own SigV4 implementation.

---

## Test Coverage Status

| Area | Coverage | Priority |
|------|----------|----------|
| Schema validation | Good | — |
| Multi-tenant isolation | Good | — |
| RBAC | Good | — |
| Audio pipeline | Basic (error paths missing) | High |
| Rate limiting | None | Medium |
| Graceful degradation | None | Medium |
| Search (large datasets) | None | High |
| API key lifecycle | None | Low |
| RAG system | None | Medium |
| Frontend components | None | Low |
| E2E flows | None | Medium |

---

## Architecture Evolution Roadmap

### Phase 1: Scale to 100 Orgs (Current Architecture, Query Fixes)

**Database query optimization** — Fix P0 items #35-37. This alone extends supported org size 10x.

**Connection pooling** — Add PgBouncer between app and PostgreSQL. Drizzle's default pool settings may exhaust connections under concurrent uploads across many orgs.

**Streaming responses** — Dashboard endpoints returning all calls should use cursor-based pagination.

**CDN for static assets** — Move `dist/client/` behind CloudFront. Currently served by the same Node process.

### Phase 2: Scale to 1,000 Orgs (Infrastructure Changes)

**Reliable background jobs** — Replace remaining fire-and-forget patterns with BullMQ jobs (S3 archival, email, coaching alerts). Gives retry, backoff, and dead-letter queues.

**Read replicas** — Dashboard/reporting queries should hit a read replica to avoid contending with upload/analysis writes.

**Redis caching layer** — Cache:
- Dashboard metrics (TTL: 60s)
- Employee lists (TTL: 5min)
- Prompt templates (TTL: 10min, invalidate on update)

**API versioning** — Add `/api/v1/` prefix before the API surface grows further.

### Phase 3: Scale to 10,000+ Orgs (Architecture Rework)

**Horizontal scaling** — Split the single process into:
- Stateless API servers behind a load balancer
- Dedicated WebSocket server (Redis pub/sub for cross-instance messaging — partially built)
- Worker processes (already separated)
- Static files via CDN

**PostgreSQL Row-Level Security** — RLS policies as defense-in-depth for multi-tenant isolation, supplementing application-level orgId filtering.

**Observability** — Beyond Pino + Betterstack:
- OpenTelemetry distributed tracing
- Prometheus custom metrics (calls/min, analysis latency, queue depth)
- SLA-based alerting

**Secrets management** — Move from `.env` plaintext to AWS Secrets Manager / Parameter Store.

### Feature Opportunities

| Feature | Effort | Revenue Impact | Architecture Ready? |
|---------|--------|---------------|-------------------|
| **Knowledge Base standalone plan** ($49/mo) | 1-2 weeks | New revenue stream | Yes — RAG fully decoupled |
| **Super-admin dashboard** | 2-3 weeks | Operational efficiency | Partially — needs cross-org queries |
| **SSO (Enterprise)** | 3-4 weeks | Enterprise upsell | Schema ready, implementation needed |
| **Real-time coaching** | 2-3 weeks | Differentiator | WebSocket infra exists |
| **Trend detection & anomaly alerts** | 3-4 weeks | Retention driver | Needs new analytics queries |
| **API marketplace / integrations** | 4-6 weeks | Platform play | API key system exists |
| **White-label / custom domains** | 2-3 weeks | Enterprise upsell | Branding system exists |

---

## Summary — Review Pass #2

| Priority | New Items | Key Theme |
|----------|-----------|-----------|
| P0 | 3 | Query performance at scale |
| P1 | 6 | Schema correctness, frontend reliability |
| P2 | 7 | UX polish, accessibility, config |
| P3 | 5 | Tech debt, consistency |

**Bottom line**: The codebase improved significantly after the first review. The remaining critical work is **database query optimization** (#35-37) — these are straightforward Drizzle ORM changes that will prevent the platform from hitting a wall as orgs grow past a few hundred calls. The frontend is well-built but needs memoization and query key discipline for smooth UX at scale.

---

# Review Pass #3 — 2026-03-20 (Post Healthcare Expansion Merge)

## Executive Summary

Major new feature set merged: **Clinical Documentation (AI Scribe)**, **EHR Integration** (Open Dental, Eaglesoft), **A/B Model Testing**, **Spend Tracking**, **Style Learning**, and **Dental Practice Vertical**. This review covers the ~7,400 new lines across 40 files. The healthcare expansion is architecturally sound — clean adapter patterns, proper PHI audit logging, plan-gated access — but has several **HIPAA-critical security gaps** that must be fixed before any clinical deployment.

---

## CRITICAL — HIPAA Security (Fix Before Any Clinical Deployment)

### 56. EHR API Keys Stored in Plaintext in Org Settings

**File**: `server/routes/ehr.ts:74-84`

EHR connection credentials (Open Dental API key, Eaglesoft eDex key) are stored as plaintext strings in the org's `settings` JSONB field:

```typescript
const ehrConfig = { system, baseUrl, apiKey: apiKey || undefined, ... };
await storage.updateOrganization(req.orgId!, { settings: { ...org.settings, ehrConfig } });
```

Anyone with database access (backup, admin query, pg-storage debug) can read these keys. The app already has `encryptField()`/`decryptField()` for PHI — the same should be used here.

**Fix**: Encrypt `apiKey` before storage, decrypt on retrieval in adapter methods.

### 57. EHR baseUrl Accepts Arbitrary URLs (SSRF Risk)

**File**: `server/routes/ehr.ts:55-58`, `shared/schema.ts:53`

```typescript
if (!system || !baseUrl) { ... } // Only checks presence, not validity
```

An admin can set `baseUrl` to `http://169.254.169.254/latest/meta-data/` (AWS instance metadata), `http://internal-api:8000`, or any internal endpoint. The EHR adapters (`open-dental.ts:42`, `eaglesoft.ts:43`) then make HTTP requests to this URL.

**Fix**: Validate URL format and enforce HTTPS:
```typescript
baseUrl: z.string().url().refine(u => u.startsWith("https://"), "HTTPS required")
```

### 58. Clinical Note Schema Missing Attestation/Audit Fields

**File**: `shared/schema.ts:195-235`

The `clinicalNoteSchema` is missing fields that the code actively writes:
- `attestedBy` (written at `clinical.ts:89`)
- `attestedAt` (written at `clinical.ts:90`)
- `consentRecordedBy` (written at `clinical.ts:121`)
- `consentRecordedAt` (written at `clinical.ts:122`)
- `editHistory` (written at `clinical.ts:185-192`)

These HIPAA-required audit fields bypass Zod validation entirely. They're stored as untyped properties on the clinical note object, which means:
- No type safety on attestation metadata
- No validation that `editHistory` entries have required fields
- Potential data corruption if malformed data is written

**Fix**: Add to `clinicalNoteSchema`:
```typescript
attestedBy: z.string().optional(),
attestedAt: z.string().optional(),
consentRecordedBy: z.string().optional(),
consentRecordedAt: z.string().optional(),
editHistory: z.array(z.object({
  editedBy: z.string(),
  editedAt: z.string(),
  fieldsChanged: z.array(z.string()),
})).optional(),
```

### 59. PHI Encryption Inconsistency in Clinical Note Edit Flow

**File**: `server/routes/clinical.ts:142-210`

The PATCH endpoint encrypts newly edited PHI fields (line 172-179), but the existing encrypted fields on the note object are not consistently handled. When `Object.assign(analysis.clinicalNote, edits)` runs at line 182, non-PHI edits are applied directly. But if a field was previously encrypted and is now being updated, the old encrypted value may be partially overwritten.

More critically: the `editHistory` at line 188-192 logs field names from `req.body`, but `edits` at line 201 only contains the non-PHI fields (PHI were deleted at line 177). The audit log detail says "Edited fields: [non-PHI only]" — **PHI field edits are not listed in the audit log detail**.

**Fix**: Include PHI field names in audit detail without logging PHI values.

### 60. EHR Note Push Sends Decrypted PHI Without Re-encryption

**File**: `server/routes/ehr.ts:296-308`

When pushing a clinical note to EHR, `formatClinicalNoteForEhr(cn)` at line 298 reads fields like `cn.subjective`, `cn.objective`, `cn.assessment` directly. If these are stored encrypted (as they should be per the encryption at `clinical.ts:172-179`), the note pushed to the EHR will contain encrypted gibberish instead of readable text.

If they're NOT encrypted (encryption failed silently), PHI is stored in plaintext in the database.

**Fix**: Decrypt PHI fields before formatting for EHR push:
```typescript
const cn = { ...analysis.clinicalNote };
const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
for (const f of phiFields) {
  if (typeof cn[f] === "string") cn[f] = decryptField(cn[f]);
}
const noteContent = formatClinicalNoteForEhr(cn);
```

### 61. Attestation Authorization: Any Manager Can Attest Any Provider's Notes

**File**: `server/routes/clinical.ts:79-108`

The attestation endpoint requires `requireRole("manager", "admin")` but doesn't verify the attesting user is the appropriate provider:

```typescript
analysis.clinicalNote.providerAttested = true;
analysis.clinicalNote.attestedBy = (req as any).user?.name;
```

A manager from a different department can attest notes created by an unrelated provider. In clinical documentation, attestation signifies "I, the treating provider, confirm this note is accurate."

**Fix**: Add provider identity check (or at minimum, require the attesting user be the same as the user who initiated the encounter).

---

## HIGH — Functional Issues

### 62. Clinical Metrics Endpoint Loads ALL Calls Into Memory

**File**: `server/routes/clinical.ts:264-266`

```typescript
const calls = await storage.getCallsWithDetails(req.orgId!, {});
```

Same P0 performance issue from Review Pass #2 (#36), now in the clinical metrics endpoint. Loads every call with full details just to filter for clinical categories and compute aggregates.

**Fix**: Add a `getClinicalMetrics(orgId)` storage method that computes aggregates in SQL.

### 63. Style Learning Loads ALL Calls Into Memory

**File**: `server/routes/clinical.ts:371`

```typescript
const calls = await storage.getCallsWithDetails(req.orgId!, {});
```

Same issue — loads all calls just to find attested clinical notes for a specific provider. Then decrypts PHI on each one (line 391-395) for style analysis.

**Fix**: Add a filtered query: `getAttestedClinicalNotes(orgId, attestedBy)`.

### 64. A/B Test Status Field Not an Enum

**File**: `shared/schema.ts:647`

```typescript
status: z.string().default("processing"),
```

Should be `z.enum(["processing", "completed", "failed"])`. Freeform string allows invalid states.

### 65. Spend Records Missing Foreign Key Constraint

**File**: `server/db/schema.ts` — `spendRecords` table

`callId` column is `text("call_id").notNull()` but has no `references(() => calls.id)` constraint. If a call is deleted, orphaned spend records remain with no referential integrity.

### 66. CloudStorage A/B Test Methods Asymmetric Error Handling

**File**: `server/storage/cloud.ts:555-565`

`createABTest()` throws an error ("requires PostgreSQL"), but `getABTest()`, `getAllABTests()`, `updateABTest()`, `deleteABTest()` silently return empty/undefined. Users on S3-only backends get confusing UX: create fails with error, but list returns empty with no error.

**Fix**: All methods should throw consistently, or the routes should check backend support before calling storage.

### 67. Frontend Error Reporting May Log PHI

**File**: `client/src/lib/error-reporting.ts:19-24`

Error reporting function logs stack traces and error messages to console. Errors in clinical workflows could contain PHI (chief complaint, diagnosis) in error messages.

**Fix**: Sanitize error messages; use structured error codes instead of freeform messages.

### 68. Clinical Note Print Output Not HIPAA Compliant

**File**: `client/src/pages/clinical-notes.tsx` (print functionality)

Clinical notes printed via `window.open()` to a new tab:
- No watermark/draft status on printed output
- No audit trail for print events
- No Content-Security-Policy on the print window
- Patient data sent to browser print subsystem without access control

**Fix**: Add "DRAFT" watermark, send print audit event to server, render within same secure context.

### 69. Clinical Note Edit Race Condition (No Optimistic Locking)

**File**: `client/src/pages/clinical-notes.tsx` + `server/routes/clinical.ts:142-210`

No version field or last-modified check. Two providers can:
1. Both load the same note
2. Both edit different fields
3. Second save overwrites first's changes

**Fix**: Add `version: z.number()` to clinical note schema. Increment on save, reject if version doesn't match.

---

## MEDIUM — Quality & Robustness

### 70. EHR Route Boilerplate Duplication

**File**: `server/routes/ehr.ts`

Every EHR endpoint repeats the same 15-line pattern:
```typescript
const org = await storage.getOrganization(req.orgId!);
const ehrConfig = (org?.settings as any)?.ehrConfig;
if (!ehrConfig?.enabled) { ... }
const adapter = getEhrAdapter(ehrConfig.system);
if (!adapter) { ... }
```

This appears 8 times. Should be extracted to middleware:
```typescript
function requireEhr() {
  return async (req, res, next) => { /* resolve adapter, attach to req */ };
}
```

### 71. EHR Adapter Implementations Are Stubs

**Files**: `server/services/ehr/open-dental.ts`, `server/services/ehr/eaglesoft.ts`

Both adapters have the correct interface but make real HTTP calls to potentially non-existent APIs. No mock/test mode. If `baseUrl` is configured but the EHR server is down, every API call blocks and returns a 500.

Need timeout handling and graceful degradation for EHR connectivity failures.

### 72. A/B Testing No Plan Tier Gate

**File**: `server/routes/ab-testing.ts`

Unlike clinical routes (which check `requireClinicalPlan()`), A/B testing routes have no plan tier check. Free tier users can run A/B tests, consuming Bedrock API credits.

### 73. No Tests for Any New Feature

Zero test files for:
- Clinical routes/notes/attestation/consent
- EHR integration (adapters, routes)
- A/B testing
- Spend tracking
- Style learning
- Clinical templates
- PHI encryption/decryption of clinical fields

### 74. Clinical Dashboard Chart Data Not Memoized

**File**: `client/src/pages/clinical-dashboard.tsx`

`formatPieData` and `specialtyPieData` computed on every render without `useMemo`. 7-color pie chart re-renders on any state change.

### 75. A/B Test Polling Inefficiency

**File**: `client/src/pages/ab-testing.tsx`

`refetchInterval: 5000` when processing — polls every 5s even when user navigates away. Should use WebSocket (infrastructure exists) or exponential backoff.

### 76. Spend Tracking Route Is a Stub

**File**: `server/routes/spend-tracking.ts` (18 lines)

Only registers a single placeholder route. Frontend `spend-tracking.tsx` (343 lines) queries `/api/billing/usage` instead. The route file adds no value.

### 77. `(req as any).user` Pattern Throughout Clinical Routes

**Files**: `server/routes/clinical.ts`, `server/routes/ehr.ts`

User identity accessed via `(req as any).user?.name` ~15 times. This bypasses TypeScript safety. Should use the Express type augmentation in `server/types.d.ts`.

---

## LOW — Tech Debt & Cleanup

### 78. `sync-schema.ts` Purpose Unclear
**File**: `server/db/sync-schema.ts` (41 lines) — appears to be a manual schema sync utility. Should document when/why to use it vs `db:push`.

### 79. Default Prompt Templates JSON
**File**: `data/dental/default-prompt-templates.json` — dental prompt templates defined in JSON but loaded by `server/services/clinical-templates.ts` as hardcoded TypeScript objects. The JSON file appears unused.

### 80. Dental Terminology Reference Not Indexed
**File**: `data/dental/dental-terminology-reference.md` — reference document exists but is not automatically loaded into RAG knowledge base for dental orgs.

---

## Architecture Assessment — Healthcare Expansion

### What's Done Well

1. **EHR Adapter Pattern** — Clean `EhrAdapter` interface with `open-dental.ts` and `eaglesoft.ts` implementations. Easy to add Dentrix, Epic, etc.
2. **Plan Gating** — `requireClinicalPlan()` middleware properly checks subscription tier before allowing clinical features.
3. **PHI Encryption** — `encryptField()`/`decryptField()` applied to SOAP note fields (subjective, objective, assessment, HPI, chief complaint).
4. **HIPAA Audit Logging** — `logPhiAccess()` called consistently across clinical note view, attest, consent, edit, and EHR operations.
5. **Style Learning** — Clever feature (inspired by Freed) that analyzes provider's attested notes to learn preferences. Entirely server-side, no PHI exposure.
6. **Clinical Templates** — 20+ hardcoded templates covering SOAP, DAP, BIRP, dental exam, procedure notes. Good starting point.
7. **Dental-first vertical** — Smart market positioning. Call categories, specialties, CDT codes, tooth numbering all present.
8. **A/B Testing** — Useful for cost optimization. Side-by-side model comparison with latency tracking.

### What Needs Work

1. **Encryption gaps** — EHR keys plaintext, EHR push doesn't decrypt, attestation audit incomplete.
2. **Performance** — Clinical metrics and style learning both load all calls into memory (same P0 issue from core platform).
3. **Schema validation** — Clinical note audit fields bypass Zod. A/B test status is freeform string.
4. **No tests** — Zero test coverage for the entire healthcare feature set.
5. **SSRF risk** — EHR baseUrl not validated.
6. **Type safety** — `(req as any).user` pattern pervasive in clinical routes.

### Recommended Implementation Order

| Priority | Item | Effort | Blocker? |
|----------|------|--------|----------|
| 1 | Fix EHR API key encryption (#56) | 1 hour | Yes — HIPAA violation |
| 2 | Validate EHR baseUrl (#57) | 30 min | Yes — SSRF risk |
| 3 | Add attestation fields to schema (#58) | 1 hour | Yes — data integrity |
| 4 | Fix EHR note push decryption (#60) | 30 min | Yes — broken feature |
| 5 | Fix audit log for PHI field edits (#59) | 30 min | Yes — HIPAA audit gap |
| 6 | Add optimistic locking to note edits (#69) | 2 hours | High risk |
| 7 | Extract EHR middleware (#70) | 1 hour | Code quality |
| 8 | Add clinical metrics SQL query (#62) | 2 hours | Performance |
| 9 | Add A/B test plan gating (#72) | 30 min | Revenue leakage |
| 10 | Write tests for clinical features (#73) | 1-2 days | Long-term quality |

### Updated Architecture Roadmap

The healthcare expansion changes the scaling trajectory:

**Phase 1 (Now — Pre-Launch Critical)**:
- Fix all CRITICAL items (#56-61) — these are HIPAA blockers
- Fix performance regressions (#62-63) — clinical metrics can't load all calls
- Add attestation schema fields (#58) — data integrity

**Phase 2 (Launch → 10 Dental Practices)**:
- Write integration tests for clinical workflows
- Add optimistic locking for concurrent note edits
- Implement EHR timeout/retry logic
- Load dental terminology into RAG automatically for dental orgs
- Add provider-level attestation authorization

**Phase 3 (10 → 100 Practices)**:
- Dedicated clinical note storage (separate from call_analyses JSONB)
- EHR sync worker (BullMQ) for reliable note push with retry
- PHI encryption key rotation mechanism
- Clinical-specific audit report generation (for HIPAA audits)
- Read replicas for clinical dashboard queries

**Phase 4 (Multi-Vertical Expansion)**:
- Vertical-specific template packs (behavioral health, urgent care, veterinary)
- Vertical-specific EHR adapters (Epic, Cerner, Practice Fusion)
- Multi-language clinical note generation (Spanish first, per expansion plan)
- Advanced coding suggestions (AI-assisted ICD-10/CDT/CPT code selection)

---

## Summary — Review Pass #3

| Priority | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 6 | HIPAA security gaps — EHR key encryption, SSRF, schema validation, PHI handling |
| HIGH | 8 | Performance, type safety, race conditions, missing plan gates |
| MEDIUM | 8 | Code duplication, missing tests, frontend optimization |
| LOW | 3 | Tech debt, unused files |

**Bottom line**: The healthcare expansion is architecturally sound and well-positioned competitively. The EHR adapter pattern, style learning, and dental vertical are strong foundations. However, **6 HIPAA-critical security issues must be fixed before any clinical deployment**: plaintext EHR keys, SSRF-vulnerable baseUrl, missing schema validation on attestation fields, broken PHI flow in EHR push, incomplete audit logging, and overly permissive attestation authorization. These are all straightforward fixes (most under 1 hour each). The platform's existing P0 performance issues (#35-37 from Pass #2) are now also present in the clinical metrics and style learning endpoints.
