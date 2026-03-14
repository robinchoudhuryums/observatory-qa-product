# Observatory QA — AI-Powered Call Quality Analysis Platform

## Project Overview
Observatory QA is a multi-tenant, HIPAA-compliant SaaS platform for call quality analysis. Organizations upload call recordings, which are transcribed by AssemblyAI and analyzed by AI (AWS Bedrock Claude or Google Gemini) for performance scoring, compliance, sentiment analysis, and coaching insights. Includes a RAG knowledge base for grounding AI analysis in each organization's own documentation.

**Product origin**: Evolved from a single-tenant internal tool (CallAnalyzer for UMS) into a multi-tenant SaaS product. The multi-tenant transformation plan is documented in `MULTI_TENANT_TRANSFORMATION_PLAN.md`.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS 3, shadcn/ui, Recharts, Wouter (routing), TanStack Query, Framer Motion
- **Backend**: Express.js + TypeScript (ESM), Node.js
- **Database**: PostgreSQL (via Drizzle ORM) — recommended for production SaaS
- **AI Analysis**: AWS Bedrock (Claude Sonnet) or Google Gemini — per-org configurable via `ai-factory.ts`
- **Transcription**: AssemblyAI
- **RAG**: pgvector for vector similarity search, Amazon Titan Embed V2 for embeddings, BM25 keyword boosting
- **Object Storage**: AWS S3 or Google Cloud Storage — for audio files and blob storage
- **Job Queues**: BullMQ (Redis-backed) — audio processing, reanalysis, retention, usage metering, document indexing
- **Sessions & Rate Limiting**: Redis (connect-redis, ioredis) — falls back to in-memory when unavailable
- **Billing**: Stripe (subscriptions, checkout, customer portal, webhooks)
- **Logging**: Pino + Betterstack (@logtail/pino) for structured log aggregation
- **Auth**: Passport.js (local strategy + Google OAuth 2.0), session-based, role-based (viewer/manager/admin)
- **Hosting**: EC2 with Caddy (production HIPAA), Render.com (staging/non-PHI)

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   - **Required**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`
   - **Auth users**: `AUTH_USERS` — format: `username:password:role:displayName:orgSlug` (comma-separated for multiple)
   - **Storage backend** (pick one):
     - `STORAGE_BACKEND=postgres` + `DATABASE_URL` — recommended for SaaS (requires PostgreSQL + pgvector extension)
     - `S3_BUCKET` — S3-backed JSON file storage (original single-tenant approach)
     - `GCS_BUCKET` + `GCS_CREDENTIALS` — Google Cloud Storage
     - No config → **in-memory storage (data lost on restart, dev only)**
   - **AI provider** (pick one):
     - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — for Bedrock (Claude)
     - `GEMINI_API_KEY` — for Google Gemini
   - **Optional**: `REDIS_URL` (enables distributed sessions, rate limiting, job queues), `DATABASE_URL` (PostgreSQL)

3. Start the dev server:
   ```bash
   npm run dev   # Starts on port 5000 (or $PORT) with Vite HMR + tsx watch
   ```

4. (Optional) Start background workers:
   ```bash
   npm run workers   # Requires REDIS_URL — processes async jobs
   ```

## Commands
```bash
npm run dev            # Dev server (tsx watch)
npm run build          # Vite frontend + esbuild backend → dist/
npm run start          # Production server (NODE_ENV=production node dist/index.js)
npm run check          # TypeScript type check
npm run test           # Run tests (tsx --test tests/*.test.ts)
npm run seed           # Seed data (tsx seed.ts)
npm run workers        # Start BullMQ worker processes (requires REDIS_URL)
npm run workers:build  # Build workers → dist/workers.js
npm run db:generate    # Generate Drizzle migration files
npm run db:migrate     # Run Drizzle migrations (tsx server/db/migrate.ts)
npm run db:push        # Push schema to DB (drizzle-kit push)
npm run db:studio      # Open Drizzle Studio (DB GUI)
npx vite build         # Frontend-only build (quick verification)
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx`
- **Location**: `tests/` directory
- **Test files**:
  - `tests/schema.test.ts` — Zod schema validation (orgId on all entities, organization schemas)
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)
  - `tests/routes.test.ts` — API route handler tests
  - `tests/multitenant.test.ts` — Cross-org data isolation verification
  - `tests/rbac.test.ts` — Role-based access control
  - `tests/pipeline.test.ts` — Audio processing pipeline
  - `tests/user-management.test.ts` — User CRUD, invitations
  - `tests/registration.test.ts` — Self-service org registration
  - `tests/api-keys.test.ts` — API key auth
  - `tests/billing.test.ts` — Stripe subscription & quota enforcement
  - `tests/usage.test.ts` — Usage metering
  - `tests/notifications.test.ts` — Webhook notifications

## Architecture

### Key Directories
```
client/src/pages/            # Route pages (19 pages)
client/src/components/       # UI components
  ui/                        #   shadcn/ui primitives
  dashboard/                 #   Dashboard cards (metrics-overview, sentiment-analysis, performance-card)
  tables/                    #   Data tables (calls-table)
  transcripts/               #   Transcript viewer
  search/                    #   Search components (employee-filter, call-card)
  upload/                    #   File upload (file-upload)
  layout/                    #   Layout (sidebar)
  lib/                       #   Utilities (confirm-dialog, error-boundary)
  branding-provider.tsx      #   Per-org branding context

