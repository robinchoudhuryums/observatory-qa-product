# Observatory QA

AI-powered call quality analysis for healthcare and compliance-driven organizations. Upload call recordings, get instant transcription, performance scoring, sentiment analysis, coaching insights, and compliance monitoring — all HIPAA-compliant.

## What It Does

1. **Upload** a call recording (audio file)
2. **Transcribe** automatically via AssemblyAI
3. **Analyze** with AI (AWS Bedrock Claude or Google Gemini) — performance score, compliance flags, sentiment, coaching suggestions
4. **Ground** analysis in your organization's own documentation via RAG knowledge base
5. **Track** agent performance, coaching progress, and team trends over time

## Key Features

- **Multi-tenant SaaS** — self-service registration, per-org data isolation, team invitations
- **AI-powered analysis** — performance scoring (0-10 with sub-scores), compliance checks, sentiment tracking, action items, coaching suggestions
- **RAG knowledge base** — upload company docs (handbooks, scripts, SOPs), AI references them during analysis
- **Custom evaluation templates** — per-call-category scoring criteria, required phrases, weighted scoring
- **Coaching system** — create coaching sessions from call analysis, track action plans
- **Role-based access** — viewer / manager / admin with hierarchical permissions
- **Billing** — Stripe integration with Free / Pro ($99/mo) / Enterprise ($499/mo) tiers
- **HIPAA compliant** — session timeouts, audit logging, encryption, rate limiting, data retention
- **Real-time updates** — WebSocket notifications for call processing status
- **Dark mode** — full dark theme support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter, TanStack Query |
| Backend | Express.js, TypeScript (ESM), Node.js |
| Database | PostgreSQL + Drizzle ORM (recommended) or S3/GCS JSON files |
| AI | AWS Bedrock (Claude) or Google Gemini — configurable per-org |
| Transcription | AssemblyAI |
| RAG | pgvector, Amazon Titan Embed V2, BM25 hybrid search |
| Jobs | BullMQ (Redis-backed) |
| Auth | Passport.js (local + Google OAuth), session-based |
| Billing | Stripe |
| Logging | Pino + Betterstack |

## Quick Start

### Prerequisites
- Node.js 18+
- (Optional) PostgreSQL 15+ with pgvector extension
- (Optional) Redis 7+

### 1. Install
```bash
git clone <repo-url>
cd observatory-qa
npm install
```

### 2. Configure
```bash
cp .env.example .env
```

**Minimum required** (in-memory storage, no AI — good for exploring the UI):
```env
SESSION_SECRET=any-random-string-here
ASSEMBLYAI_API_KEY=your_key
AUTH_USERS=admin:password123:admin:Admin User:default
```

**Recommended** (PostgreSQL + Bedrock):
```env
SESSION_SECRET=your-secret
ASSEMBLYAI_API_KEY=your_key
AUTH_USERS=admin:SecurePass!:admin:Admin:default

STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/observatory

AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1

REDIS_URL=redis://localhost:6379
```

### 3. Set up database (if using PostgreSQL)
```bash
# Install pgvector extension (needed for RAG)
psql -d observatory -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Push schema to database
npm run db:push
```

### 4. Run
```bash
npm run dev
```

Open http://localhost:5000. Login with credentials from `AUTH_USERS`.

### 5. (Optional) Start background workers
```bash
npm run workers   # Requires REDIS_URL
```

## Project Structure

```
client/src/
  pages/              # 19 route pages (dashboard, transcripts, upload, reports, etc.)
  components/         # UI components (shadcn/ui + custom)

server/
  index.ts            # App entry point
  auth.ts             # Authentication + org context middleware
  routes/             # 16 modular route files
  services/           # AI providers, S3, Redis, RAG, Stripe, logging
  storage/            # Storage abstraction (PostgreSQL, S3, GCS, memory)
  db/                 # Drizzle ORM schema + PostgreSQL storage
  workers/            # BullMQ worker processes

shared/
  schema.ts           # Zod schemas + TypeScript types (shared client/server)

deploy/ec2/           # EC2 deployment (Caddy, systemd, bootstrap script)
tests/                # 12 test files (Node test runner)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with Vite HMR (port 5000) |
| `npm run build` | Production build (Vite frontend + esbuild backend) |
| `npm run start` | Start production server |
| `npm run test` | Run test suite |
| `npm run check` | TypeScript type check |
| `npm run workers` | Start BullMQ workers (requires Redis) |
| `npm run db:push` | Push Drizzle schema to PostgreSQL |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run db:migrate` | Run database migrations |
| `npm run seed` | Seed sample data |

## Storage Backends

The app supports multiple storage backends, chosen by environment configuration:

| Backend | Config | Best For |
|---------|--------|----------|
| **PostgreSQL** | `STORAGE_BACKEND=postgres` + `DATABASE_URL` | Production SaaS (recommended) |
| **S3** | `S3_BUCKET=your-bucket` | Single-tenant, AWS-native deployments |
| **GCS** | `GCS_BUCKET` + `GCS_CREDENTIALS` | Google Cloud deployments |
| **Memory** | (no config) | Local development only (data lost on restart) |

When using PostgreSQL, add `S3_BUCKET` for audio file storage alongside the database.

## AI Providers

Two AI providers are supported, configurable per-organization:

| Provider | Config | Notes |
|----------|--------|-------|
| **AWS Bedrock (Claude)** | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | HIPAA-eligible with BAA. Default model: `claude-sonnet-4-6` |
| **Google Gemini** | `GEMINI_API_KEY` | AI Studio (testing) or Vertex AI (production). Default model: `gemini-2.5-flash` |

Set `AI_PROVIDER=bedrock` or `AI_PROVIDER=gemini` to force a specific provider, or let the app auto-detect from available credentials.

## Plan Tiers

| Feature | Free | Pro ($99/mo) | Enterprise ($499/mo) |
|---------|------|-------------|---------------------|
| Calls/month | 50 | 1,000 | Unlimited |
| Storage | 500 MB | 10 GB | 100 GB |
| Users | 3 | 25 | Unlimited |
| RAG Knowledge Base | - | Yes | Yes |
| Custom Templates | - | Yes | Yes |
| SSO | - | - | Yes |
| Priority Support | - | - | Yes |

## Deployment

### EC2 (Production HIPAA)
See [`deploy/ec2/README.md`](deploy/ec2/README.md) for a lean EC2 setup (~$13/month):
- Amazon Linux 2023 + Caddy (auto TLS) + systemd
- IAM instance role for S3 + Bedrock (no hardcoded keys)

### Render.com (Staging)
- Build: `npm run build`
- Start: `npm run start`
- Configure env vars in Render dashboard

## HIPAA Compliance

Observatory QA implements healthcare-grade security controls:

- **Encryption**: TLS in transit (Caddy/Render), encrypted at rest (EBS, S3 SSE, PostgreSQL)
- **Access control**: Role-based permissions, 15-min session idle timeout, account lockout after 5 failed attempts
- **Audit logging**: Structured JSON logs for all PHI access — user, org, action, timestamp
- **Data retention**: Auto-purge calls per org policy (configurable, default 90 days)
- **Tenant isolation**: All data access requires org context — cross-org access is structurally impossible
- **Security headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection

## Testing

```bash
npm run test
```

12 test files covering schemas, routes, multi-tenancy, RBAC, billing, API keys, and more. Uses Node.js built-in test runner via tsx.

## Environment Variables

See [`.env.example`](.env.example) for the full list with documentation.

## License

MIT
