# Observatory QA — AI-Powered Call Quality Analysis Platform

## Project Overview
Observatory QA is a multi-tenant, HIPAA-compliant SaaS platform for call quality analysis. Organizations upload call recordings, which are transcribed by AssemblyAI and analyzed by AI (AWS Bedrock Claude) for performance scoring, compliance, sentiment analysis, and coaching insights. Includes a RAG knowledge base for grounding AI analysis in each organization's own documentation.

**Product origin**: Evolved from a single-tenant internal tool (CallAnalyzer for UMS) into a multi-tenant SaaS product. The multi-tenant transformation plan is documented in `MULTI_TENANT_TRANSFORMATION_PLAN.md`.

**Healthcare expansion**: The platform is expanding into clinical documentation (AI scribe) and EHR integrations, initially targeting dental practices. The roadmap is documented in `HEALTHCARE_EXPANSION_PLAN.md`.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS 3, shadcn/ui, Recharts, Wouter (routing), TanStack Query, Framer Motion
- **Backend**: Express.js + TypeScript (ESM), Node.js
- **Database**: PostgreSQL (via Drizzle ORM) — recommended for production SaaS
- **AI Analysis**: AWS Bedrock (Claude Sonnet) via `ai-factory.ts`
- **Transcription**: AssemblyAI
- **RAG**: pgvector for vector similarity search, Amazon Titan Embed V2 for embeddings, BM25 keyword boosting
- **Object Storage**: AWS S3 — for audio files and blob storage
- **Job Queues**: BullMQ (Redis-backed) — audio processing, reanalysis, retention, usage metering, document indexing
- **Sessions & Rate Limiting**: Redis (connect-redis, ioredis) — falls back to in-memory when unavailable
- **Billing**: Stripe (subscriptions, checkout, customer portal, webhooks)
- **Logging**: Pino + Betterstack (@logtail/pino) for structured log aggregation
- **Auth**: Passport.js (local strategy + Google OAuth 2.0 + SAML SSO), session-based, role-based (viewer/manager/admin), MFA (TOTP)
- **Hosting**: EC2 with Caddy (production HIPAA), Render.com (staging/non-PHI)
- **Font**: Poppins (primary), Inter (fallback) — chosen to match Observatory logo typeface

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
     - No config → **in-memory storage (data lost on restart, dev only)**
   - **AI provider**:
     - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — for Bedrock (Claude)
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
client/src/pages/            # Route pages (25 pages)
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
  owl-loading.tsx            #   Custom owl-themed loading animation (liquid fill CSS)
  onboarding-tour.tsx        #   Interactive product tour (6 steps, localStorage-persistent)

client/src/lib/              # Client utilities
  display-utils.ts           #   toDisplayString() — safe AI response value rendering
  error-reporting.ts         #   Centralized error logging (Sentry-ready)

server/
  index.ts                   # App entry: Express setup, middleware, startup sequence
  auth.ts                    # Passport.js auth, session management, org context middleware
  vite.ts                    # Vite dev server integration + static serving
  utils.ts                   # Shared server utilities
  types.d.ts                 # Express type augmentations
  logger.ts                  # (Legacy) Logger — prefer server/services/logger.ts

server/routes/               # Modular API route files (24 route files)
  index.ts                   #   Route registration orchestrator
  auth.ts                    #   Login/logout/me
  registration.ts            #   Self-service org + user registration (supports industryType)
  oauth.ts                   #   Google OAuth 2.0 flow
  sso.ts                     #   SAML 2.0 SSO (per-org IDP, Enterprise plan)
  mfa.ts                     #   MFA setup/verify/disable (TOTP)
  password-reset.ts          #   Forgot-password + reset-password flow
  onboarding.ts              #   Logo upload, reference doc upload, RAG search, branding
  calls.ts                   #   Call CRUD, upload, audio streaming, transcript/sentiment/analysis + clinical notes
  employees.ts               #   Employee CRUD, CSV import
  dashboard.ts               #   Metrics, sentiment distribution, top performers
  reports.ts                 #   Summary/filtered reports, agent profiles
  coaching.ts                #   Coaching session CRUD
  admin.ts                   #   User management, prompt templates, org settings
  access.ts                  #   Access request flow
  api-keys.ts                #   API key CRUD + middleware
  billing.ts                 #   Stripe checkout, portal, webhooks, quota enforcement
  insights.ts                #   Aggregate insights & trends
  export.ts                  #   CSV export for calls, employees, performance data
  health.ts                  #   Health check endpoint
  helpers.ts                 #   Shared route utilities
  clinical.ts                #   Clinical documentation: notes, attestation, style learning, templates
  ehr.ts                     #   EHR integration: patient lookup, appointment sync, note push
  ab-testing.ts              #   A/B model testing: upload, dual-model comparison, cost tracking
  spend-tracking.ts          #   Usage/cost visibility: per-call spend breakdown