server/
  index.ts                   # App entry: Express setup, middleware, startup sequence
  auth.ts                    # Passport.js auth, session management, org context middleware
  vite.ts                    # Vite dev server integration + static serving
  utils.ts                   # Shared server utilities
  types.d.ts                 # Express type augmentations
  logger.ts                  # (Legacy) Logger — prefer server/services/logger.ts

server/routes/               # Modular API route files
  index.ts                   #   Route registration orchestrator
  auth.ts                    #   Login/logout/me
  registration.ts            #   Self-service org + user registration
  oauth.ts                   #   Google OAuth 2.0 flow
  onboarding.ts              #   Logo upload, reference doc upload, RAG search, branding
  calls.ts                   #   Call CRUD, upload, audio streaming, transcript/sentiment/analysis
  employees.ts               #   Employee CRUD, CSV import
  dashboard.ts               #   Metrics, sentiment distribution, top performers
  reports.ts                 #   Summary/filtered reports, agent profiles
  coaching.ts                #   Coaching session CRUD
  admin.ts                   #   User management, prompt templates, org settings
  access.ts                  #   Access request flow
  api-keys.ts                #   API key CRUD + middleware
  billing.ts                 #   Stripe checkout, portal, webhooks, quota enforcement
  insights.ts                #   Aggregate insights & trends
  health.ts                  #   Health check endpoint
  helpers.ts                 #   Shared route utilities

server/services/             # Business logic & integrations
  ai-factory.ts              #   AI provider selection (per-org or global)
  ai-provider.ts             #   AI analysis interface, prompt building, JSON parsing
  bedrock.ts                 #   AWS Bedrock Claude provider (raw REST + SigV4)
  gemini.ts                  #   Google Gemini provider (AI Studio + Vertex AI)
  assemblyai.ts              #   AssemblyAI transcription + transcript processing
  s3.ts                      #   S3 client (raw REST + SigV4, no AWS SDK)
  gcs.ts                     #   Google Cloud Storage client
  redis.ts                   #   Redis connection, session store, rate limiter, pub/sub
  queue.ts                   #   BullMQ queue definitions (5 queues)
  websocket.ts               #   WebSocket for real-time call processing updates (org-scoped)
  stripe.ts                  #   Stripe SDK integration
  logger.ts                  #   Pino structured logging + Betterstack transport
  audit-log.ts               #   HIPAA audit logging (PHI access events)
  notifications.ts           #   Webhook notifications for flagged calls
  embeddings.ts              #   Amazon Titan Embed V2 via Bedrock (1024-dim vectors)
  rag.ts                     #   RAG orchestrator (chunk → embed → pgvector search → BM25 rerank)
  rag-worker.ts              #   In-process RAG indexing fallback
  chunker.ts                 #   Document chunking (sliding window, natural breaks, section detection)

