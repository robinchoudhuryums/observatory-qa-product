# Observatory QA — Comprehensive Codebase Audit Report

**Date**: 2026-03-21
**Scope**: Full codebase audit — architecture, security, HIPAA, functionality, design, scalability, business viability
**Codebase**: ~180 source files, ~20,000 lines server, ~11,200 lines frontend pages, 841 lines shared schema
**Test Suite**: 351 tests across 20 files (all passing), TypeScript strict mode (zero errors), Vite build clean

---

## Executive Summary

Observatory QA is a genuinely impressive solo/small-team SaaS product. The codebase demonstrates strong architectural decisions, proper multi-tenant isolation, real HIPAA awareness (not just checkbox compliance), and a well-considered feature set targeting an underserved market (dental/healthcare call QA). Three prior review passes have systematically addressed critical issues, and the codebase is in significantly better shape than most early-stage healthcare SaaS products.

That said, this audit identifies **remaining issues that must be addressed before production clinical deployment**, alongside ratings and strategic recommendations.

---

## Ratings

### Overall Project as Startup Base: 7.5/10

**Strengths:**
- Comprehensive feature set covering the full call analysis lifecycle
- Multi-tenant from day one (not bolted on later)
- Well-chosen tech stack with graceful degradation (runs with zero external deps in dev)
- Healthcare vertical positioning is strategically sound — large TAM, high switching costs
- Billing, RBAC, SSO, MFA, audit logging already built
- 25+ pages, 24 route files, 5 job queues — this is a real product, not a prototype

**Gaps:**
- No E2E tests (Playwright configured but no test files)
- Several query patterns won't survive past ~500 calls per org
- 16 npm vulnerabilities (4 high) including multer DoS issues
- No monitoring/observability beyond structured logs
- Deployment automation is incomplete

### HIPAA Compliance: 7/10

**What's done well:**
- Tamper-evident audit log chain (SHA-256 hash chain with sequence numbers)
- PHI field-level encryption (AES-256-GCM) with versioned format
- Session timeout (15-min rolling), account lockout (5 attempts)
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- PHI access logging on all sensitive endpoints
- MFA support (TOTP) with per-org enforcement
- API key hashing (SHA-256, never stored plaintext)
- WAF middleware detecting SQL injection, XSS, path traversal
- Rate limiting on auth endpoints (distributed via Redis)
- Structured logging via Pino (no PHI in logs)

**Gaps preventing certification:**
- `orgId` still optional on 8 insert schemas (employee, call, transcript, sentiment, analysis, access request, invitation, coaching session) — this is a tenant isolation violation at the validation layer
- No CSRF token protection (relying on `sameSite: "lax"` alone)
- `.env` plaintext secrets (no KMS/Vault integration)
- No encryption key rotation mechanism
- Clinical note edits lack optimistic locking (concurrent overwrites possible)
- No BAA documentation or compliance checklist artifact
- Missing audit of print/export events for clinical notes
- `(req as any).user` pattern in 17 places bypasses type safety for auth context

### Functionality Ratings by Component

