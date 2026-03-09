# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant **multi-tenant** call analysis platform (rebranded "Observatory"). Organizations upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights. Each organization has isolated data, configurable settings, and separate user pools.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **Database**: PostgreSQL via Drizzle ORM (primary), with S3/GCS for audio blob storage
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription
- **Storage**: PostgreSQL for structured data + AWS S3 for audio files
- **Auth**: Session-based with bcrypt, role-based (viewer/manager/admin), org-scoped
- **Hosting**: Render.com

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   - **Required**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`
   - **Database**: `DATABASE_URL` + `STORAGE_BACKEND=postgres` for PostgreSQL
   - **Auth users**: `AUTH_USERS` — format: `username:password:role:displayName:orgSlug` (comma-separated for multiple)
   - **AWS (for Bedrock + S3)**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
   - **Audio Storage**: `S3_BUCKET` (used alongside PostgreSQL for audio blobs)
   - Without `DATABASE_URL`, falls back to S3-only or **in-memory storage (data lost on restart)**

3. Start the dev server:
   ```bash
   npm run dev   # Starts on port 5000 (or $PORT) with Vite HMR + tsx watch
   ```

## Commands
```bash
npm run dev          # Dev server (tsx watch)
npm run build        # Vite frontend + esbuild backend → dist/
npm run start        # Production server (NODE_ENV=production node dist/index.js)
npm run check        # TypeScript type check
npm run test         # Run tests (tsx --test tests/*.test.ts)
npx vite build       # Frontend-only build (useful for quick verification)
npm run db:generate  # Generate Drizzle migration SQL from schema
npm run db:push      # Push schema directly to database (dev only)
npm run db:studio    # Open Drizzle Studio GUI
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx`
- **Location**: `tests/` directory
  - `tests/schema.test.ts` — Zod schema validation for data integrity
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)

## Architecture

### Key Directories
```
client/src/pages/        # Route pages (dashboard, transcripts, employees, etc.)
client/src/components/   # UI components (ui/ = shadcn, tables/, transcripts/, dashboard/)
client/src/hooks/        # Custom hooks (use-org-settings, use-toast, use-websocket, etc.)
server/services/         # AI providers, S3/GCS clients, AssemblyAI, WebSocket
server/routes.ts         # All API routes + audio processing pipeline
server/storage.ts        # Storage abstraction (memory, S3/GCS, PostgreSQL backends)
server/auth.ts           # Authentication middleware + session management + org context
server/db/schema.ts      # Drizzle ORM table definitions (PostgreSQL)
server/db/index.ts       # Database connection pool
server/db/pg-storage.ts  # PostgreSQL IStorage implementation
shared/schema.ts         # Zod schemas + TypeScript types shared between client/server
drizzle/                 # Generated SQL migration files
tests/                   # Unit tests (Node test runner)
```

### Multi-Tenant Architecture

**All data is org-scoped.** Every table has an `org_id` foreign key to `organizations`. The `injectOrgContext` middleware (in `server/auth.ts`) sets `req.orgId` from the authenticated user's session.

#### Organization Settings (JSONB in `organizations.settings`)
Per-org configuration stored as `orgSettingsSchema`:
- `branding.appName` — Custom app name (default: "Observatory")
- `branding.logoUrl` — Custom logo
- `departments` — Department list
- `subTeams` — `Record<department, subTeamNames[]>` (overrides `DEFAULT_SUBTEAMS`)
- `callPartyTypes` — Custom call party type list (overrides `DEFAULT_CALL_PARTY_TYPES`)
- `callCategories` — Custom call categories
- `retentionDays` — Data retention period (default: 90)
- `aiProvider` — AI provider selection ("bedrock" | "gemini")
- `bedrockModel` — Per-org model override
- `maxCallsPerDay`, `maxStorageMb` — Usage quotas

#### Frontend Org-Awareness
- **`useOrgSettings()` hook** (`client/src/hooks/use-org-settings.ts`) — Fetches `/api/organization` and exposes org settings with defaults
- **Sidebar branding** — Uses `appName` from org settings (dynamic)
- **Employees page** — Sub-teams merge org settings with `DEFAULT_SUBTEAMS`
- **Reports page** — Call party types come from org settings or `DEFAULT_CALL_PARTY_TYPES`
- **Auth page** — Still uses hardcoded "Observatory" (no org context pre-login)

### Audio Processing Pipeline (server/routes.ts → processAudioFile)
1. Upload audio to S3 (archive failure is non-blocking — continues with warning)
2. Send to AssemblyAI for transcription (with polling; throws if polling fails/incomplete)
3. Load custom prompt template by call category (falls back to default if template fails)
4. Send transcript to Bedrock for AI analysis (falls back to transcript-based defaults if Bedrock fails)
5. Process results: normalize data, compute confidence scores, detect agent name, set flags
6. Store transcript, sentiment, and analysis to PostgreSQL (or S3 fallback)
7. Auto-assign call to employee if agent name detected

**On failure**: Call status set to "failed", WebSocket notifies client (org-scoped broadcast), uploaded file cleaned up. Error messages are logged without full stack traces (HIPAA — avoids logging PHI). No automatic retry — users re-upload manually.

### AI Analysis Data Flow
- Bedrock returns JSON with: summary, topics[], sentiment, performance_score, sub_scores, action_items[], feedback{strengths[], suggestions[]}, flags[], detected_agent_name
- `ai-provider.ts` builds the prompt (with custom template support) and parses JSON response
- `assemblyai.ts:processTranscriptData()` normalizes AI output into storage format
- **Important**: AI may return objects instead of strings in arrays — server normalizes with `normalizeStringArray()`, frontend has `toDisplayString()` safety

### Storage Backend Selection (server/storage.ts)
- `STORAGE_BACKEND=postgres` + `DATABASE_URL` → **PostgresStorage** (recommended for production)
- `STORAGE_BACKEND=s3` or `S3_BUCKET` env var → CloudStorage (S3)
- `STORAGE_BACKEND=gcs` or GCS creds → CloudStorage (GCS)
- Otherwise → **in-memory (non-persistent — data is lost on restart)**

### Database Schema (server/db/schema.ts)
11 PostgreSQL tables, all org-scoped:
| Table | Description |
|-------|-------------|
| `organizations` | Tenant orgs with JSONB settings |
| `users` | Auth users linked to orgs |
| `employees` | Agents/employees being evaluated |
| `calls` | Uploaded call recordings |
| `transcripts` | AssemblyAI transcription results |
| `sentiment_analyses` | Sentiment analysis per call |
| `call_analyses` | AI performance analysis per call |
| `access_requests` | Pending user access requests |
| `prompt_templates` | Per-category AI prompt templates |
| `coaching_sessions` | Manager coaching sessions |
| `usage_events` | Per-org metering for billing |

**Drizzle migrations**: `drizzle/0000_robust_madame_masque.sql` (initial migration, all 11 tables)

## API Routes Overview

### Authentication (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (rate limited: 5 attempts/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user (includes orgId, orgSlug) |

### Organization (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/organization` | authenticated | Get current org details + settings |
| PATCH | `/api/organization/settings` | admin | Update org settings (merges) |