server/storage/              # Storage abstraction layer
  types.ts                   #   IStorage interface (all methods org-scoped)
  index.ts                   #   Storage backend factory (postgres > S3 > GCS > memory)
  cloud.ts                   #   CloudStorage implementation (S3/GCS JSON files)
  memory.ts                  #   MemStorage (in-memory, dev only)

server/db/                   # PostgreSQL (Drizzle ORM)
  schema.ts                  #   Table definitions (15 tables + pgvector document_chunks)
  index.ts                   #   Database connection initialization
  migrate.ts                 #   Migration runner
  pg-storage.ts              #   PostgresStorage implementing IStorage

server/workers/              # BullMQ worker processes (run separately)
  index.ts                   #   Worker entry point — starts all workers
  retention.worker.ts        #   Data retention purge (per-org)
  usage.worker.ts            #   Usage event recording
  reanalysis.worker.ts       #   Bulk call re-analysis
  indexing.worker.ts         #   RAG document indexing (chunk + embed)

shared/schema.ts             # Zod schemas + TypeScript types (shared client/server)
deploy/ec2/                  # EC2 deployment config (Caddy, systemd, bootstrap script)
tests/                       # Unit tests (Node test runner)
```

### Frontend Pages
| Page | Route | Description |
|------|-------|-------------|
| `landing.tsx` | `/` | Public landing / marketing page |
| `auth.tsx` | `/auth` | Login + registration forms |
| `onboarding.tsx` | `/onboarding` | Post-registration org setup wizard |
| `invite-accept.tsx` | `/invite/:token` | Accept team invitation |
| `dashboard.tsx` | `/dashboard` | Main dashboard with KPIs |
| `transcripts.tsx` | `/transcripts` | Call list + transcript viewer |
| `upload.tsx` | `/upload` | Audio file upload |
| `employees.tsx` | `/employees` | Employee roster management |
| `coaching.tsx` | `/coaching` | Coaching session management |
| `reports.tsx` | `/reports` | Reports with date filtering |
| `performance.tsx` | `/performance` | Performance metrics & trends |
| `sentiment.tsx` | `/sentiment` | Sentiment analysis views |
| `search.tsx` | `/search` | Full-text call search |
| `search-v2.tsx` | `/search-v2` | Enhanced search (v2) |
| `insights.tsx` | `/insights` | Aggregate insights & trends |
| `prompt-templates.tsx` | `/prompt-templates` | AI prompt template management |
| `admin.tsx` | `/admin` | User management, org settings |
| `settings.tsx` | `/settings` | User preferences (dark mode, etc.) |

### Multi-Tenant Data Model
Every data entity has an `orgId` field. All storage methods take `orgId` as the first parameter. Data isolation is enforced at the storage layer — no method can access data without specifying the org.

**Schemas in `shared/schema.ts`**:
- `Organization` — id, name, slug, status, settings (departments, subTeams, branding, AI config, quotas)
- `User` — id, orgId, username, passwordHash, name, role
- `Employee` — id, orgId, name, email, role, initials, status, subTeam
- `Call` — id, orgId, employeeId, fileName, status, duration, callCategory, tags
- `Transcript` — id, orgId, callId, text, confidence, words[]
- `SentimentAnalysis` — id, orgId, callId, overallSentiment, overallScore, segments[]
- `CallAnalysis` — id, orgId, callId, performanceScore, subScores, summary, topics, feedback, flags, etc.
- `AccessRequest` — id, orgId, name, email, requestedRole, status
- `CoachingSession` — id, orgId, employeeId, callId, category, title, notes, actionPlan, status
- `PromptTemplate` — id, orgId, callCategory, evaluationCriteria, requiredPhrases, scoringWeights
- `Invitation` — id, orgId, email, role, token, status, expiresAt
- `ApiKey` — id, orgId, name, keyHash, keyPrefix, permissions, status
- `Subscription` — id, orgId, planTier, status, stripeCustomerId, billingInterval
- `ReferenceDocument` — id, orgId, name, category, fileName, extractedText, appliesTo, isActive

**Plan tiers** (defined statically in `shared/schema.ts`):
| Plan | Price | Calls/mo | Storage | RAG | Custom Templates | SSO |
|------|-------|----------|---------|-----|-----------------|-----|
| Free | $0 | 50 | 500 MB | No | No | No |
| Pro | $99/mo | 1,000 | 10 GB | Yes | Yes | No |
| Enterprise | $499/mo | Unlimited | 100 GB | Yes | Yes | Yes |

### Audio Processing Pipeline (server/routes/calls.ts)
1. Upload audio file (multer)
2. Archive to S3 (non-blocking — continues with warning on failure)
3. Send to AssemblyAI for transcription (polling until complete)
4. Load org's custom prompt template by call category (falls back to default)
5. If RAG enabled: retrieve relevant document chunks from pgvector, inject into AI prompt
6. Send transcript + context to AI provider (Bedrock or Gemini) for analysis
7. Normalize results: confidence scores, agent name detection, flag setting
8. Store transcript, sentiment, and analysis
9. Auto-assign call to employee if agent name detected
10. Track usage (transcription + AI analysis events)
11. Send webhook notification if call flagged
12. WebSocket notification to org clients

**On failure**: Call status → "failed", WebSocket notifies client, uploaded file cleaned up. Errors logged without stack traces (HIPAA). No automatic retry — users re-upload.

### RAG (Retrieval-Augmented Generation) System
Reference documents uploaded by orgs are processed through:
1. **Text extraction** — extracted on upload (PDF/text content)
2. **Chunking** (`chunker.ts`) — sliding window with overlap (400 tokens, 80 token overlap), natural break detection (paragraph > sentence > line), section header tracking
3. **Embedding** (`embeddings.ts`) — Amazon Titan Embed V2 via Bedrock (1024 dimensions, raw REST + SigV4)
4. **Storage** — chunks + embeddings stored in `document_chunks` table (pgvector)
5. **Retrieval** (`rag.ts`) — hybrid search: pgvector cosine similarity + BM25 keyword boosting, weighted scoring (70% semantic, 30% keyword)
6. **Injection** — relevant chunks formatted and injected into the AI analysis prompt

RAG requires: PostgreSQL with pgvector extension + AWS credentials for Titan embeddings. Document indexing can run via BullMQ worker or in-process fallback.

### Storage Backend Selection (server/storage/index.ts)
Priority order:
1. `STORAGE_BACKEND=postgres` + `DATABASE_URL` → **PostgresStorage** (Drizzle ORM, recommended)
2. `STORAGE_BACKEND=s3` or `S3_BUCKET` → **CloudStorage** (S3 JSON files)
3. `STORAGE_BACKEND=gcs` or GCS creds → **CloudStorage** (GCS JSON files)
4. No config → **MemStorage** (in-memory, data lost on restart)

PostgreSQL + S3 hybrid: When using PostgresStorage, set `S3_BUCKET` alongside `DATABASE_URL` for audio blob storage in S3 while structured data lives in PostgreSQL.

### Job Queue System (BullMQ)
Five queues, all Redis-backed with fallback to in-process execution:
| Queue | Purpose | Retries |
|-------|---------|---------|
| `audio-processing` | Transcription + AI analysis pipeline | 2 (exponential backoff) |
| `bulk-reanalysis` | Re-analyze all calls for an org | 1 |
| `data-retention` | Purge expired calls per org policy | 3 |
| `usage-metering` | Track per-org usage events for billing | 3 |
| `document-indexing` | RAG indexing (chunk + embed) | 2 |

Workers run as a separate process: `npm run workers` (dev) or `node dist/workers.js` (prod).

### AI Provider System (server/services/ai-factory.ts)
Selection priority:
1. Per-org `aiProvider` setting (from org's `OrgSettings`)
2. `AI_PROVIDER` env var (`bedrock` or `gemini`)
3. Auto-detect based on available credentials

Both providers implement the `AIAnalysisProvider` interface defined in `ai-provider.ts`. Per-org providers are cached to avoid re-creation on every call.

## API Routes Overview

### Authentication & Registration (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (rate limited: 5/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user + org context |
| POST | `/api/auth/register` | Self-service org + admin user registration |
| GET | `/api/auth/google` | Google OAuth redirect |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| POST | `/api/invitations/accept` | Accept team invitation |

### Calls (authenticated, org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/calls` | authenticated | List calls (filtering/pagination) |
| GET | `/api/calls/:id` | authenticated | Get call details |
| POST | `/api/calls/upload` | authenticated | Upload audio (starts pipeline) |
| GET | `/api/calls/:id/audio` | authenticated | Stream audio for playback |
| GET | `/api/calls/:id/transcript` | authenticated | Get transcript |
| GET | `/api/calls/:id/sentiment` | authenticated | Get sentiment analysis |
| GET | `/api/calls/:id/analysis` | authenticated | Get AI analysis |
| PATCH | `/api/calls/:id/analysis` | manager+ | Edit AI analysis |
| PATCH | `/api/calls/:id/assign` | manager+ | Assign call to employee |
| DELETE | `/api/calls/:id` | manager+ | Delete call |