| Component | Rating | Notes |
|-----------|--------|-------|
| **Call Upload & Analysis Pipeline** | 8/10 | Robust: empty transcript guard, S3 archival fallback, file hash dedup, score clamping, clinical note generation. Missing: streaming for large files, retry on partial failures |
| **Multi-Tenant Isolation** | 8/10 | orgId on all storage methods, org-scoped WebSocket, per-org rate limiting. Gap: optional orgId on insert schemas, no PostgreSQL RLS |
| **Authentication & Authorization** | 8/10 | Local + Google OAuth + SAML SSO + MFA + API keys. RBAC with 3 tiers. Account lockout. Route guards on frontend AND backend. Solid |
| **Dashboard & Reporting** | 6/10 | Functional but loads all calls into memory for aggregation. Will break at scale. Missing pagination on several endpoints |
| **Clinical Documentation** | 7/10 | SOAP/DAP/BIRP/procedure notes, PHI encryption, attestation workflow, style learning, 20+ templates. Gaps: no optimistic locking, attestation not provider-scoped enough |
| **EHR Integration** | 6/10 | Clean adapter pattern (Open Dental, Eaglesoft). SSRF protection added. API keys encrypted. But adapters make real HTTP calls with no mock mode, no timeout handling, no retry |
| **RAG Knowledge Base** | 8/10 | Hybrid search (pgvector cosine + BM25 keyword), proper chunking with overlap, minimum relevance threshold. Well-architected |
| **Billing (Stripe)** | 7/10 | Checkout, portal, webhooks, quota enforcement, plan feature gating. Missing: usage-based billing integration, proration handling |
| **Frontend UX** | 7/10 | Code-split pages, dark mode, keyboard shortcuts, error boundaries, loading states. Gaps: accessibility issues, missing memoization, no E2E tests |
| **Job Queue System** | 7/10 | 5 BullMQ queues with in-process fallback. Bounded concurrency. Missing: dead letter queue monitoring, worker health checks |
| **Testing** | 6/10 | 351 unit tests passing, good coverage on schemas/RBAC/multi-tenant. But zero tests for: calls.ts (largest route file), all external services, frontend, E2E flows |

### Design: 7/10

**Strengths:**
- Clean separation: routes / services / storage / shared schemas
- Storage abstraction (IStorage) enables multiple backends
- EHR adapter pattern is textbook clean
- Graceful degradation everywhere (Redis, S3, Bedrock, Stripe all optional)
- Per-org configuration flexibility (branding, models, categories, departments)

**Gaps:**
- SigV4 signing duplicated in 3 files (s3.ts, bedrock.ts, embeddings.ts) — now centralized in aws-credentials.ts for creds but signing still duplicated
- Some route files are very large (calls.ts: 995 lines, reports.ts: 647 lines)
- Mixed patterns: some routes use structured error codes (OBS-*), others use freeform messages

---

## New Issues Found in This Audit

### CRITICAL — Must Fix Before Clinical Deployment

#### C1. `orgId` Optional on 8 Insert Schemas
**File**: `shared/schema.ts:102, 253, 281, 304, 341, 399, 420, 442`