server/services/             # Business logic & integrations
  ai-factory.ts              #   AI provider setup (Bedrock, per-org model config)
  ai-provider.ts             #   AI analysis interface, prompt building, JSON parsing, clinical note generation
  bedrock.ts                 #   AWS Bedrock Claude provider (raw REST + SigV4)
  assemblyai.ts              #   AssemblyAI transcription + transcript processing
  s3.ts                      #   S3 client (raw REST + SigV4, no AWS SDK)
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
  phi-encryption.ts          #   AES-256-GCM field-level encryption for PHI data
  email.ts                   #   Transactional email (SMTP, AWS SES, console fallback)
  error-codes.ts             #   Standardized error codes (OBS-{DOMAIN}-{NUMBER})
  coaching-engine.ts         #   Auto-recommendations and AI coaching plan generation
  clinical-templates.ts      #   Pre-built clinical note templates (10+ specialties, multiple formats)
  style-learning.ts          #   Provider style analysis — auto-detect note preferences from history

server/services/ehr/         # EHR integration adapters
  types.ts                   #   IEhrAdapter interface, EhrPatient, EhrAppointment, EhrClinicalNote, EhrTreatmentPlan
  index.ts                   #   EHR adapter factory (Open Dental, Eaglesoft)
  open-dental.ts             #   Open Dental adapter (bidirectional: patient lookup, note push, treatment plans)
  eaglesoft.ts               #   Eaglesoft/Patterson eDex adapter (read-focused: patients, appointments)

server/storage/              # Storage abstraction layer
  types.ts                   #   IStorage interface (all methods org-scoped)
  index.ts                   #   Storage backend factory (postgres > S3 > memory)
  cloud.ts                   #   CloudStorage implementation (S3 JSON files)
  memory.ts                  #   MemStorage (in-memory, dev only)

server/db/                   # PostgreSQL (Drizzle ORM)
  schema.ts                  #   Table definitions (20+ tables + pgvector document_chunks)
  index.ts                   #   Database connection initialization
  migrate.ts                 #   Migration runner
  pg-storage.ts              #   PostgresStorage implementing IStorage
  sync-schema.ts             #   Idempotent schema sync on startup (CREATE IF NOT EXISTS)

server/workers/              # BullMQ worker processes (run separately)
  index.ts                   #   Worker entry point — starts all workers
  retention.worker.ts        #   Data retention purge (per-org)
  usage.worker.ts            #   Usage event recording
  reanalysis.worker.ts       #   Bulk call re-analysis
  indexing.worker.ts         #   RAG document indexing (chunk + embed)

shared/schema.ts             # Zod schemas + TypeScript types (shared client/server)
data/dental/                 # Dental-specific reference data
  default-prompt-templates.json  # 5 dental call categories with evaluation criteria
  dental-terminology-reference.md  # CDT codes, insurance terminology, coverage tiers