### Employees (authenticated, org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | authenticated | List org employees |
| POST | `/api/employees` | manager+ | Create employee |
| PATCH | `/api/employees/:id` | manager+ | Update employee |
| POST | `/api/employees/import-csv` | admin | Bulk import from CSV |

### Dashboard & Reports (authenticated, org-scoped)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/metrics` | Call metrics & performance |
| GET | `/api/dashboard/sentiment` | Sentiment distribution |
| GET | `/api/dashboard/performers` | Top performers |
| GET | `/api/search` | Full-text search |
| GET | `/api/performance` | Performance metrics |
| GET | `/api/reports/summary` | Summary report |
| GET | `/api/reports/filtered` | Filtered reports (date range) |
| GET | `/api/reports/agent-profile/:id` | Agent profile |
| POST | `/api/reports/agent-summary/:id` | Generate agent summary |
| GET | `/api/insights` | Aggregate insights & trends |

### Coaching (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/coaching` | manager+ | List coaching sessions |
| GET | `/api/coaching/employee/:id` | authenticated | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |

### Admin & Configuration (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | admin | List org users |
| POST | `/api/admin/users` | admin | Create user |
| PATCH | `/api/admin/users/:id` | admin | Update user |
| DELETE | `/api/admin/users/:id` | admin | Delete user |
| POST | `/api/admin/invitations` | admin | Send team invitation |
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| GET | `/api/access-requests` | admin | List access requests |
| PATCH | `/api/access-requests/:id` | admin | Approve/deny request |

