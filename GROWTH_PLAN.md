# Observatory QA — Growth Steps Plan

Architectural plans for features beyond the current critical-gap fixes. Each section covers scope, approach, key files, and dependencies.

---

## 1. Multi-Stage AI Analysis Pipeline

**Goal**: Replace single-pass AI analysis with a staged pipeline that separates concerns, improves accuracy, and enables per-stage retries.

**Current**: One Bedrock call in `server/routes/calls.ts` that does transcription scoring, sentiment, compliance, topic extraction, and feedback generation in a single prompt.

**Proposed stages**:

| Stage | Purpose | Model | Retry |
|-------|---------|-------|-------|
| 1. Transcript QA | Clean/normalize transcript, detect speakers, segment turns | Haiku (fast/cheap) | 2x |
| 2. Compliance Check | Evaluate against org's required phrases, flag violations | Sonnet | 1x |
| 3. Performance Scoring | Score communication, resolution, customer experience | Sonnet | 1x |
| 4. Coaching Insights | Generate strengths, suggestions, action items | Sonnet | 1x |
| 5. Summary & Tags | Extract topics, generate summary, auto-categorize | Haiku | 2x |

**Key changes**:
- New `server/services/analysis-pipeline.ts` orchestrator
- Each stage is an independent function with its own prompt template
- Stages write intermediate results to `call_analyses` table (add `stageResults` JSONB column)
- Stages 2-5 can run in parallel after stage 1
- Per-stage retry with exponential backoff (already have `withRetry` in helpers)
- BullMQ job can track stage progress via `job.updateProgress()`

**Dependencies**: None — builds on existing Bedrock provider and prompt template system.

---

## 2. SSO (SAML 2.0 / OIDC)

**Goal**: Enterprise plan feature — allow orgs to authenticate via their identity provider (Okta, Azure AD, Google Workspace).

**Current**: `shared/schema.ts` has SSO in the Enterprise plan definition but no implementation.

**Approach**:
- Use `passport-saml` for SAML 2.0 (Okta, Azure AD, OneLogin)
- Use existing `passport` + Google OAuth as base pattern
- Per-org SSO config stored in `orgSettingsSchema`:
  ```
  sso: {
    enabled: boolean;
    provider: "saml" | "oidc";
    entryPoint: string;     // IdP login URL
    issuer: string;         // SP entity ID
    cert: string;           // IdP certificate (PEM)
    callbackUrl?: string;   // Override default callback
  }
  ```

**Key files to create/modify**:
- `server/routes/sso.ts` — SAML/OIDC callback routes (per-org)
- `server/auth.ts` — Add SAML strategy dynamically per org
- `shared/schema.ts` — Extend `orgSettingsSchema` with SSO config
- `client/src/pages/auth.tsx` — "Sign in with SSO" button (org-slug-aware)

**Flow**:
1. User visits `/auth?org=acme` → sees "Sign in with SSO"
2. Redirects to IdP (Okta) → user authenticates
3. IdP POSTs SAML assertion to `/api/auth/sso/callback/:orgSlug`
4. Server validates assertion, maps email → user in org, creates session
5. Auto-provision users on first SSO login (JIT provisioning)

**Dependencies**: `passport-saml` package. Enterprise plan gate in billing middleware.

---

## 3. Two-Factor Authentication (2FA / TOTP)

**Goal**: Optional TOTP-based 2FA for enhanced security (HIPAA best practice).

**Approach**:
- TOTP (Time-based One-Time Password) via `otplib` — compatible with Google Authenticator, Authy
- Per-user `totpSecret` (encrypted) and `totpEnabled` flag in users table
- Recovery codes stored hashed (10 single-use codes generated on setup)

**New schema fields** (DB + Zod):
```sql
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN recovery_codes JSONB; -- hashed
```