deploy/ec2/                  # EC2 deployment config (Caddy, systemd, bootstrap script)
tests/                       # Unit tests (Node test runner)
```

### Frontend Pages
| Page | Route | Description |
|------|-------|-------------|
| `landing.tsx` | `/` | Public landing / marketing page |
| `auth.tsx` | `/auth` | Login + registration forms (supports industry type selection) |
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
| `clinical-dashboard.tsx` | `/clinical` | Clinical documentation dashboard (metrics, attestation rates, trends) |
| `clinical-notes.tsx` | `/clinical/notes/:callId` | View/edit clinical notes, attestation workflow, consent |
| `clinical-templates.tsx` | `/clinical/templates` | Browse pre-built clinical note templates by specialty/format |
| `clinical-upload.tsx` | `/clinical/upload` | Upload clinical encounter audio for note generation |
| `ab-testing.tsx` | `/ab-testing` | A/B model comparison (upload audio, dual-model analysis, cost tracking) |
| `spend-tracking.tsx` | `/spend-tracking` | Usage & cost visibility (per-call spend breakdown) |

### Multi-Tenant Data Model
Every data entity has an `orgId` field. All storage methods take `orgId` as the first parameter. Data isolation is enforced at the storage layer — no method can access data without specifying the org.

**Schemas in `shared/schema.ts`**:
- `Organization` — id, name, slug, status, industryType, settings (departments, subTeams, branding, AI config, quotas, ehrConfig, providerStylePreferences)
- `User` — id, orgId, username, passwordHash, name, role
- `Employee` — id, orgId, name, email, role, initials, status, subTeam
- `Call` — id, orgId, employeeId, fileName, status, duration, callCategory, tags
- `Transcript` — id, orgId, callId, text, confidence, words[]
- `SentimentAnalysis` — id, orgId, callId, overallSentiment, overallScore, segments[]
- `CallAnalysis` — id, orgId, callId, performanceScore, subScores, summary, topics, feedback, flags, clinicalNote (optional)
- `ClinicalNote` — embedded in CallAnalysis: format (SOAP/DAP/BIRP/HPI/procedure), specialty, subjective, objective, assessment, plan, HPI, ROS, differentialDiagnoses, icd10Codes, cptCodes, cdtCodes, toothNumbers, periodontalFindings, treatmentPhases, providerAttested, attestedBy, editHistory, consentObtained, documentationCompleteness (0-10), clinicalAccuracy (0-10)
- `ABTest` — id, orgId, fileName, baselineModel, testModel, transcriptText, baselineAnalysis, testAnalysis, baselineLatencyMs, testLatencyMs, status, createdBy
- `UsageRecord` — id, orgId, callId, type (transcription/ai_analysis/ab-test), services (assemblyai/bedrock cost breakdown), totalEstimatedCost
- `AccessRequest` — id, orgId, name, email, requestedRole, status
- `CoachingSession` — id, orgId, employeeId, callId, category, title, notes, actionPlan, status
- `PromptTemplate` — id, orgId, callCategory, evaluationCriteria, requiredPhrases, scoringWeights
- `Invitation` — id, orgId, email, role, token, status, expiresAt
- `ApiKey` — id, orgId, name, keyHash, keyPrefix, permissions, status
- `Subscription` — id, orgId, planTier, status, stripeCustomerId, billingInterval
- `ReferenceDocument` — id, orgId, name, category, fileName, extractedText, appliesTo, isActive

**Industry types** (set at registration): `general`, `dental`, `medical`, `behavioral_health`, `veterinary`

**Plan tiers** (defined statically in `shared/schema.ts`):
| Plan | Price | Calls/mo | Storage | RAG | Custom Templates | Clinical Docs | SSO |
|------|-------|----------|---------|-----|-----------------|---------------|-----|
| Free | $0 | 50 | 500 MB | No | No | No | No |
| Clinical Documentation | $49/mo | 200 | 2 GB | Yes | No | Yes | No |
| Pro | $99/mo | 1,000 | 10 GB | Yes | Yes | No | No |
| Enterprise | $499/mo | Unlimited | 100 GB | Yes | Yes | Yes | Yes |

### Audio Processing Pipeline (server/routes/calls.ts)
1. Upload audio file (multer)
2. Archive to S3 (non-blocking — continues with warning on failure)
3. Send to AssemblyAI for transcription (polling until complete)
4. Load org's custom prompt template by call category (falls back to default)
5. If RAG enabled: retrieve relevant document chunks from pgvector, inject into AI prompt
6. Send transcript + context to AI provider (Bedrock) for analysis
7. Normalize results: confidence scores, agent name detection, flag setting
8. If clinical documentation plan: generate clinical note (SOAP/DAP/BIRP/procedure) with PHI encryption
9. Store transcript, sentiment, and analysis (+ clinical note if applicable)
10. Auto-assign call to employee if agent name detected
11. Track usage with cost estimates (transcription + AI analysis events)
12. Send webhook notification if call flagged
13. WebSocket notification to org clients

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
3. No config → **MemStorage** (in-memory, data lost on restart)

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
Uses AWS Bedrock (Claude) for AI analysis. Per-org `bedrockModel` can be configured via org's `OrgSettings`. The provider implements the `AIAnalysisProvider` interface defined in `ai-provider.ts`. Per-org providers are cached to avoid re-creation on every call.

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

### SSO (Enterprise, per-org SAML 2.0)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/sso/check/:orgSlug` | Pre-flight: check if SSO is available for org |
| GET | `/api/auth/sso/:orgSlug` | Initiate SAML login redirect |
| POST | `/api/auth/sso/callback` | SAML Assertion Consumer Service (ACS) |
| GET | `/api/auth/sso/metadata/:orgSlug` | SP metadata for IDP configuration |