### API Keys (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/api-keys` | admin | List API keys |
| POST | `/api/api-keys` | admin | Create API key |
| DELETE | `/api/api-keys/:id` | admin | Revoke API key |

### Billing (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/billing/subscription` | authenticated | Get current subscription |
| GET | `/api/billing/plans` | authenticated | List available plans |
| POST | `/api/billing/checkout` | admin | Create Stripe checkout session |
| POST | `/api/billing/portal` | admin | Create Stripe customer portal session |
| GET | `/api/billing/usage` | authenticated | Get usage summary |
| POST | `/api/billing/webhook` | public | Stripe webhook receiver |

### Onboarding & Knowledge Base (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/onboarding/logo` | admin | Upload org logo |
| POST | `/api/onboarding/reference-docs` | admin | Upload reference document |
| GET | `/api/onboarding/reference-docs` | authenticated | List reference documents |
| DELETE | `/api/onboarding/reference-docs/:id` | admin | Delete reference document |
| POST | `/api/onboarding/rag/search` | authenticated | RAG knowledge base search |
| GET | `/api/onboarding/rag/status` | authenticated | RAG indexing status |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (DB, Redis, storage status) |

## Role-Based Access Control

Role hierarchy: **admin (3) > manager (2) > viewer (1)**. Enforced via `requireRole()` middleware in `server/auth.ts`.

