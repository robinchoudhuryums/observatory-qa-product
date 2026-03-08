# CallAnalyzer Multi-Tenant Transformation Plan

## Observatory QA Product — Fork of assemblyai_tool

### Executive Summary

This document outlines the plan to transform CallAnalyzer from a single-tenant, single-company (UMS) call analysis tool into **Observatory**: a multi-tenant SaaS platform where multiple organizations can independently use the system with full data isolation, per-org configuration, and tenant-aware HIPAA compliance.

---

## Current State Analysis

### Architecture (Single-Tenant)
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Wouter, TanStack Query
- **Backend**: Express.js + TypeScript (ESM), Node.js
- **AI**: AWS Bedrock (Claude) for analysis, AssemblyAI for transcription
- **Storage**: AWS S3 (JSON files per entity — no relational database)
- **Auth**: Session-based, users defined in `AUTH_USERS` environment variable
- **Hosting**: Render.com (single instance)

### Single-Tenant Hardcodings Identified

| Item | Location | Current Value |
|------|----------|---------------|
| S3 bucket default | `server/storage.ts:830,837` | `ums-call-archive` |
| Email domain | `server/routes.ts:390`, `seed.ts` | `@company.com` |
| Department structure | `shared/schema.ts:32-42` | `POWER_MOBILITY_SUBTEAMS` (hardcoded array) |
| App branding | `client/src/components/layout/sidebar.tsx:111-112` | `"CallAnalyzer — Pro Dashboard"` |
| Auth users | `server/auth.ts` | `AUTH_USERS` env var (flat list, no org context) |
| Call categories | `shared/schema.ts` | Fixed: inbound, outbound, internal, vendor |
| Call party types | `shared/schema.ts` | Fixed: customer, insurance, medical_facility, etc. |
| Employee CSV | `employees.csv` (root) | Single company's employee roster |
| WebSocket broadcasts | `server/services/websocket.ts` | Global (all connected clients receive all events) |
| Audit logs | `server/services/audit-log.ts` | No org context in log entries |
| Data retention | `server/index.ts` | Single global `RETENTION_DAYS` policy |
| Session store | `server/auth.ts` | Single in-memory store, no tenant scoping |

### Storage Path Structure (No Tenant Prefix)
```
employees/{id}.json
calls/{id}.json
transcripts/{callId}.json
sentiments/{callId}.json
analyses/{callId}.json
audio/{callId}/{fileName}
access-requests/{id}.json
prompt-templates/{id}.json
coaching/{id}.json
```

### Data Flow (No Org Filtering)
- All API endpoints return **all** data across the entire deployment
- No `orgId` field in any schema (Employee, Call, Transcript, Analysis, Coaching, etc.)
- Reports aggregate across all calls globally
- Any manager can edit/delete any call or assign to any employee
- Dashboard metrics span all data

---

## Multi-Tenant Architecture Design

### Tenancy Model: **Shared Application, Isolated Storage**

Each tenant (organization) shares the same application deployment but has logically isolated data through:
1. **Org-prefixed S3 paths** — All storage keys namespaced by `orgId`
2. **Middleware-injected org context** — Every request carries `orgId` from authenticated session
3. **Query-level filtering** — All data access filtered by org
4. **Org-scoped WebSocket channels** — Real-time updates only to same-org clients

### Why Not Separate Deployments?
- Separate deployments per tenant would be simpler but operationally expensive
- Shared deployment enables: centralized updates, unified monitoring, lower infra cost
- Storage isolation via S3 prefixes provides strong data separation without separate buckets

---

## Phase 1: Database & Schema Foundation

### 1.1 Add Organization Entity

**File**: `shared/schema.ts`

```typescript
// New Organization schema
export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),                    // Display name: "Acme Medical Supplies"
  slug: z.string(),                    // URL-safe identifier: "acme-medical"
  settings: z.object({
    emailDomain: z.string().optional(),           // "@acme.com"
    departments: z.array(z.string()).optional(),   // Custom department list
    subTeams: z.record(z.string(), z.array(z.string())).optional(), // dept → subteams
    callCategories: z.array(z.string()).optional(), // Custom call categories
    callPartyTypes: z.array(z.string()).optional(), // Custom party types
    retentionDays: z.number().default(90),
    branding: z.object({
      appName: z.string().default("Observatory"),
      logoUrl: z.string().optional(),
    }).optional(),
    aiProvider: z.enum(["bedrock", "gemini"]).optional(), // Per-org AI provider
  }),
  status: z.enum(["active", "suspended", "trial"]),
  createdAt: z.string(),
});

export type Organization = z.infer<typeof organizationSchema>;
```