### Platform Admin (cross-org)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/organizations` | admin | List all organizations |
| GET | `/api/admin/organizations/:orgId` | admin | Get specific organization |
| POST | `/api/admin/organizations` | admin | Create new organization |
| PATCH | `/api/admin/organizations/:orgId` | admin | Update organization |

### Access Requests
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/access-requests` | public | Submit access request |
| GET | `/api/access-requests` | admin | List all requests |
| PATCH | `/api/access-requests/:id` | admin | Approve/deny request |

### Calls
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

### Employees
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | authenticated | List all employees |
| POST | `/api/employees` | manager+ | Create employee |
| PATCH | `/api/employees/:id` | manager+ | Update employee |
| POST | `/api/employees/import-csv` | admin | Bulk import from CSV |

### Dashboard & Reports
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/metrics` | authenticated | Call metrics & performance |
| GET | `/api/dashboard/sentiment` | authenticated | Sentiment summaries |
| GET | `/api/dashboard/performers` | authenticated | Top performers |
| GET | `/api/search` | authenticated | Full-text search |
| GET | `/api/performance` | authenticated | Performance metrics |
| GET | `/api/reports/summary` | authenticated | Summary report |
| GET | `/api/reports/filtered` | authenticated | Filtered reports (date range) |
| GET | `/api/reports/agent-profile/:id` | authenticated | Detailed agent profile |
| POST | `/api/reports/agent-summary/:id` | authenticated | Generate agent summary |