| Role | Capabilities |
|------|-------------|
| **viewer** | Read-only: dashboards, reports, transcripts, call playback, team data, RAG search |
| **manager** | Everything viewer can do, plus: assign calls, edit AI analysis, manage employees, create coaching sessions, export reports, delete calls |
| **admin** | Full control: manage users, send invitations, approve access requests, bulk CSV import, prompt template CRUD, reference doc upload, API key management, billing, org settings |

## Authentication
Two user sources, checked in order:
1. **ENV users** — `AUTH_USERS` env var, format: `username:password:role:displayName:orgSlug`
2. **Database users** — created via admin UI, self-registration, or invitation acceptance

Plus optional **Google OAuth 2.0** (requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`).

Plus **API key auth** — header `X-API-Key: obs_k_...` for programmatic access. Keys are hashed (SHA-256), never stored in plaintext.

On startup, env-var orgSlugs are resolved to orgIds. If an org doesn't exist for a slug, it's auto-created (backward compatibility).

## Environment Variables
```
# ─── Required ──────────────────────────────────────────────────────────
ASSEMBLYAI_API_KEY              # Transcription service
SESSION_SECRET                  # Cookie signing (random string, persist across restarts)

# ─── Authentication ───────────────────────────────────────────────────
AUTH_USERS                      # Format: user:pass:role:name:orgSlug (comma-separated)
DEFAULT_ORG_SLUG                # Default org for users without explicit orgSlug (default: "default")

# ─── Storage Backend (pick one) ───────────────────────────────────────
STORAGE_BACKEND                 # "postgres", "s3", or "gcs" (auto-detects if unset)
DATABASE_URL                    # PostgreSQL connection string (required for postgres backend)
S3_BUCKET                       # S3 bucket name (also used for audio blobs alongside postgres)
GCS_BUCKET                      # GCS bucket name
GCS_CREDENTIALS                 # GCS service account JSON

# ─── Redis ────────────────────────────────────────────────────────────
REDIS_URL                       # Redis connection (sessions, rate limiting, job queues)
                                # Without this: in-memory fallback (single-instance only)

# ─── AI Analysis (pick one or both) ──────────────────────────────────
AI_PROVIDER                     # "bedrock" or "gemini" (auto-detects if unset)
# Bedrock (Claude):
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles/STS
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6
# Gemini:
GEMINI_API_KEY                  # Google AI Studio key
GEMINI_MODEL                    # Default: gemini-2.5-flash

# ─── Billing ─────────────────────────────────────────────────────────
STRIPE_SECRET_KEY               # Stripe API secret
STRIPE_WEBHOOK_SECRET           # Stripe webhook signing secret
STRIPE_PRICE_PRO_MONTHLY        # Price ID for Pro monthly
STRIPE_PRICE_PRO_YEARLY         # Price ID for Pro yearly
STRIPE_PRICE_ENTERPRISE_MONTHLY # Price ID for Enterprise monthly
STRIPE_PRICE_ENTERPRISE_YEARLY  # Price ID for Enterprise yearly

# ─── Google OAuth ────────────────────────────────────────────────────
GOOGLE_CLIENT_ID                # OAuth client ID
GOOGLE_CLIENT_SECRET            # OAuth client secret
GOOGLE_CALLBACK_URL             # Callback URL (default: /api/auth/google/callback)

# ─── Logging ─────────────────────────────────────────────────────────
BETTERSTACK_SOURCE_TOKEN        # Betterstack log aggregation (optional)
LOG_LEVEL                       # Pino level: debug, info, warn, error (default: info in prod)

# ─── Notifications ───────────────────────────────────────────────────
WEBHOOK_URL                     # Slack/Teams webhook for flagged call notifications
WEBHOOK_EVENTS                  # Event types to notify (default: low_score,agent_misconduct,exceptional_call)

# ─── Optional ────────────────────────────────────────────────────────
PORT                            # Server port (default: 5000)
RETENTION_DAYS                  # Default retention policy (default: 90, overridden per-org)
DISABLE_SECURE_COOKIE           # Set to skip secure cookie flag (for non-TLS dev)
```

## Database Schema (PostgreSQL)

16 tables defined in `server/db/schema.ts`:

| Table | Key Indexes | Notes |
|-------|-------------|-------|
| `organizations` | unique on `slug` | Org settings stored as JSONB |
| `users` | unique on `username`, index on `org_id` | Passwords hashed with scrypt |
| `employees` | unique on `(org_id, email)` | Per-org employee roster |
| `calls` | index on `(org_id, status)`, `uploaded_at` | Links to employee |
| `transcripts` | unique on `call_id` | Cascade delete with call |
| `sentiment_analyses` | unique on `call_id` | Cascade delete with call |
| `call_analyses` | unique on `call_id`, index on `(org_id, performance_score)` | Cascade delete |
| `access_requests` | index on `(org_id, status)` | |
| `prompt_templates` | index on `(org_id, call_category)` | Per-org evaluation criteria |
| `coaching_sessions` | index on `(org_id, status)`, `employee_id` | |
| `api_keys` | unique on `key_hash` | SHA-256 hashed, never plaintext |
| `invitations` | unique on `token` | Expirable team invitations |
| `subscriptions` | unique on `org_id` | Stripe integration |
| `reference_documents` | index on `(org_id, category)` | RAG source documents |
| `document_chunks` | index on `org_id`, `document_id` | pgvector(1024) embeddings |
| `usage_events` | index on `(org_id, event_type)`, `created_at` | Billing metering |

Requires pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

## HIPAA Compliance

| Feature | Location | Details |
|---------|----------|---------|
| **Account lockout** | `server/auth.ts` | 5 failed attempts → 15-min lockout per username |
| **Structured audit logging** | `server/services/audit-log.ts` | `[HIPAA_AUDIT]` JSON — user, org, resource type, timestamps |
| **API access audit** | `server/index.ts` | Middleware logs all API calls with user, org, method, status, duration |
| **Rate limiting** | `server/index.ts` | Login: 5/15min per IP. Redis-backed (distributed) or in-memory fallback |
| **Security headers** | `server/index.ts` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy |
| **Session timeout** | `server/auth.ts` | 15-min rolling idle timeout, httpOnly + sameSite=lax + secure (prod) |
| **HTTPS enforcement** | `server/index.ts` | HTTP → HTTPS redirect in production |
| **Per-org data retention** | `server/index.ts` + workers | Auto-purges calls per org's `retentionDays` setting (default 90) |
| **Error logging** | Throughout | Pino structured logs — never log PHI (patient names, transcripts, call content) |
| **Encryption at rest** | Infrastructure | EBS encryption (EC2), S3 SSE, PostgreSQL disk encryption |
| **Encryption in transit** | Infrastructure | Caddy auto-TLS (EC2), Render managed TLS |
| **Tenant isolation** | `server/storage/` | All storage methods require orgId — cross-org access structurally impossible |

## Key Design Decisions
- **No AWS SDK**: S3, Bedrock, and Titan Embed all use raw REST APIs with manual SigV4 signing — reduces bundle size but means signing logic must be maintained manually in `s3.ts`, `bedrock.ts`, and `embeddings.ts`
- **Hybrid storage**: PostgreSQL for structured data + S3 for audio blobs. The IStorage interface abstracts this — CloudStorage (S3/GCS JSON files) still works as an alternative backend
- **Per-org AI providers**: Each org can use Bedrock or Gemini independently via `ai-factory.ts`
- **RAG as a plan feature**: RAG is gated by plan tier (`ragEnabled` in plan limits). Free tier doesn't include it
- **Graceful degradation**: Every infrastructure dependency (Redis, PostgreSQL, S3, Bedrock, Gemini, Stripe) has a fallback or graceful failure mode. The app runs with just `ASSEMBLYAI_API_KEY` and `SESSION_SECRET` (in-memory storage, no AI analysis, no billing)
- **Custom prompt templates**: Per-org, per-call-category evaluation criteria with required phrases and scoring weights
- **Dark mode**: Toggle in settings; Recharts dark mode fixes use `!important` in `index.css` (`.dark .recharts-*`)
- **Hooks ordering**: All React hooks in `transcript-viewer.tsx` MUST be called before early returns (isLoading/!call guards)

## Deployment

### EC2 (Production HIPAA) — `deploy/ec2/`
```
Internet → Caddy (:443, auto TLS) → Node.js (:5000) → PostgreSQL + S3 + Bedrock + AssemblyAI
```
- EC2 t3.micro + Caddy for TLS + systemd for process management
- IAM instance role for S3 + Bedrock (no hardcoded AWS keys)
- Estimated ~$13/month (after free tier)
- See `deploy/ec2/README.md` for full setup guide

### Render.com (Staging / Non-PHI)
- Build: `npm run build`, Start: `npm run start`
- Env vars in Render dashboard
- No `render.yaml` — configured via dashboard

### Build Output
- Frontend: `dist/client/` (Vite)
- Backend: `dist/index.js` (esbuild)
- Workers: `dist/workers.js` (esbuild)

Server serves both API and static frontend from the same process.

## Startup Sequence (server/index.ts)
1. Initialize Redis (sessions, rate limiting, pub/sub)
2. Initialize PostgreSQL storage (if configured)
3. Initialize BullMQ job queues
4. Set up auth (load env users, resolve org IDs, create orgs if needed)
5. Register all API routes
6. Set up Vite (dev) or serve static files (prod)
7. Start HTTP server
8. Set up WebSocket
9. Schedule data retention (30s delay, then daily)
10. Register graceful shutdown handlers (close queues, Redis, DB)

## Common Gotchas
- AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` in `server/storage/types.ts` when rendering/storing AI data
- The same IAM user is shared across multiple projects — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- TanStack Query key format: `["/api/calls", callId]` — used for caching
- In-memory storage loses all data on restart — only use for dev without cloud credentials
- `AUTH_USERS` format changed from `user:pass:role:name` to `user:pass:role:name:orgSlug` — the 5th field is optional (defaults to `DEFAULT_ORG_SLUG`)
- Stripe webhook endpoint needs raw body (`express.raw()`) — configured before `express.json()` in `server/index.ts`
- pgvector extension must be installed manually: `CREATE EXTENSION IF NOT EXISTS vector;`
- Workers must run as a separate process in production (`npm run workers`). Without Redis, job processing falls back to in-process execution
- When adding new storage methods: update `IStorage` interface in `types.ts`, then implement in `memory.ts`, `cloud.ts`, and `pg-storage.ts`

## Future Plans / Roadmap
- **Knowledge Base plan tier**: Offer the RAG knowledge base as a standalone $49/mo plan tier (alongside existing Free/Pro/Enterprise). Same codebase — conditionally show/hide call analysis UI based on plan. Architecture already supports this: RAG services (`chunker.ts`, `embeddings.ts`, `rag.ts`) are fully decoupled from call analysis
- **Super-admin role**: Platform-level admin (not org-scoped) for managing all organizations — `SUPER_ADMIN_USERS` env var
- **SSO**: Enterprise plan feature, currently schema-defined but not implemented
- **PostgreSQL migration**: Move remaining S3-only deployments to PostgreSQL for better query performance and transactional integrity