### 1.2 Add `orgId` to All Existing Schemas

Every data entity gains a required `orgId` field:

```typescript
// Updated schemas (additions shown)
export const employeeSchema = z.object({
  orgId: z.string(),    // NEW
  // ... existing fields unchanged
});

export const callSchema = z.object({
  orgId: z.string(),    // NEW
  // ... existing fields unchanged
});

export const accessRequestSchema = z.object({
  orgId: z.string(),    // NEW
  // ... existing fields unchanged
});

export const coachingSessionSchema = z.object({
  orgId: z.string(),    // NEW
  // ... existing fields unchanged
});

export const promptTemplateSchema = z.object({
  orgId: z.string(),    // NEW
  // ... existing fields unchanged
});
```

### 1.3 Add `orgId` to User Model

**File**: `server/auth.ts`

The current `AUTH_USERS` format `username:password:role:displayName` becomes:
```
username:password:role:displayName:orgSlug
```

The user session object gains:
```typescript
interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: string;
  orgId: string;      // NEW
  orgSlug: string;     // NEW
  orgName: string;     // NEW
}
```

---

## Phase 2: Storage Layer Transformation

### 2.1 Org-Prefixed S3 Paths

**File**: `server/storage.ts`

Current flat paths → org-namespaced paths:

```
BEFORE                              AFTER
employees/{id}.json          →      orgs/{orgId}/employees/{id}.json
calls/{id}.json              →      orgs/{orgId}/calls/{id}.json
transcripts/{callId}.json    →      orgs/{orgId}/transcripts/{callId}.json
sentiments/{callId}.json     →      orgs/{orgId}/sentiments/{callId}.json
analyses/{callId}.json       →      orgs/{orgId}/analyses/{callId}.json
audio/{callId}/{file}        →      orgs/{orgId}/audio/{callId}/{file}
access-requests/{id}.json   →      orgs/{orgId}/access-requests/{id}.json
prompt-templates/{id}.json  →      orgs/{orgId}/prompt-templates/{id}.json
coaching/{id}.json           →      orgs/{orgId}/coaching/{id}.json
                                    orgs/{orgId}/org.json              (NEW)
```

### 2.2 Update IStorage Interface

All methods gain `orgId` as first parameter:

```typescript
interface IStorage {
  // Organization CRUD (NEW)
  getOrganization(orgId: string): Promise<Organization | null>;
  createOrganization(org: Organization): Promise<Organization>;
  updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization>;
  listOrganizations(): Promise<Organization[]>;  // Super-admin only

  // Existing methods — all gain orgId
  getAllEmployees(orgId: string): Promise<Employee[]>;
  getEmployee(orgId: string, id: string): Promise<Employee | null>;
  getEmployeeByEmail(orgId: string, email: string): Promise<Employee | null>;
  createEmployee(orgId: string, data: InsertEmployee): Promise<Employee>;
  updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee>;

  getAllCalls(orgId: string): Promise<Call[]>;
  getCall(orgId: string, id: string): Promise<Call | null>;
  createCall(orgId: string, data: InsertCall): Promise<Call>;
  updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call>;
  deleteCall(orgId: string, id: string): Promise<void>;
  getCallsWithDetails(orgId: string, filters: CallFilters): Promise<CallWithDetails[]>;

  // ... same pattern for transcripts, sentiments, analyses, coaching, etc.
}
```

### 2.3 Update CloudStorage Implementation

Every method in `CloudStorage` class prepends `orgs/{orgId}/` to storage keys:

```typescript
// Example transformation
async getAllEmployees(orgId: string): Promise<Employee[]> {
  const prefix = `orgs/${orgId}/employees/`;
  const files = await this.client.listObjects(prefix);
  // ... rest unchanged
}
```

### 2.4 Update MemStorage (Development)

In-memory maps become org-scoped:

```typescript
// BEFORE
private employees: Map<string, Employee> = new Map();

// AFTER
private employees: Map<string, Map<string, Employee>> = new Map(); // orgId → (id → Employee)

// Helper
private getOrgMap<T>(store: Map<string, Map<string, T>>, orgId: string): Map<string, T> {
  if (!store.has(orgId)) store.set(orgId, new Map());
  return store.get(orgId)!;
}
```

### 2.5 Remove Hardcoded Bucket Default