### MFA (authenticated)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/mfa/setup` | Generate TOTP secret + QR code |
| POST | `/api/auth/mfa/enable` | Verify code and enable MFA |
| POST | `/api/auth/mfa/verify` | Verify MFA code during login |
| POST | `/api/auth/mfa/disable` | Disable MFA for current user |

### Password Reset (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |

### Data Export (authenticated)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/calls` | Export calls as CSV |
| GET | `/api/export/employees` | Export employees as CSV |
| GET | `/api/export/performance` | Export performance data as CSV |

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

### Clinical Documentation (org-scoped, requires Clinical Documentation plan)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/clinical/notes/:callId` | authenticated | Get clinical note (PHI decrypted) |
| POST | `/api/clinical/notes/:callId/attest` | manager+ | Provider attestation of note |
| POST | `/api/clinical/notes/:callId/consent` | authenticated | Record patient consent for recording |
| PATCH | `/api/clinical/notes/:callId` | authenticated | Edit note fields (requires re-attestation) |
| GET | `/api/clinical/provider-preferences` | authenticated | Get provider style preferences |
| PATCH | `/api/clinical/provider-preferences` | authenticated | Update note formatting preferences |
| GET | `/api/clinical/metrics` | authenticated | Clinical dashboard metrics (completeness, accuracy, attestation rates) |
| POST | `/api/clinical/style-learning/analyze` | authenticated | AI analysis of provider's note style from history |
| POST | `/api/clinical/style-learning/apply` | authenticated | Apply learned style preferences |
| GET | `/api/clinical/templates` | authenticated | List clinical note templates (filter by specialty/format) |
| GET | `/api/clinical/templates/:id` | authenticated | Get specific template |

### EHR Integration (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/ehr/systems` | authenticated | List supported EHR systems |
| GET | `/api/ehr/config` | authenticated | Get org's EHR configuration |
| PUT | `/api/ehr/config` | admin | Configure EHR connection |
| POST | `/api/ehr/test-connection` | admin | Validate EHR credentials |
| GET | `/api/ehr/patients` | authenticated | Search patients (name, DOB, phone) |
| GET | `/api/ehr/patients/:ehrPatientId` | authenticated | Get patient demographics, insurance, allergies |
| GET | `/api/ehr/appointments/today` | authenticated | Today's appointments |
| GET | `/api/ehr/appointments` | authenticated | Appointments for date range |
| POST | `/api/ehr/push-note/:callId` | manager+ | Push attested clinical note to EHR |
| GET | `/api/ehr/patients/:ehrPatientId/treatment-plans` | authenticated | Patient treatment plans (dental) |
| DELETE | `/api/ehr/config` | admin | Disable EHR integration |

### A/B Model Testing (org-scoped, admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ab-tests` | List all A/B tests |
| GET | `/api/ab-tests/:id` | Get test with results |
| POST | `/api/ab-tests/upload` | Upload audio for dual-model comparison |
| DELETE | `/api/ab-tests/:id` | Delete test |