### Coaching & Admin
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/coaching` | manager+ | List coaching sessions |
| GET | `/api/coaching/employee/:id` | authenticated | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| GET | `/api/insights` | authenticated | Aggregate insights & trends |

## Role-Based Access Control

Role hierarchy: **admin (3) > manager (2) > viewer (1)**. Enforced via `requireRole()` middleware in `server/auth.ts`.

| Role | Capabilities |
|------|-------------|
| **viewer** | Read-only: dashboards, reports, transcripts, call playback, team data |
| **manager** | Everything viewer can do, plus: assign calls, edit AI analysis, manage employees, create coaching sessions, export reports, delete calls |
| **admin** | Full control: manage users, approve/deny access requests, bulk CSV import, prompt template CRUD, org settings, platform admin (org CRUD) |

Access requests can request "viewer" or "manager" roles (not admin).

## Environment Variables
```
# Required
ASSEMBLYAI_API_KEY              # Transcription service
SESSION_SECRET                  # Cookie signing

# Authentication
AUTH_USERS                      # Format: user:pass:role:name:orgSlug (comma-separated)
DEFAULT_ORG_SLUG                # Default org slug for users without explicit orgSlug

# Database (PostgreSQL — recommended for production)
DATABASE_URL                    # PostgreSQL connection string
STORAGE_BACKEND                 # "postgres", "s3", "gcs", or omit for in-memory

# AWS (for Bedrock AI + S3 audio storage)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles

# Storage (audio blobs — used alongside PostgreSQL)
S3_BUCKET                       # Default: ums-call-archive
# OR for GCS:
GCS_BUCKET
GCS_CREDENTIALS

# AI Model
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6 (see server/services/bedrock.ts)