```typescript
// BEFORE (storage.ts:830)
const bucket = process.env.S3_BUCKET || "ums-call-archive";

// AFTER
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET environment variable is required");
```

---

## Phase 3: Authentication & Authorization

### 3.1 Database-Backed User Management

Replace `AUTH_USERS` environment variable with stored user records:

**New storage path**: `orgs/{orgId}/users/{userId}.json`

```typescript
export const userSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  username: z.string(),
  passwordHash: z.string(),
  role: z.enum(["viewer", "manager", "admin"]),
  displayName: z.string(),
  email: z.string().optional(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
  lastLogin: z.string().optional(),
});
```

### 3.2 Super-Admin Role

Add a platform-level admin role (not org-scoped) for managing organizations:

```typescript
// New role hierarchy
// super_admin (4) > admin (3) > manager (2) > viewer (1)

// Super-admin users stored separately
// platform/super-admins/{userId}.json
```

- Super-admins can: create/suspend orgs, view cross-org metrics, manage platform settings
- Super-admins are configured via `SUPER_ADMIN_USERS` env var (small, controlled set)

### 3.3 Org Context Middleware

**File**: `server/auth.ts` — new middleware

```typescript
export function injectOrgContext(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user?.orgId) {
    return res.status(401).json({ message: "No organization context" });
  }
  req.orgId = req.session.user.orgId;
  next();
}
```

Every authenticated route gets `req.orgId` automatically. All storage calls use it.

### 3.4 Access Request Flow Update

Access requests become org-scoped:
- Requestor must specify which org they're requesting access to (via org slug in URL or form)
- Admins only see requests for their own org
- Approval creates a user record in that org's storage

### 3.5 Session Security Updates

- Session store: Replace `memorystore` with Redis (or compatible) for multi-instance deployments
- Session data includes `orgId`, validated on every request
- Account lockout tracked per org + username (not just global username)

---

## Phase 4: API Routes Transformation

### 4.1 Route Structure Change

All API routes gain org context from middleware (not URL):

```typescript
// Org context injected via session, NOT via URL path
// This keeps URLs clean and prevents org-switching attacks

router.use("/api", requireAuth, injectOrgContext);

// Every route handler uses req.orgId
router.get("/api/employees", async (req, res) => {
  const employees = await storage.getAllEmployees(req.orgId);
  res.json(employees);
});
```

### 4.2 Route-by-Route Changes

#### Calls
```typescript
// BEFORE
const calls = await storage.getCallsWithDetails({ status, sentiment });
// AFTER
const calls = await storage.getCallsWithDetails(req.orgId, { status, sentiment });
```

#### Employees
```typescript
// BEFORE
const employees = await storage.getAllEmployees();
// AFTER
const employees = await storage.getAllEmployees(req.orgId);
```

#### Employee CSV Import
```typescript
// BEFORE: hardcoded @company.com
const email = `${extension}@company.com`;

// AFTER: use org settings
const org = await storage.getOrganization(req.orgId);
const domain = org.settings.emailDomain || "example.com";
const email = `${extension}@${domain}`;
```

#### Dashboard Metrics
```typescript
// BEFORE
const allCalls = await storage.getCallsWithDetails({ status: "completed" });

// AFTER
const allCalls = await storage.getCallsWithDetails(req.orgId, { status: "completed" });
```

#### Reports
All report endpoints filtered by `req.orgId` — reports only show data for the user's org.

#### Coaching
```typescript
// BEFORE
const sessions = await storage.getCoachingSessions();
// AFTER
const sessions = await storage.getCoachingSessions(req.orgId);
```

#### Prompt Templates
Org-scoped templates — each org defines their own evaluation criteria:
```typescript
const templates = await storage.getPromptTemplates(req.orgId);
```

#### Search
```typescript
// BEFORE
const results = await storage.searchCalls(query);
// AFTER
const results = await storage.searchCalls(req.orgId, query);
```

### 4.3 Audio Processing Pipeline Update

**File**: `server/routes.ts` — `processAudioFile()`

```typescript
// Key changes in the pipeline:
// 1. S3 upload path includes orgId
await storage.uploadAudio(req.orgId, callId, fileName, audioBuffer);

// 2. Call record includes orgId
const call = await storage.createCall(req.orgId, { fileName, status: "processing" });

// 3. Prompt template lookup is org-scoped
const template = await storage.getPromptTemplate(req.orgId, callCategory);

// 4. Employee auto-assignment is org-scoped
const employee = await storage.getEmployeeByName(req.orgId, detectedAgentName);

// 5. WebSocket notification is org-scoped
wsService.notifyOrg(req.orgId, { type: "call_completed", callId });
```