### Usage & Spend Tracking (org-scoped, admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/usage` | Get all usage/cost records |

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

Plus **SAML 2.0 SSO** (Enterprise plan) — per-org IDP configuration stored in org settings (`ssoProvider`, `ssoSignOnUrl`, `ssoCertificate`). Uses `@node-saml/passport-saml` with MultiSamlStrategy. Pre-flight validation endpoint prevents redirect errors for invalid org slugs.

Plus **MFA** (TOTP) — opt-in per user, can be required per org (`mfaRequired` in org settings). Uses TOTP with backup codes.

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
STORAGE_BACKEND                 # "postgres" or "s3" (auto-detects if unset)
DATABASE_URL                    # PostgreSQL connection string (required for postgres backend)
S3_BUCKET                       # S3 bucket name (also used for audio blobs alongside postgres)

# ─── Redis ────────────────────────────────────────────────────────────
REDIS_URL                       # Redis connection (sessions, rate limiting, job queues)
                                # Without this: in-memory fallback (single-instance only)

# ─── AI Analysis (AWS Bedrock) ───────────────────────────────────────
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles/STS
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6

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

# ─── Email (SMTP) ────────────────────────────────────────────────────
SMTP_HOST                       # Email server hostname
SMTP_PORT                       # Email server port (default: 587)
SMTP_USER                       # Email authentication username
SMTP_PASS                       # Email authentication password
SMTP_FROM                       # Sender email address

# ─── PHI Encryption ─────────────────────────────────────────────────
PHI_ENCRYPTION_KEY              # 64-char hex for AES-256-GCM field-level encryption

