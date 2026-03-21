# Observatory QA — Improvement Recommendations by Category

Ordered by highest-to-lowest impact within each category. Categories ordered by the gap between current rating and achievable rating (biggest improvement opportunity first).

---

## 1. Scalability (5/10 → 8/10) — Highest Impact

The platform will hit walls at ~500 calls/org. These are the changes needed, in priority order:

### 1a. Convert in-memory aggregations to SQL queries (Impact: Critical)
**Files**: `server/db/pg-storage.ts`

Four methods currently load all calls into memory:
- `searchCalls()` — Should use `ILIKE` with `JOIN` on transcripts/analysis tables directly in SQL
- `getTopPerformers()` — Should be `SELECT employee_id, AVG(performance_score) ... GROUP BY employee_id ORDER BY avg DESC LIMIT N`
- Clinical metrics endpoint — Should use `COUNT(*)`, `AVG()` SQL aggregates with `WHERE` on clinical note fields
- Style learning endpoint — Should filter by date range in SQL, not load all and filter in JS

Each of these is a single method change. No architectural redesign needed.

### 1b. Add pagination to all list endpoints (Impact: High)
**Files**: `server/routes/calls.ts`, `server/routes/employees.ts`, `server/routes/coaching.ts`

Add `LIMIT/OFFSET` (or cursor-based) pagination to:
- `GET /api/calls` (already has some filtering, needs proper pagination)
- `GET /api/employees`
- `GET /api/coaching`
- `GET /api/dashboard/metrics` (aggregate in SQL, don't pull all rows)

### 1c. Add database connection pooling documentation (Impact: Medium)
Document pgBouncer setup for production. The app uses `pg.Pool` with default settings — add explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` configuration.

### 1d. Add Redis caching for dashboard data (Impact: Medium)
Dashboard metrics change slowly. Cache with 60s TTL:
- `GET /api/dashboard/metrics`
- `GET /api/dashboard/performers`
- `GET /api/dashboard/sentiment`

The Redis client already exists (`server/services/redis.ts`).

### 1e. Separate read/write paths (Impact: Long-term)
Route reporting/dashboard queries to a read replica. This is a future optimization — do the SQL query fixes first.

---

## 2. Infrastructure/DevOps (5.5/10 → 8/10)

### 2a. Fix EC2 deployment scripts (Impact: Critical)
**Files**: `deploy/ec2/user-data.sh`, `deploy/ec2/Caddyfile`

- Replace hardcoded `YOUR_DOMAIN` and `CHANGE_ME` placeholders with template variables
- Uncomment git clone and make it configurable
- Add a `deploy.sh` wrapper that prompts for domain, DB URL, keys

### 2b. Add health monitoring (Impact: High)
- Add CloudWatch alarms for: CPU > 80%, memory > 80%, disk > 90%, HTTP 5xx rate
- Expose `/api/health` metrics in Prometheus format for Grafana dashboards
- Add worker health check endpoint (`/api/health/workers`)

### 2c. Require REDIS_URL in production (Impact: High)
**File**: `server/index.ts`

Add a startup check: if `NODE_ENV=production` and no `REDIS_URL`, log an error and exit. In-memory sessions in production means session loss on restart and no distributed rate limiting.

### 2d. Add backup strategy (Impact: High)
Document:
- PostgreSQL: automated daily backups (RDS automated backups or pg_dump cron)
- S3: versioning enabled on the audio bucket
- Redis: RDB snapshots for session persistence

### 2e. Create render.yaml for staging (Impact: Medium)
Version-control the Render deployment config instead of dashboard-only configuration.

### 2f. Add CI/CD pipeline (Impact: Medium)
GitHub Actions workflow:
1. `npm run check` (TypeScript)
2. `npm test` (unit tests)
3. `npm run build` (build verification)
4. Deploy to staging on `main` push
5. Deploy to production on tag/release

---

## 3. Testing (6/10 → 8.5/10)

### 3a. Add E2E tests for critical paths (Impact: Critical)
**Framework**: Playwright (already in `package.json`)

Priority flows to test:
1. Registration → Login → Upload → View Analysis (core value proposition)
2. Clinical: Upload → Transcribe → View Clinical Note → Attest → Push to EHR
3. Admin: Create User → Invite → Accept Invitation → Login as new user
4. Billing: Subscribe → Upload (quota check) → Hit limit → Upgrade

### 3b. Add integration tests for calls.ts (Impact: High)
**File**: `server/routes/calls.ts` (995 lines, zero test coverage)

This is the largest and most critical route file. Test:
- Upload flow with mock AssemblyAI/Bedrock
- Empty transcript handling
- Employee auto-assignment logic
- Score clamping and flag enforcement
- File hash deduplication

### 3c. Add RAG integration tests (Impact: High)
Test the full pipeline: chunk → embed → store → retrieve → inject into prompt.
Mock the Bedrock embedding API, test with real pgvector queries.

### 3d. Add Stripe webhook tests (Impact: Medium)
Test all webhook event handlers:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

### 3e. Add concurrent operation tests (Impact: Medium)
Test race conditions:
- Two simultaneous uploads for the same org
- Concurrent reanalysis while new upload processing
- Parallel clinical note edits (should fail without optimistic locking)

---

## 4. EHR Integration (6/10 → 8/10)

### 4a. Add request timeouts to EHR adapters (Impact: High)
**Files**: `server/services/ehr/open-dental.ts`, `server/services/ehr/eaglesoft.ts`

Add `AbortController` with 30s timeout on all HTTP calls. A hung EHR server currently blocks the request indefinitely.

### 4b. Add retry logic with exponential backoff (Impact: High)
EHR systems have intermittent availability. Add retry (3 attempts, 1s/2s/4s backoff) for transient failures (5xx, network errors).

### 4c. Add mock/sandbox mode (Impact: Medium)
**File**: `server/services/ehr/index.ts`

Add a `MockEhrAdapter` that returns realistic test data. Enable via `ehrConfig.sandbox: true`. This allows:
- Development without EHR credentials
- E2E testing of the EHR flow
- Demo mode for sales

### 4d. Add EHR connection health monitoring (Impact: Medium)
Store last successful connection time per org. Show connection status on the admin dashboard. Alert if connection hasn't been verified in 24h.

### 4e. Add adapter tests (Impact: Medium)
Unit test each adapter with mocked HTTP responses. Test error handling, retry behavior, and data mapping.

---

## 5. Clinical Documentation (7/10 → 9/10)

### 5a. Move PHI decryption to storage layer (Impact: High)
**File**: `server/db/pg-storage.ts`

Create a `getClinicalNote(orgId, callId)` method that always returns decrypted PHI fields. Remove scattered `decryptField()` calls from route handlers. This prevents future routes from accidentally serving encrypted PHI.

### 5b. Add optimistic locking for clinical notes (Impact: High)
Add a `version` field to clinical notes. On edit, require the current version in the request. Reject if version doesn't match (concurrent edit). This prevents silent overwrites when two providers edit the same note.

### 5c. Scope attestation to provider identity (Impact: Medium)
Currently `providerAttested` is a boolean. Should track:
- Who attested (provider ID, not just name)
- When (timestamp)
- Provider credentials (NPI number)
- Whether the attesting provider is authorized for this patient/encounter

### 5d. Add clinical note export audit trail (Impact: Medium)
Log every time a clinical note is viewed, printed, exported, or pushed to EHR. This is a HIPAA requirement for access tracking.

### 5e. Add note versioning (Impact: Low)
Keep edit history as immutable snapshots, not just a `manualEdits` array. Each version should capture the full note state, who edited it, and why.

---

## 6. Security (7/10 → 9/10)

### 6a. Add CSRF protection (Impact: High)
Add the `csrf-csrf` package (double-submit cookie pattern). Apply to all state-changing endpoints. This works with the existing `sameSite: "lax"` cookies but adds defense-in-depth.

### 6b. Remove CSP `unsafe-inline` (Impact: High)
**File**: `server/index.ts`

Replace `script-src 'self' 'unsafe-inline'` with nonce-based CSP. Generate a random nonce per request, inject into HTML template, set in CSP header.

### 6c. Add session regeneration on all login paths (Impact: High)
**File**: `server/routes/auth.ts`

Add `req.session.regenerate()` before `req.login()` in the standard login handler and OAuth callback, matching the pattern already used in MFA and now registration.

### 6d. Add secrets management for production (Impact: Medium)
Replace `.env` file with AWS Secrets Manager or SSM Parameter Store. Load secrets at startup via the AWS SDK. This eliminates plaintext secrets on disk.

### 6e. Add encryption key rotation support (Impact: Medium)
**File**: `server/services/phi-encryption.ts`

Support multiple encryption keys (current + previous). Encrypt with current key, decrypt by trying current then previous. Add a background job to re-encrypt old data with the new key.

### 6f. Add PostgreSQL Row-Level Security (Impact: Medium)
Add RLS policies as defense-in-depth for tenant isolation. Even if application code has a bug, the database enforces org boundaries.

---

## 7. HIPAA Compliance (7/10 → 9/10)

### 7a. Add CSRF protection (same as 6a) (Impact: High)
Required for HIPAA Security Rule — protect against cross-site request forgery.

### 7b. Add BAA template and compliance checklist (Impact: High)
Create `docs/hipaa/` with:
- Business Associate Agreement template
- Compliance checklist (mapped to HIPAA Security Rule sections)
- Incident response procedure
- Data breach notification template

### 7c. Add encryption key management documentation (Impact: Medium)
Document key generation, storage, rotation, and recovery procedures. Required for HIPAA key management policy.

### 7d. Add session activity logging (Impact: Medium)
Log session creation, renewal, and destruction events. Track concurrent sessions per user. Add maximum session limit per user.

### 7e. Add PHI access reports (Impact: Medium)
Build a HIPAA access report: who accessed which patient data, when, from what IP. The audit log data exists — add a reporting endpoint and UI.

---

## 8. Frontend UX (7/10 → 8.5/10)

### 8a. Add `prefers-reduced-motion` support (Impact: High — accessibility)
**File**: `client/src/lib/motion-config.ts` (new)

Create a shared Framer Motion config that respects `prefers-reduced-motion`. Apply to all animated components.

### 8b. Disable mutation buttons while pending (Impact: High — UX)
**File**: `client/src/components/tables/calls-table.tsx`

Add `disabled={mutation.isPending}` to delete, assign, and action buttons. Prevents double-submission.

### 8c. Wrap localStorage in try-catch (Impact: Medium)
**Files**: `client/src/components/layout/sidebar.tsx`, theme management

Create a `safeLocalStorage` utility that wraps get/set/remove in try-catch. Prevents crashes in private browsing mode.

### 8d. Reduce bundle size (Impact: Medium)
- Tree-shake Recharts: import specific chart types instead of the full library
- Lazy-load heavy pages (clinical, A/B testing, admin) with `React.lazy()`
- Consider replacing Framer Motion with CSS animations for simple transitions

### 8e. Add keyboard navigation (Impact: Low — accessibility)
Ensure all interactive elements are keyboard-accessible. Add focus visible styles. Test with screen readers.

---

## 9. Code Quality (7.5/10 → 9/10)

### 9a. Centralize SigV4 signing (Impact: Medium)
**Files**: `server/services/s3.ts`, `server/services/bedrock.ts`, `server/services/embeddings.ts`

Extract shared SigV4 signing into a single `aws-signer.ts` utility. Currently duplicated across 3 files.

### 9b. Split large route files (Impact: Medium)
- `calls.ts` (995 lines) → split upload handling into `calls-upload.ts`
- `reports.ts` (647 lines) → split agent profile into `agent-profiles.ts`
- `clinical.ts` → split templates/style-learning into separate files

### 9c. Standardize error responses (Impact: Medium)
Some routes use structured error codes (`OBS-*`), others use freeform messages. Standardize all routes to use `error-codes.ts` patterns with consistent shape:
```json
{ "message": "...", "code": "OBS-DOMAIN-NNN", "statusCode": 400 }
```

### 9d. Add request validation middleware (Impact: Low)
Create a `validateBody(schema)` middleware that parses and validates request bodies with Zod before the handler runs. Eliminates manual `safeParse` calls in every route.

---

## 10. Documentation (8/10 → 9/10)

### 10a. Create .env.example (Impact: Medium)
List all environment variables with descriptions, defaults, and which are required vs optional. Currently only documented in CLAUDE.md.

### 10b. Add API documentation (Impact: Medium)
Generate OpenAPI/Swagger spec from route definitions. Serve at `/api/docs` in development. This helps frontend developers and API consumers.

### 10c. Add architecture decision records (Impact: Low)
Document key decisions: why raw SigV4 instead of AWS SDK, why Drizzle over Prisma, why pgvector over dedicated vector DB, etc.

---

## Impact Summary — What to Do First

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| 1 | Convert search/aggregations to SQL (1a) | Unblocks scaling past 500 calls | 1-2 days |
| 2 | Fix EC2 deployment scripts (2a) | Unblocks production deployment | 0.5 days |
| 3 | Add E2E tests for core flows (3a) | Catches regressions, enables CI | 2-3 days |
| 4 | Add CSRF protection (6a) | HIPAA requirement | 0.5 days |
| 5 | Move PHI decryption to storage layer (5a) | Prevents future PHI exposure bugs | 0.5 days |
| 6 | Add EHR request timeouts (4a) | Prevents hung requests in production | 0.5 days |
| 7 | Remove CSP unsafe-inline (6b) | Closes XSS vector | 1 day |
| 8 | Add monitoring/alerting (2b) | Detect outages before users report | 1 day |
| 9 | Add pagination everywhere (1b) | Prevents memory issues at scale | 1 day |
| 10 | Add accessibility support (8a) | Legal/ethical requirement | 0.5 days |

**Total estimated effort for top 10**: ~8-10 days of focused work to move from 7/10 overall to 8.5/10 across all categories.