### 4.4 Platform Admin Routes (New)

```typescript
// Super-admin only routes
router.get("/api/platform/organizations", requireSuperAdmin, async (req, res) => { ... });
router.post("/api/platform/organizations", requireSuperAdmin, async (req, res) => { ... });
router.patch("/api/platform/organizations/:orgId", requireSuperAdmin, async (req, res) => { ... });
router.get("/api/platform/metrics", requireSuperAdmin, async (req, res) => { ... });
```

---

## Phase 5: WebSocket & Real-Time Updates

### 5.1 Org-Scoped Channels

**File**: `server/services/websocket.ts`

```typescript
// BEFORE: global broadcast
broadcast(message: any) {
  this.clients.forEach(client => client.send(JSON.stringify(message)));
}

// AFTER: org-scoped broadcast
private clientsByOrg: Map<string, Set<WebSocket>> = new Map();

notifyOrg(orgId: string, message: any) {
  const orgClients = this.clientsByOrg.get(orgId) || new Set();
  orgClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// On connection: extract orgId from session, add to org group
onConnection(ws: WebSocket, req: Request) {
  const orgId = req.session?.user?.orgId;
  if (!orgId) { ws.close(); return; }
  this.addClientToOrg(orgId, ws);
}
```

---

## Phase 6: Frontend Transformation

### 6.1 Auth Context Update

**File**: `client/src/App.tsx`

The auth user object now includes org context:

```typescript
interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
  orgId: string;      // NEW
  orgName: string;     // NEW
  orgSlug: string;     // NEW
  orgSettings: {       // NEW
    departments?: string[];
    subTeams?: Record<string, string[]>;
    callCategories?: string[];
    callPartyTypes?: string[];
    branding?: { appName: string; logoUrl?: string };
  };
}
```

### 6.2 Dynamic Branding

**File**: `client/src/components/layout/sidebar.tsx`

```typescript
// BEFORE
<span>CallAnalyzer</span> — <span>Pro Dashboard</span>

// AFTER
const { orgSettings } = useAuth();
<span>{orgSettings?.branding?.appName || "Observatory"}</span>
```

### 6.3 Dynamic Department/SubTeam Configuration

**File**: `client/src/pages/employees.tsx`

```typescript
// BEFORE (hardcoded)
const DEPARTMENTS_WITH_SUBTEAMS = {
  "Intake - Power Mobility": POWER_MOBILITY_SUBTEAMS,
};

// AFTER (from org settings)
const { orgSettings } = useAuth();
const departments = orgSettings?.departments || DEFAULT_DEPARTMENTS;
const subTeams = orgSettings?.subTeams || {};
```

### 6.4 Dynamic Call Categories & Party Types

**Files**: `client/src/pages/reports.tsx`, `client/src/pages/upload.tsx`

```typescript
// BEFORE
const CALL_PARTY_TYPES = ["customer", "insurance", "medical_facility", ...];

// AFTER
const { orgSettings } = useAuth();
const partyTypes = orgSettings?.callPartyTypes || DEFAULT_PARTY_TYPES;
```

### 6.5 Reports Page — Remove Global Aggregation

All report data is already org-scoped from the API side. No frontend changes needed beyond using dynamic config values.

### 6.6 Admin Page — User Management UI

Replace the current "add to AUTH_USERS env var" instructions with actual user management:

```typescript
// New admin capabilities:
// - Create/edit/disable users within their org
// - Approve access requests (creates user in org)
// - View org settings (name, departments, retention, etc.)
```

---

## Phase 7: HIPAA Compliance Updates

### 7.1 Org-Scoped Audit Logging

**File**: `server/services/audit-log.ts`

```typescript
// BEFORE
logEvent({ event, userId, resourceType, resourceId });

// AFTER
logEvent({ event, userId, orgId, resourceType, resourceId });
// All [HIPAA_AUDIT] entries now include orgId for per-tenant audit trails
```

### 7.2 Per-Org Data Retention

```typescript
// BEFORE (index.ts): single global RETENTION_DAYS
const retentionDays = parseInt(process.env.RETENTION_DAYS || "90");

// AFTER: per-org retention from org settings
const orgs = await storage.listOrganizations();
for (const org of orgs) {
  const retentionDays = org.settings.retentionDays || 90;
  await purgeExpiredCalls(org.id, retentionDays);
}
```