# Optional
PORT                            # Default: 5000
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
REDIS_URL                       # For distributed sessions, rate limiting, job queues
BETTERSTACK_SOURCE_TOKEN        # Structured logging to Better Stack
```

## HIPAA Compliance

| Feature | Location | Details |
|---------|----------|---------|
| **Account lockout** | `server/auth.ts` | 5 failed login attempts → 15-min lockout per IP/username |
| **Audit logging** | `server/services/audit-log.ts` | Structured JSON logs (`[HIPAA_AUDIT]`) for all PHI access — user identity, resource type, timestamps |
| **API access audit** | `server/index.ts` | Middleware logs all API calls with user, method, status, duration |
| **Rate limiting** | `server/index.ts` | Login: 5/15min per IP. Generic limiter on sensitive paths |
| **CSP headers** | `server/index.ts` | Content-Security-Policy restricts to same-origin + trusted CDNs |
| **Security headers** | `server/index.ts` | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, Referrer-Policy, Permissions-Policy |
| **Session timeout** | `server/auth.ts` | 15-min idle timeout (rolling) + 8-hour absolute max |
| **Secure cookies** | `server/auth.ts` | httpOnly, sameSite=lax, secure in production |
| **HTTPS enforcement** | `server/index.ts` | HTTP → HTTPS redirect in production |
| **Data retention** | `server/index.ts` | Auto-purges calls older than `RETENTION_DAYS` (default 90) |
| **Error logging** | `server/routes.ts` | Logs error messages only, never full stacks (avoids PHI leakage) |
| **Org isolation** | `server/storage.ts` | All queries scoped by org_id — no cross-tenant data leakage |

## Key Design Decisions
- **No AWS SDK**: Both S3 and Bedrock use raw REST APIs with manual SigV4 signing — reduces bundle size and avoids SDK dependency overhead, but means signing logic must be maintained manually
- **Custom prompt templates**: Per-call-category evaluation criteria, required phrases, scoring weights
- **Dark mode**: Toggle in settings; chart text fixed via global CSS in index.css (.dark .recharts-*)
- **Hooks ordering**: All React hooks in transcript-viewer.tsx MUST be called before early returns (isLoading/!call guards)
- **Multi-tenant org isolation**: All IStorage methods take orgId as first parameter; all DB tables have org_id FK; WebSocket broadcasts are org-scoped
- **Org settings as JSONB**: Flexible per-org configuration without schema migrations for new settings fields

## Deployment (Render.com)
No `render.yaml` in repo — deployment is configured via the Render dashboard.

- **Build command**: `npm run build` (Vite frontend → `dist/client/`, esbuild backend → `dist/index.js`)
- **Start command**: `npm run start` (`NODE_ENV=production node dist/index.js`)
- **Environment variables**: Configured in Render dashboard
- **Database**: PostgreSQL add-on or external (set `DATABASE_URL`)
- Server serves both API and static frontend assets from the same process

## Multi-Tenant Implementation Status

### Completed
- **Schema Foundation**: All Drizzle tables have `org_id` FK; all Zod schemas include `orgId`
- **Storage Layer**: `IStorage` interface fully org-scoped; `PostgresStorage`, `CloudStorage`, `MemStorage` all implement org isolation
- **Auth & Middleware**: `injectOrgContext` middleware; AUTH_USERS format supports `orgSlug`; session includes `orgId` + `orgSlug`
- **API Routes**: All routes pass `req.orgId` from middleware; audio pipeline org-scoped
- **WebSocket**: Org-scoped broadcast (only notifies users in same org)
- **HIPAA Compliance**: Audit log includes orgId; all access is org-scoped
- **Drizzle Migration**: Initial migration `drizzle/0000_robust_madame_masque.sql` generated (11 tables)
- **Frontend Org Settings Hook**: `useOrgSettings()` hook created
- **Sidebar Dynamic Branding**: Uses `appName` from org settings
- **Reports Dynamic Call Party Types**: Uses org settings or `DEFAULT_CALL_PARTY_TYPES`
- **Employees Dynamic Sub-Teams**: Merges org settings with `DEFAULT_SUBTEAMS`
- **Platform Admin Routes**: CRUD endpoints at `/api/admin/organizations`

### Remaining Work
- **Auth page branding**: Still hardcoded "Observatory" (needs public org-lookup endpoint for pre-login branding)
- **Org Settings Admin UI**: No frontend page for admins to configure org settings (branding, departments, call party types, quotas)
- **Platform Admin UI**: No frontend page for platform-level org management (list/create/edit orgs)
- **Usage quotas enforcement**: `maxCallsPerDay`, `maxStorageMb` fields exist but not enforced in upload pipeline
- **Billing/metering**: `usage_events` table exists but no billing integration
- **Per-org AI provider selection**: `aiProvider` and `bedrockModel` settings exist but `getOrgAIProvider()` may need testing
- **Org onboarding flow**: No self-service org creation; orgs are created via API or AUTH_USERS auto-provisioning

## Common Gotchas
- Bedrock AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` on server when rendering/storing AI data
- The same IAM user is shared across 3 projects (CallAnalyzer, RAG Tool, PMD Questionnaire) — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- The `useQuery` key format is `["/api/calls", callId]` — TanStack Query uses the key for caching
- In-memory storage backend loses all data on restart — only use for local development without cloud credentials
- `.env.example` may be outdated (e.g., shows haiku model but code defaults to sonnet) — always check `server/services/bedrock.ts` for the actual default
- `useOrgSettings()` caches for 5 minutes — org settings changes may take up to 5 min to reflect on frontend
- All IStorage methods are org-scoped — never call storage methods without passing orgId
- `DEFAULT_SUBTEAMS` and `DEFAULT_CALL_PARTY_TYPES` in `shared/schema.ts` are fallbacks; org settings override them