**Flow**:
1. **Setup**: `POST /api/auth/2fa/setup` → returns QR code (otpauth:// URI) + recovery codes
2. **Verify**: `POST /api/auth/2fa/verify` → user submits TOTP from app → enables 2FA
3. **Login**: After password auth, if 2FA enabled → return `{ requires2FA: true }` → frontend shows TOTP input → `POST /api/auth/2fa/validate` with code
4. **Recovery**: Accept recovery code instead of TOTP (marks code as used)
5. **Disable**: `DELETE /api/auth/2fa` (requires current TOTP code)

**Key files**:
- `server/routes/two-factor.ts` — Setup, verify, validate, disable endpoints
- `server/auth.ts` — Modify login flow to check `totpEnabled`
- `client/src/pages/settings.tsx` — 2FA setup UI with QR code
- `client/src/pages/auth.tsx` — 2FA challenge step in login flow

**Dependencies**: `otplib`, `qrcode` packages.

---

## 4. Audit Log Viewer UI

**Goal**: Admin UI to view and search HIPAA audit logs (currently logged to stdout/Betterstack only).

**Current**: `server/services/audit-log.ts` writes structured JSON to Pino. No queryable storage or UI.

**Approach**:
- Store audit events in a new `audit_logs` DB table (append-only, no UPDATE/DELETE)
- Admin-only API endpoint with pagination, filtering, and date range
- Frontend audit viewer page with table, search, and export

**New DB table**:
```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  event VARCHAR(100) NOT NULL,
  user_id TEXT,
  username VARCHAR(100),
  role VARCHAR(20),
  resource_type VARCHAR(50),
  resource_id TEXT,
  ip VARCHAR(45),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX audit_logs_org_idx ON audit_logs(org_id, created_at DESC);
```

**Key files**:
- `server/db/schema.ts` — Add `auditLogs` table
- `server/services/audit-log.ts` — Write to DB in addition to Pino
- `server/routes/admin.ts` — `GET /api/admin/audit-logs` with pagination
- `client/src/pages/audit-logs.tsx` — Admin page with data table, date picker, search

**Dependencies**: None beyond existing stack.

---

## 5. End-to-End Tests

**Goal**: Browser-based E2E tests covering critical user flows.

**Framework**: Playwright (best Node.js E2E test framework, built-in multi-browser support).

**Critical flows to test**:

| Test | Flow |
|------|------|
| Auth | Register org → login → logout → login again |
| Upload | Upload audio file → wait for processing → verify transcript/analysis |
| Reports | Navigate to reports → filter by date → verify metrics display |
| Coaching | Create coaching session → assign to employee → mark complete |
| Admin | Create user → update role → delete user |
| Export | Download calls CSV → verify file contents |
| Password Reset | Request reset → use token → login with new password |
| RBAC | Viewer can't access admin pages → manager can't manage users |

**Setup**:
```
tests/e2e/
  playwright.config.ts    # Config: baseURL, timeouts, browsers
  fixtures/               # Test audio files, seed data
  auth.spec.ts
  upload.spec.ts
  reports.spec.ts
  admin.spec.ts
  export.spec.ts
```

**Package.json scripts**:
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

**CI integration**: Add Playwright step to `.github/workflows/ci.yml` (requires starting the dev server).

**Dependencies**: `@playwright/test` dev dependency.

---

## 6. Advanced Search

**Goal**: Replace basic text search with faceted, multi-field search supporting filters, sorting, and full-text relevance ranking.

**Current**: `storage.searchCalls()` does basic `ILIKE` matching on transcript text.

**Proposed**:
- PostgreSQL full-text search with `tsvector` + `tsquery` (no external search service needed)
- Add `search_vector` column to `calls` table (auto-updated via trigger)
- Faceted search API: filter by score range, sentiment, date range, employee, category, flags

**New endpoint**: `GET /api/search/v2`
```
?q=customer+complaint          # Full-text query
&minScore=5&maxScore=10        # Performance score range
&sentiment=negative            # Sentiment filter
&from=2026-01-01&to=2026-03-01 # Date range
&employeeId=emp_123            # Employee filter
&category=sales                # Call category
&flags=low_score               # Flag filter
&sort=score_desc               # Sort: relevance, date, score
&page=1&limit=20               # Pagination
```

**Key changes**:
- `server/db/schema.ts` — Add `searchVector` tsvector column with GIN index
- `server/db/pg-storage.ts` — Implement `searchCallsV2()` with `ts_rank()`
- `server/routes/reports.ts` — New `/api/search/v2` endpoint
- `client/src/pages/search-v2.tsx` — Already exists, wire up to new API
- Migration to backfill `search_vector` for existing calls

**Dependencies**: PostgreSQL full-text search (built-in). No additional packages.

---

## 7. Enhanced Coaching & Automated Recommendations

**Goal**: AI-generated coaching recommendations based on call analysis patterns, with automated session creation and progress tracking.

**Current**: Manual coaching session CRUD in `server/routes/coaching.ts`. No AI involvement.

**Proposed features**:

### 7a. Auto-Generated Coaching Recommendations
- After each call analysis, check if the agent's rolling average drops below threshold
- If compliance sub-score < 6 for 3+ calls → auto-create coaching session targeting compliance
- If sentiment trending negative → recommend de-escalation training
- Store recommendations in new `coaching_recommendations` table

### 7b. AI Coaching Summary
- `POST /api/coaching/:id/generate-plan` — AI generates action plan based on the agent's recent call analyses
- Uses `buildAgentSummaryPrompt()` pattern from reports
- Includes specific call examples, pattern analysis, and improvement targets

### 7c. Coaching Effectiveness Tracking
- Compare agent performance scores before/after coaching sessions
- New API: `GET /api/coaching/:id/effectiveness` — returns pre/post metrics
- Dashboard widget showing coaching ROI (score improvement per session)

**Key files**:
- `server/services/coaching-engine.ts` — Auto-recommendation logic
- `server/routes/coaching.ts` — New endpoints for AI plan generation and effectiveness tracking
- `shared/schema.ts` — Add `coachingRecommendationSchema`
- `server/db/schema.ts` — Add `coaching_recommendations` table
- `client/src/pages/coaching.tsx` — Recommendations panel, effectiveness charts

**Dependencies**: Existing Bedrock AI provider. No additional packages.

---

## Priority & Sequencing

| Phase | Features | Effort | Impact |
|-------|----------|--------|--------|
| **Phase 1** (next) | E2E Tests, Audit Log Viewer, Enhanced Coaching | Medium | High — quality assurance, compliance, user value |
| **Phase 2** | Multi-Stage AI Pipeline, Advanced Search | High | High — accuracy, UX |
| **Phase 3** | 2FA, SSO | Medium | Medium — enterprise readiness |

Each feature is independent and can be built in parallel by different developers. No cross-feature dependencies exist.