### 7.3 Cross-Tenant Access Prevention

- Storage layer enforces org isolation — no method can access data without `orgId`
- Middleware validates `orgId` matches session on every request
- S3 paths make cross-tenant data access structurally impossible (different prefixes)
- Audit log captures any authorization failures for security review

---

## Phase 8: Data Migration Strategy

### 8.1 Migration Script: Single-Tenant → Multi-Tenant

For the existing UMS deployment, create a one-time migration:

```typescript
// scripts/migrate-to-multitenant.ts

// 1. Create UMS organization record
const org: Organization = {
  id: generateId(),
  name: "Universal Medical Supply",
  slug: "ums",
  settings: {
    emailDomain: "company.com",      // from current hardcoded value
    departments: [...CURRENT_DEPARTMENTS],
    subTeams: { "Intake - Power Mobility": POWER_MOBILITY_SUBTEAMS },
    retentionDays: 90,
    branding: { appName: "CallAnalyzer" },
  },
  status: "active",
  createdAt: new Date().toISOString(),
};

// 2. Move all existing S3 objects to org-prefixed paths
//    employees/{id}.json → orgs/{orgId}/employees/{id}.json
//    calls/{id}.json → orgs/{orgId}/calls/{id}.json
//    ... etc.

// 3. Update all JSON records to include orgId field

// 4. Create user records from current AUTH_USERS env var
//    Parse "user:pass:role:name" → stored user with orgId

// 5. Verify migration: count objects before/after, validate paths
```

### 8.2 Rollback Plan

- Keep original (un-prefixed) objects for 30 days post-migration
- Migration script logs every move operation for audit
- Verification step compares object counts and checksums

---

## Phase 9: Testing Strategy

### 9.1 Unit Tests

Extend existing test suite (`tests/`):

```
tests/
  schema.test.ts           ← Update: test orgId in all schemas
  ai-provider.test.ts      ← No change (AI layer is org-agnostic)
  storage.test.ts          ← NEW: test org-scoped CRUD operations
  auth.test.ts             ← NEW: test org context injection
  org-isolation.test.ts    ← NEW: verify cross-org data isolation
  migration.test.ts        ← NEW: test migration script
```

### 9.2 Key Test Scenarios

1. **Data Isolation**: Org A cannot see Org B's employees, calls, or reports
2. **Auth Scoping**: User in Org A gets 404 (not 403) for Org B resources
3. **WebSocket Isolation**: Call processing events only reach same-org clients
4. **Storage Paths**: All S3 operations use correct org prefix
5. **Employee Operations**: CSV import, auto-assignment scoped to org
6. **Report Accuracy**: Dashboard metrics only count org's own calls
7. **Admin Boundary**: Org admin cannot manage other orgs
8. **Migration**: Existing data correctly moved to org-prefixed paths

### 9.3 Integration Tests

- Upload a call as Org A user → verify stored under `orgs/{orgA}/`
- Login as Org B user → verify Org A's call is invisible
- Create coaching session → verify scoped to correct org
- Run data retention purge → verify only purges within org's policy

---

## Phase 10: Deployment & Infrastructure

### 10.1 Environment Variables Changes

```bash
# REMOVED
AUTH_USERS                    # Replaced by stored user records

# CHANGED
S3_BUCKET                    # Now required (no hardcoded default)

# NEW
SUPER_ADMIN_USERS             # Platform super-admins (format: user:pass:name)
REDIS_URL                     # For session store (replaces memorystore)
DEFAULT_ORG_SLUG              # Optional: default org for single-tenant backward compat
```

### 10.2 Infrastructure Requirements

| Component | Current | Multi-Tenant |
|-----------|---------|--------------|
| App instances | 1 (Render) | 1+ (can scale horizontally with Redis sessions) |
| S3 bucket | 1 (ums-call-archive) | 1 shared bucket with org prefixes |
| Session store | In-memory | Redis (shared across instances) |
| AssemblyAI | 1 API key | 1 API key (shared) or per-org keys |
| Bedrock | 1 IAM user | 1 IAM user (shared) or per-org credentials |

### 10.3 Org Onboarding Flow

1. Super-admin creates organization via platform admin API/UI
2. Org record stored at `orgs/{orgId}/org.json`
3. First admin user created for the org
4. Admin logs in, configures: departments, sub-teams, branding, email domain
5. Admin creates additional users or enables access request flow
6. Admin imports employees (CSV or manual)
7. Users begin uploading and analyzing calls