# ─── Optional ────────────────────────────────────────────────────────
PORT                            # Server port (default: 5000)
RETENTION_DAYS                  # Default retention policy (default: 90, overridden per-org)
DISABLE_SECURE_COOKIE           # Set to skip secure cookie flag (for non-TLS dev)
```

## Database Schema (PostgreSQL)

20+ tables defined in `server/db/schema.ts`, auto-synced on startup by `server/db/sync-schema.ts`:

| Table | Key Indexes | Notes |
|-------|-------------|-------|
| `organizations` | unique on `slug` | Org settings stored as JSONB (includes SSO config, MFA policy) |
| `users` | unique on `username`, index on `org_id` | Passwords hashed with scrypt. MFA fields: `mfa_enabled`, `mfa_secret`, `mfa_backup_codes` |
| `employees` | unique on `(org_id, email)` | Per-org employee roster |
| `calls` | index on `(org_id, status)`, `uploaded_at` | Links to employee. `file_hash` for dedup, `call_category`, `tags` (JSONB) |
| `transcripts` | unique on `call_id` | Cascade delete with call |
| `sentiment_analyses` | unique on `call_id` | Cascade delete with call |
| `call_analyses` | unique on `call_id`, index on `(org_id, performance_score)` | Cascade delete. `confidence_factors` (JSONB incl. `aiAnalysisCompleted`), `sub_scores`, `detected_agent_name`, `manual_edits` |
| `access_requests` | index on `(org_id, status)` | |
| `prompt_templates` | index on `(org_id, call_category)` | Per-org evaluation criteria |
| `coaching_sessions` | index on `(org_id, status)`, `employee_id` | |
| `coaching_recommendations` | index on `org_id` | Auto-generated coaching recommendations |
| `api_keys` | unique on `key_hash` | SHA-256 hashed, never plaintext |
| `invitations` | unique on `token` | Expirable team invitations |
| `subscriptions` | unique on `org_id` | Stripe integration |
| `reference_documents` | index on `(org_id, category)` | RAG source documents |
| `document_chunks` | index on `org_id`, `document_id` | pgvector(1024) embeddings |
| `usage_events` | index on `(org_id, event_type)`, `created_at` | Billing metering |
| `password_reset_tokens` | unique on `token` | Expirable reset tokens |
| `audit_logs` | index on `(org_id, event_type)`, `created_at` | Tamper-evident with `integrity_hash`, `prev_hash`, `sequence_num` |
| `ab_tests` | index on `org_id` | Dual-model comparison results, latency, cost |
| `usage_records` | index on `(org_id, type)`, `timestamp` | Per-call cost tracking (AssemblyAI + Bedrock spend) |

Requires pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

### Auto Schema Sync (server/db/sync-schema.ts)
On startup, `syncSchema(db)` runs idempotent SQL to create all tables and add missing columns using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This eliminates the need for `drizzle-kit push` (a devDependency) in production and prevents cascading 500 errors from missing tables/columns after deploys.

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
| **MFA** | `server/routes/mfa.ts` | TOTP-based MFA, per-org mandatory option (`mfaRequired` in org settings) |
| **PHI encryption** | `server/services/phi-encryption.ts` | AES-256-GCM application-level encryption for sensitive fields |
| **Tamper-evident audit** | `server/db/sync-schema.ts` | `audit_logs` table with integrity hashes and sequence numbers |

## Key Design Decisions
- **No AWS SDK**: S3, Bedrock, and Titan Embed all use raw REST APIs with manual SigV4 signing — reduces bundle size but means signing logic must be maintained manually in `s3.ts`, `bedrock.ts`, and `embeddings.ts`
- **Hybrid storage**: PostgreSQL for structured data + S3 for audio blobs. The IStorage interface abstracts this — CloudStorage (S3 JSON files) still works as an alternative backend
- **RAG as a plan feature**: RAG is gated by plan tier (`ragEnabled` in plan limits). Free tier doesn't include it
- **Graceful degradation**: Every infrastructure dependency (Redis, PostgreSQL, S3, Bedrock, Stripe) has a fallback or graceful failure mode. The app runs with just `ASSEMBLYAI_API_KEY` and `SESSION_SECRET` (in-memory storage, no AI analysis, no billing). When Bedrock fails, calls complete with default scores and the UI shows clear feedback
- **Auto schema sync**: `server/db/sync-schema.ts` runs idempotent DDL on startup, eliminating the need for migration tooling in production
- **Custom prompt templates**: Per-org, per-call-category evaluation criteria with required phrases and scoring weights
- **Dark mode**: Toggle in settings; Recharts dark mode fixes use `!important` in `index.css` (`.dark .recharts-*`)
- **Hooks ordering**: All React hooks in `transcript-viewer.tsx` MUST be called before early returns (isLoading/!call guards)
- **Clinical notes as embedded data**: Clinical notes are stored as a JSONB field within `call_analyses`, not a separate table — simplifies the data model and keeps notes tightly coupled with analysis
- **EHR adapter pattern**: `server/services/ehr/` uses an adapter interface (`IEhrAdapter`) so new EHR systems can be added without touching route logic. Per-org EHR config is stored in org settings
- **Style learning recency weighting**: Provider style analysis uses exponential decay (30-day half-life) to prefer recent notes, requires minimum 3 attested notes
- **A/B testing cost tracking**: Each A/B test records estimated costs for both models, enabling data-driven model selection decisions
- **Industry-aware registration**: Orgs set `industryType` at registration (general/dental/medical/behavioral_health/veterinary) which influences default prompt templates and available features

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
- URL: `https://observatory-qa-product.onrender.com`
- Uses Neon PostgreSQL (external), Render Redis
- **Required env vars**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`, `DATABASE_URL`, `STORAGE_BACKEND=postgres`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` (for audio storage), `REDIS_URL`
- **Port**: Render expects port 10000 — set `PORT=10000`

### Build Output
- Frontend: `dist/client/` (Vite)
- Backend: `dist/index.js` (esbuild)
- Workers: `dist/workers.js` (esbuild)

Server serves both API and static frontend from the same process.