Despite `insertUserSchema` being fixed (review #6), these schemas still have `orgId: z.string().optional()`:
- `insertEmployeeSchema` (line 102)
- `insertCallSchema` (line 253)
- `insertTranscriptSchema` (line 281)
- `insertSentimentAnalysisSchema` (line 304)
- `insertCallAnalysisSchema` (line 341)
- `insertAccessRequestSchema` (line 399)
- `insertInvitationSchema` (line 420)
- `insertCoachingSessionSchema` (line 442)

The storage layer always sets orgId, but these schemas don't enforce it at validation time. A bug in any route handler could create org-less records.

**Fix**: Change all to `orgId: z.string()`.

#### C2. Multer Has 3 Known DoS Vulnerabilities
**Package**: `multer@2.0.2`

Three separate advisories:
- Incomplete cleanup DoS (GHSA-xf7r-hgr6-v32p)
- Resource exhaustion DoS (GHSA-v52c-386h-88mc)
- Uncontrolled recursion DoS (GHSA-5528-5vmv-3xc2)

This is the file upload handler — the primary data ingestion point. An attacker could DoS the upload endpoint.

**Fix**: Update multer or add request-level size/time limits at the reverse proxy (Caddy) layer.

#### C3. `requireClinicalPlan()` Silently Allows on Missing orgId
**File**: `server/routes/clinical.ts:22-24`

```typescript
if (!orgId) return next(); // ← Should return 403, not next()
```

If `req.orgId` is missing (which shouldn't happen but could via middleware misconfiguration), clinical endpoints are accessible without plan checks.

**Fix**: Return 403 on missing orgId, matching the pattern in `enforceQuota()`.

#### C4. Session Fixation in Registration Flow
**File**: `server/routes/registration.ts:137-143`

After registration, `req.login()` is called immediately without `req.session.regenerate()`. An attacker could craft a registration link with a pre-set session ID, and after the victim registers, the attacker's session ID becomes authenticated.

**Fix**: Call `req.session.regenerate()` before `req.login()`, matching the pattern already used in `server/routes/mfa.ts`.

#### C5. Password Reset Not Org-Scoped
**File**: `server/routes/password-reset.ts:100`

`getUserByUsername()` is called without org context. If the same email exists in multiple orgs, the reset could target the wrong account. More critically, an attacker can determine valid usernames across all orgs.

**Fix**: Require org context (org slug in the reset URL) or use email + org-scoped lookup.

#### C6. Patient Consent Not Enforced Before EHR Push
**File**: `server/routes/ehr.ts` (push-note endpoint), `server/routes/clinical.ts`

`patientConsentObtained` is stored on clinical notes but never checked before pushing notes to EHR or exporting. In healthcare, sharing clinical documentation without recorded consent is a compliance violation.

**Fix**: Check `clinicalNote.patientConsentObtained === true` before allowing EHR push or export.

### HIGH — Should Fix Soon

#### H1. Search Still Loads All Calls (Prior Review #35 — Unresolved)
**File**: `server/db/pg-storage.ts` — `searchCalls()` method

Still loads all calls with `getCallsWithDetails(orgId)` and filters in memory. This was flagged as P0 in review pass #2 but remains unresolved. An org with 5,000 calls would OOM on search.

#### H2. `getTopPerformers` Aggregates All Calls In Memory (Prior Review #37 — Unresolved)
Should be an SQL `GROUP BY / AVG()` query, not an in-memory reduce over all calls.

#### H3. Clinical Metrics and Style Learning Load All Calls (Prior Review #62-63 — Unresolved)
**File**: `server/routes/clinical.ts`

Both endpoints call `getCallsWithDetails(req.orgId!, {})` loading everything into memory.

#### H4. `(req as any).user` Pattern (17 occurrences)
**Files**: clinical.ts (9), ehr.ts (1), calls.ts (2), websocket.ts (3), sso.ts (1), api-keys.ts (1)

TypeScript type safety is bypassed. `server/types.d.ts` should be augmenting the Express Request interface, but these files cast to `any` instead.

#### H5. Tailwind Version Conflict Still Present
**File**: `package.json`

`@tailwindcss/vite: ^4.1.3` (v4 plugin) alongside `tailwindcss: ^3.4.17` (v3 core). Incompatible — the v4 plugin expects v4 core. Currently works because the v3 config is used, but the v4 plugin is likely dead code.

#### H6. No AbortController Timeouts on External API Calls (Prior Review #41 — Partially Addressed)
Bedrock has a 120s timeout now, but AssemblyAI polling has no timeout. A stuck transcription job blocks the pipeline indefinitely.

#### H7. WAF Regex ReDoS Risk
**File**: `server/middleware/waf.ts:23-48`

SQL injection detection patterns use `.*` which can cause exponential backtracking on crafted long payloads. An attacker could send a multi-MB request body that causes the WAF itself to DoS the server.

**Fix**: Add `req.body` length check before regex matching (e.g., skip WAF on bodies > 100KB), or use simpler patterns.

#### H8. PHI Decryption Scattered Across Route Handlers
**File**: `server/routes/clinical.ts:69-73`, `server/routes/ehr.ts`

Clinical note PHI fields are decrypted in individual route handlers rather than at the storage layer. This means every new route that reads clinical notes must remember to call `decryptField()` — a guaranteed future bug.

**Fix**: Move decryption into `pg-storage.ts` at the `getCallAnalysis()` level, or create a `getClinicalNote()` method that always returns decrypted data.

#### H9. Missing Audit Trail for Org Settings Changes
Settings updates (EHR config, retention policy, branding, SSO config) are not logged to the audit system. For HIPAA, configuration changes to the system should be auditable.

#### H10. SQL Injection in `addColumnIfNotExists()` (sync-schema.ts)
**File**: `server/db/sync-schema.ts:469-475`

Table and column names are interpolated directly into SQL via `sql.raw()` without identifier quoting:
```typescript
ALTER TABLE ${table} ADD COLUMN ${column} ${definition};
```

While these values currently come from hardcoded strings within the codebase (not user input), this is a dangerous pattern. If a future developer passes dynamic values, it becomes exploitable. Identifiers should be quoted: `"${table}"`.

#### H11. pgvector Fallback Creates Broken Table
**File**: `server/db/sync-schema.ts`

If the pgvector extension isn't available, `document_chunks` table is created without the `embedding vector(1024)` column. RAG queries will fail at runtime with "column does not exist" errors — but the sync logs only a warning, not an error. Users discover this in production when RAG returns zero results.

**Fix**: Either make pgvector required (fail loudly on startup) or disable RAG features entirely when pgvector is unavailable.

#### H12. Workers Use `require()` in ESM Codebase
**File**: `server/workers/index.ts`

Workers use `require()` for dynamic imports in an ESM codebase. This can cause module loading errors or circular dependency issues.

**Fix**: Convert to `await import()`.

### MEDIUM — Improve When Possible

#### M1. No E2E Tests
Playwright is configured (`package.json:19-20`) but `tests/e2e/` directory and config don't exist. Critical user flows (register -> upload -> transcribe -> view analysis -> attest clinical note) have zero automated coverage.

#### M2. In-Memory Caches Grow Without Hard Bounds
- `rateLimitMap` in `server/index.ts` — pruned every 5 min but no max size
- `refDocCache` in `server/routes/calls.ts` — pruned every 5 min but unbounded
- `chainState` in `server/services/audit-log.ts` — never pruned
- `loginAttempts` in `server/auth.ts` — pruned every 5 min

Under sustained load (many unique IPs or orgs), these maps could grow large.

#### M3. Missing `prefers-reduced-motion` for Animations
Framer Motion animations throughout the app don't respect reduced motion preferences. Accessibility gap.

#### M4. A/B Testing Missing Plan Tier Gate (Prior Review #72 — Unresolved)
Free tier users can run A/B tests, consuming Bedrock credits.

#### M5. Bundle Size Concerns
- `index.js` is 474 KB gzipped to 154 KB — large for initial load
- Recharts (`generateCategoricalChart`) is 373 KB gzipped to 102 KB
- Consider tree-shaking Recharts or using a lighter chart library for simple cases

#### M6. Frontend: Mutation Buttons Not Disabled While Pending
**File**: `client/src/components/tables/calls-table.tsx`

Delete and assign mutation buttons don't disable during pending state, allowing double-clicks to fire duplicate requests.

#### M7. Frontend: `localStorage` Access Without Try-Catch
**File**: `client/src/components/layout/sidebar.tsx`

`localStorage.getItem("theme")` / `setItem()` throws `QuotaExceededError` in private browsing or when storage is disabled. Should wrap in try-catch.

#### M8. Schema Types Too Loose
**File**: `shared/schema.ts`

Call `status` and `overallSentiment` use `z.string()` instead of `z.enum()`. This allows invalid states like `status: "banana"` to pass validation. Should be:
- `status: z.enum(["pending", "processing", "completed", "failed"])`
- `overallSentiment: z.enum(["positive", "neutral", "negative"])`

#### M9. CSP Allows `unsafe-inline` for Scripts
**File**: `server/index.ts`

`script-src 'self' 'unsafe-inline'` significantly weakens XSS protection. The `unsafe-inline` directive defeats the purpose of CSP. Should use nonces for inline scripts instead.

#### M10. EC2 Deployment Scripts Have Placeholder Values
**File**: `deploy/ec2/user-data.sh`

Git clone is commented out, `.env` contains `CHANGE_ME` values, and Caddyfile has `YOUR_DOMAIN` placeholder. Deployment will fail silently without manual intervention.

---

## What's Been Done Well (Recognition)

These deserve explicit recognition as above-average for an early-stage product:

1. **Tamper-evident audit logging** — SHA-256 hash chains with sequence numbers, dual-write to Pino + PostgreSQL. This is beyond what most Series A companies implement.

2. **PHI encryption** — AES-256-GCM with versioned prefixes (`enc_v1:`), backward-compatible decryption, graceful degradation when key unavailable.

3. **Graceful degradation** — The app literally runs with just `SESSION_SECRET` and `ASSEMBLYAI_API_KEY`. No Redis? In-memory sessions. No Bedrock? Default scores. No S3? Local storage. No Stripe? Free tier only. This is excellent engineering.

4. **WAF middleware** — Application-level attack pattern detection for SQL injection, XSS, path traversal, with IP anomaly scoring. Defense-in-depth done right.

5. **SSRF protection on EHR** — Proper URL validation blocking internal/metadata IPs, HTTPS enforcement in production.

6. **Clinical validation** — Server-side validation of clinical notes (completeness scoring, missing section detection, format-specific requirements) independent of AI output.

7. **EHR adapter pattern** — Clean interface abstraction. Adding Dentrix/Epic is a matter of implementing `IEhrAdapter`, not touching route logic.

8. **Style learning** — Analyzing provider's attested notes to learn documentation preferences is a genuinely innovative feature.

9. **351 unit tests** — Covering schemas, RBAC, multi-tenant isolation, billing, registration, audit logging, PHI encryption, clinical validation. All passing.

10. **Auto schema sync** — `sync-schema.ts` eliminates the need for migration tooling in production. Idempotent CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.

---

## Strategic Improvements & Future Path

### Immediate (Before First Paying Customer)

1. **Fix orgId optional schemas** (C1) — 30 min, prevents potential tenant isolation bugs
2. **Update multer** (C2) — or add Caddy-level request limits
3. **Fix requireClinicalPlan** (C3) — 5 min
4. **Fix search query performance** (H1) — Convert to JOIN-based SQL query
5. **Fix top performers aggregation** (H2) — SQL GROUP BY
6. **Fix clinical metrics loading** (H3) — Add SQL aggregate queries
7. **Run `npm audit fix`** — Resolves some of the 16 vulnerabilities

### Short-Term (First 3 Months)

8. **Add E2E tests** — Playwright tests for: registration, login, upload, analysis view, clinical attestation, admin flows
9. **Add CSRF protection** — Use `csurf` middleware or double-submit cookie pattern
10. **Add request correlation IDs** — UUID per request for distributed debugging
11. **PostgreSQL RLS** — Row-level security as defense-in-depth for tenant isolation
12. **API versioning** — `/api/v1/` prefix before the surface area grows further
13. **CDN for static assets** — Move `dist/client/` behind CloudFront
14. **Secrets management** — AWS Secrets Manager or Parameter Store for production

### Medium-Term (3-12 Months)

15. **Horizontal scaling** — Separate API servers, WebSocket server, workers behind a load balancer
16. **Read replicas** — Dashboard/reporting queries on read replica
17. **Redis caching layer** — Dashboard metrics (60s TTL), employee lists (5min TTL)
18. **OpenTelemetry** — Distributed tracing for the full pipeline (upload -> transcribe -> analyze -> store)
19. **White-label / custom domains** — Branding system already exists; add custom domain support
20. **Real-time coaching** — Leverage existing WebSocket infrastructure for live call monitoring

### Strategic Product Opportunities

| Opportunity | Effort | Revenue Impact | Why |
|-------------|--------|---------------|-----|
| **QA + Clinical Docs bundle** ($129/mo) | 1 week | +30% ARPU | Cross-sell existing features |
| **Knowledge Base standalone** ($49/mo) | 2 weeks | New revenue stream | RAG system is fully decoupled |
| **Super-admin dashboard** | 3 weeks | Operational efficiency | Needed before 50 orgs |
| **Real-time coaching alerts** | 2 weeks | Feature differentiator | WebSocket + scoring engine exist |
| **Spanish language support** | 3 weeks | 2x addressable market in dental | AssemblyAI supports Spanish |
| **Marketplace integrations** | 4 weeks | Platform play | API key system already built |
| **SOC 2 Type II certification** | 8-12 weeks | Enterprise gate opener | Audit logging + encryption foundation is strong |

### Competitive Positioning

The platform sits at an interesting intersection:
- **vs. generic call analytics** (CallRail, Invoca): Observatory has clinical documentation + EHR integration that generic platforms don't
- **vs. clinical AI scribes** (Freed, Abridge, Nabla): Observatory combines QA scoring with clinical docs — most scribes don't do QA
- **vs. healthcare-specific QA** (limited competition): Few products combine call QA + clinical documentation for dental practices

The **dental-first vertical** is strategically sound:
- Dental practices are underserved by enterprise healthcare IT
- Lower regulatory complexity than hospital systems
- High volume of insurance/scheduling calls that benefit from QA
- Natural expansion to other specialties via the adapter pattern

---

## Issue Count Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| **Critical** | 6 | orgId schemas, multer DoS, session fixation, password reset scope, consent enforcement, clinical plan bypass |
| **High** | 12 | Query performance (4), type safety, tailwind conflict, API timeouts, WAF ReDoS, SQL injection in sync-schema, pgvector fallback, worker ESM, PHI decryption scatter |
| **Medium** | 10 | No E2E tests, cache bounds, accessibility, A/B plan gate, bundle size, mutation buttons, localStorage, loose schema types, CSP unsafe-inline, deployment scripts |

## Final Ratings

| Area | Rating | Trajectory |
|------|--------|------------|
| **Startup Viability** | 7.5/10 | Strong foundation, needs scale testing |
| **HIPAA Compliance** | 7/10 | Above average for stage, specific gaps to close |
| **Core Call QA** | 8/10 | Solid, well-hardened pipeline |
| **Clinical Documentation** | 7/10 | Innovative features, needs security tightening |
| **EHR Integration** | 6/10 | Good patterns, needs production hardening |
| **Frontend UX** | 7/10 | Well-built, needs accessibility + perf work |
| **Testing** | 6/10 | Good unit coverage, zero E2E |
| **Scalability** | 5/10 | Will hit walls at ~500 calls/org — known, fixable |
| **Security** | 7/10 | WAF, encryption, audit logs, rate limiting. Gaps: CSRF, multer, session fixation, CSP |
| **Code Quality** | 7.5/10 | Clean architecture, good separation of concerns, consistent patterns |
| **Documentation** | 8/10 | CLAUDE.md is exceptionally thorough |
| **Infrastructure/DevOps** | 5.5/10 | CI exists, but deployment scripts incomplete, no monitoring, single instance |

**Bottom line**: This is a genuinely viable startup base with strong healthcare-specific features. The architecture is sound, the multi-tenant isolation is real (not cosmetic), and the HIPAA compliance is well above typical for an early-stage product. The main risks are: (1) query performance patterns that won't scale past a few hundred calls per org, (2) specific security gaps (session fixation, optional orgId on schemas, CSP `unsafe-inline`, multer DoS), (3) zero E2E test coverage for critical clinical workflows, and (4) deployment infrastructure is not production-ready (placeholder values, no monitoring, single point of failure). All of these are fixable without architectural changes — the foundation is solid.