---

## Implementation Order & Dependencies

### Recommended Sequence

```
Phase 1: Schema Foundation (shared/schema.ts)
    ↓
Phase 2: Storage Layer (server/storage.ts)
    ↓
Phase 3: Auth & Middleware (server/auth.ts)
    ↓
Phase 4: API Routes (server/routes.ts)  ←  depends on Phase 2 + 3
    ↓
Phase 5: WebSocket (server/services/websocket.ts)
    ↓
Phase 6: Frontend (client/src/)  ←  depends on Phase 4 API changes
    ↓
Phase 7: HIPAA Updates (audit-log.ts, retention)
    ↓
Phase 8: Migration Script  ←  depends on Phase 1-4
    ↓
Phase 9: Testing  ←  parallel with Phases 4-8
    ↓
Phase 10: Deployment & Infrastructure
```

### Critical Path Items
1. **Schema + Storage** must be done first — everything depends on `orgId`
2. **Auth middleware** must be done before routes (routes need `req.orgId`)
3. **Migration script** should be built alongside storage changes (same mental model)
4. **Frontend** can start once API contracts are defined (even before backend is complete)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data leakage between orgs | Critical | Storage-level isolation + integration tests |
| Migration data loss | High | Rollback plan + pre/post verification |
| Performance degradation from S3 prefix listing | Medium | Pagination already exists; prefix filtering is efficient |
| Session store migration (memory → Redis) | Medium | Can run in-memory for dev, Redis for prod |
| Breaking existing UMS deployment | High | Migration script + backward-compat DEFAULT_ORG_SLUG |
| HIPAA audit trail gaps during migration | Medium | Freeze period during migration, verify audit continuity |

---

## Files Changed Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `shared/schema.ts` | **Major** | Add Organization schema, add `orgId` to all entities, make departments/subTeams dynamic |
| `server/storage.ts` | **Major** | Org-prefix all paths, add `orgId` param to all methods, add org CRUD |
| `server/auth.ts` | **Major** | Database-backed users, org context middleware, super-admin role |
| `server/routes.ts` | **Major** | Pass `orgId` to all storage calls, org-scoped filtering, platform admin routes |
| `server/index.ts` | **Moderate** | Per-org retention, Redis session store, remove hardcoded defaults |
| `server/services/websocket.ts` | **Moderate** | Org-scoped channels and broadcasts |
| `server/services/audit-log.ts` | **Minor** | Add `orgId` to all audit entries |
| `server/services/s3.ts` | **None** | Generic S3 client — no changes needed |
| `server/services/gcs.ts` | **None** | Generic GCS client — no changes needed |
| `server/services/assemblyai.ts` | **None** | Transcription service — org-agnostic |
| `server/services/ai-factory.ts` | **Minor** | Optional per-org AI provider selection |
| `server/services/bedrock.ts` | **None** | AI provider — org-agnostic |
| `client/src/App.tsx` | **Moderate** | Auth context includes org info |
| `client/src/components/layout/sidebar.tsx` | **Minor** | Dynamic branding |
| `client/src/pages/employees.tsx` | **Moderate** | Dynamic departments/subTeams from org settings |
| `client/src/pages/reports.tsx` | **Minor** | Dynamic call party types from org settings |
| `client/src/pages/admin.tsx` | **Major** | User management UI (replaces env var instructions) |
| `client/src/pages/auth.tsx` | **Minor** | Org selection or slug-based login |
| `client/src/pages/coaching.tsx` | **None** | Already uses API data (org-scoped by backend) |
| `client/src/pages/dashboard.tsx` | **None** | Already uses API data |
| `seed.ts` | **Moderate** | Org-aware seeding, dynamic email domain |
| `tests/*.test.ts` | **Major** | New isolation tests, updated schema tests |
| `scripts/migrate-to-multitenant.ts` | **New** | One-time migration script |

---

## Success Criteria

1. Two test organizations can operate simultaneously with zero data visibility between them
2. Existing UMS data is fully migrated with no data loss
3. All HIPAA audit logs include org context
4. Each org can independently configure: departments, sub-teams, branding, retention, prompt templates
5. WebSocket events are org-isolated
6. Super-admin can manage all organizations from a platform view
7. All existing tests pass + new isolation tests pass
8. No hardcoded references to UMS, `ums-call-archive`, `@company.com`, or `POWER_MOBILITY_SUBTEAMS` remain in production code paths