## Startup Sequence (server/index.ts)
1. Initialize Redis (sessions, rate limiting, pub/sub)
2. Initialize PostgreSQL storage (if configured) — runs `syncSchema(db)` to auto-create/update tables
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
- **AI analysis failure is graceful**: When Bedrock is unavailable (bad credentials, region, permissions), calls still complete with default scores (5.0, neutral sentiment). The `confidenceFactors.aiAnalysisCompleted` flag tracks this. The UI shows an amber banner and hides fake scores when this happens
- **`AI_PROVIDER` env var is NOT used** — the code always uses Bedrock exclusively. Don't be confused by legacy comments referencing multiple providers
- **AWS Bedrock 403 errors**: Usually means invalid credentials, missing `bedrock:InvokeModel` IAM permission, or model not enabled in the target region. Remove `AWS_SESSION_TOKEN` unless using temporary STS credentials
- The same IAM user is shared across multiple projects — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- TanStack Query key format: `["/api/calls", callId]` — used for caching
- In-memory storage loses all data on restart — only use for dev without cloud credentials
- `AUTH_USERS` format changed from `user:pass:role:name` to `user:pass:role:name:orgSlug` — the 5th field is optional (defaults to `DEFAULT_ORG_SLUG`)
- Stripe webhook endpoint needs raw body (`express.raw()`) — configured before `express.json()` in `server/index.ts`
- pgvector extension must be installed manually: `CREATE EXTENSION IF NOT EXISTS vector;`
- Workers must run as a separate process in production (`npm run workers`). Without Redis, job processing falls back to in-process execution
- When adding new storage methods: update `IStorage` interface in `types.ts`, then implement in `memory.ts`, `cloud.ts`, and `pg-storage.ts`
- **Schema sync on startup**: `sync-schema.ts` auto-creates tables/columns, so `drizzle-kit push` is not needed in production. Schema changes should be added to both `schema.ts` (for Drizzle) and `sync-schema.ts` (for runtime sync)
- **SSO pre-flight validation**: Always use `/api/auth/sso/check/:orgSlug` before redirecting to `/api/auth/sso/:orgSlug` — prevents users seeing raw JSON error pages for invalid org slugs
- **Font**: App uses Poppins (loaded via Google Fonts in `index.css`), chosen to match the Observatory logo typeface. Defined in `--font-sans` CSS variable
- **Landing page wave animation**: Uses SVG SMIL `<animate>` elements on `<linearGradient>` stops for a traveling spark effect. CSS only handles `wave-drift` for gentle positional movement
- **Clinical note PHI encryption**: PHI fields (subjective, objective, assessment, HPI) are encrypted with AES-256-GCM before storage and decrypted on retrieval in clinical routes
- **EHR adapters**: Open Dental uses developer key + customer key auth; Eaglesoft uses eDex API with X-API-Key header. Config stored in `org.settings.ehrConfig`
- **Clinical templates are in-memory**: `clinical-templates.ts` is a static library of pre-built templates, not database-stored. Templates cover 10+ specialties across SOAP, DAP, BIRP, and procedure note formats
- **A/B tests run models in parallel**: Uses `Promise.allSettled()` so one model failure doesn't block the other
- When adding new storage methods for A/B tests or usage records: update `IStorage` interface in `types.ts`, then implement in `memory.ts`, `cloud.ts`, and `pg-storage.ts`

## Future Plans / Roadmap
See `HEALTHCARE_EXPANSION_PLAN.md` for the full 4-phase healthcare expansion roadmap.

- **Phase 1 (done)**: Dental practice QA — dental call categories, prompt templates, CDT code reference, clinical note generation
- **Phase 2 (in progress)**: Clinical documentation add-on — AI scribe, style learning, multi-format notes (SOAP/DAP/BIRP), provider attestation workflow
- **Phase 3 (planned)**: EHR integration — Open Dental (bidirectional), Eaglesoft (read-focused), Dentrix (future). Routes and adapters are scaffolded
- **Phase 4 (planned)**: Expand verticals — urgent care, behavioral health, dermatology, ophthalmology, veterinary
- **QA + Docs bundle pricing**: $129/mo combined (vs $99 QA-only + $49 Docs-only separately)
- **Super-admin role**: Platform-level admin (not org-scoped) for managing all organizations — `SUPER_ADMIN_USERS` env var
- **PostgreSQL migration**: Move remaining S3-only deployments to PostgreSQL for better query performance and transactional integrity
- **Spanish language support**: Multilingual clinical note generation
