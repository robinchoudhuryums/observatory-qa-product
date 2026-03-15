import { z } from "zod";

// --- ORGANIZATION SCHEMAS ---
export const orgBrandingSchema = z.object({
  appName: z.string().default("Observatory"),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(), // Hex color (e.g., "#10b981") to override default theme
  secondaryColor: z.string().optional(), // Hex color for accent/secondary elements
  onboardingCompleted: z.boolean().optional(),
});

export const orgSettingsSchema = z.object({
  emailDomain: z.string().optional(),
  departments: z.array(z.string()).optional(),
  subTeams: z.record(z.string(), z.array(z.string())).optional(),
  callCategories: z.array(z.string()).optional(),
  callPartyTypes: z.array(z.string()).optional(),
  retentionDays: z.number().default(90),
  branding: orgBrandingSchema.optional(),
  bedrockModel: z.string().optional(), // Per-org model override (e.g., "us.anthropic.claude-haiku-4-5-20251001")
  maxCallsPerDay: z.number().optional(), // Per-org usage quota
  maxStorageMb: z.number().optional(), // Per-org storage limit
  // Webhook notification settings (override env vars per-org)
  webhookUrl: z.string().url().optional(),
  webhookPlatform: z.enum(["slack", "teams"]).optional(),
  webhookEvents: z.array(z.string()).optional(), // e.g., ["low_score", "agent_misconduct", "exceptional_call"]
  // SSO configuration (Enterprise plan only)
  ssoProvider: z.enum(["saml", "oidc"]).optional(),
  ssoEntityId: z.string().optional(),
  ssoSignOnUrl: z.string().url().optional(),
  ssoCertificate: z.string().optional(),
  ssoEnforced: z.boolean().optional(), // When true, only SSO login allowed
  // MFA enforcement (HIPAA recommended safeguard)
  mfaRequired: z.boolean().optional(), // When true, all users in this org must enable MFA
});

export const insertOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  settings: orgSettingsSchema.optional(),
  status: z.enum(["active", "suspended", "trial"]).default("active"),
});

export const organizationSchema = insertOrganizationSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- USER SCHEMAS ---
export const insertUserSchema = z.object({
  orgId: z.string(),
  username: z.string(),
  passwordHash: z.string(),
  name: z.string(),
  role: z.string().default("viewer"),
  mfaEnabled: z.boolean().optional(),
  mfaSecret: z.string().optional(),
  mfaBackupCodes: z.array(z.string()).optional(),
});

export const userSchema = insertUserSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- EMPLOYEE SCHEMAS ---
export const insertEmployeeSchema = z.object({
  orgId: z.string().optional(),
  name: z.string(),
  role: z.string().optional(),
  email: z.string(),
  initials: z.string().max(2).optional(),
  status: z.string().default("Active").optional(),
  subTeam: z.string().optional(),
});

export const employeeSchema = insertEmployeeSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- DEFAULT SUB-TEAMS (originally UMS Power Mobility, now used as defaults) ---
// Organizations can override these via org settings (orgSettings.subTeams)
export const DEFAULT_SUBTEAMS: Record<string, readonly string[]> = {
  "Intake - Power Mobility": [
    "PPD",
    "MA Education",
    "Appt Scheduling",
    "PT Education",
    "Appt Passed",
    "PT Eval",
    "MDO Follow-Up",
    "Medical Review",
    "Prior Authorization",
  ],
};

/** @deprecated Use org settings subTeams instead. Kept for backward compatibility. */
export const POWER_MOBILITY_SUBTEAMS = DEFAULT_SUBTEAMS["Intake - Power Mobility"]!;

// --- CALL CATEGORY ---
export const CALL_CATEGORIES = [
  { value: "inbound", label: "Inbound Call", description: "Customer/patient calling into the company" },
  { value: "outbound", label: "Outbound Call", description: "Employee calling a customer/patient" },
  { value: "internal", label: "Internal", description: "Call between coworkers or departments" },
  { value: "vendor", label: "Vendor/Partner", description: "Call with an external vendor or partner" },
] as const;

export type CallCategory = typeof CALL_CATEGORIES[number]["value"];

// --- CALL SCHEMAS ---
export const insertCallSchema = z.object({
  orgId: z.string().optional(),
  employeeId: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  fileHash: z.string().optional(),
  status: z.string().default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
  callCategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const callSchema = insertCallSchema.extend({
  id: z.string(),
  orgId: z.string(),
  uploadedAt: z.string().optional(),
});

// --- TRANSCRIPT SCHEMAS ---
export const transcriptWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  speaker: z.string().optional(),
});

export const insertTranscriptSchema = z.object({
  orgId: z.string().optional(),
  callId: z.string(),
  text: z.string().optional(),
  confidence: z.string().optional(),
  words: z.array(transcriptWordSchema).optional(),
});

export const transcriptSchema = insertTranscriptSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- SENTIMENT ANALYSIS SCHEMAS ---
export const sentimentSegmentSchema = z.object({
  text: z.string(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  confidence: z.number(),
  start: z.number(),
  end: z.number(),
});

export const insertSentimentAnalysisSchema = z.object({
  orgId: z.string().optional(),
  callId: z.string(),
  overallSentiment: z.string().optional(),
  overallScore: z.string().optional(),
  segments: z.array(sentimentSegmentSchema).optional(),
});

export const sentimentAnalysisSchema = insertSentimentAnalysisSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- CALL ANALYSIS SCHEMAS ---
export const analysisFeedbackSchema = z.object({
  strengths: z.array(z.union([z.string(), z.object({ text: z.string(), timestamp: z.string().optional() })])).optional(),
  suggestions: z.array(z.union([z.string(), z.object({ text: z.string(), timestamp: z.string().optional() })])).optional(),
});

export const manualEditSchema = z.object({
  editedBy: z.string(),
  editedAt: z.string(),
  reason: z.string(),
  fieldsChanged: z.array(z.string()),
  previousValues: z.record(z.unknown()),
});

export const confidenceFactorsSchema = z.object({
  transcriptConfidence: z.number(),
  wordCount: z.number(),
  callDurationSeconds: z.number(),
  transcriptLength: z.number(),
  aiAnalysisCompleted: z.boolean(),
  overallScore: z.number(),
});

export const insertCallAnalysisSchema = z.object({
  orgId: z.string().optional(),
  callId: z.string(),
  performanceScore: z.string().optional(),
  talkTimeRatio: z.string().optional(),
  responseTime: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  summary: z.string().optional(),
  actionItems: z.array(z.string()).optional(),
  feedback: analysisFeedbackSchema.optional(),
  lemurResponse: z.unknown().optional(),
  callPartyType: z.string().optional(),
  flags: z.array(z.string()).optional(),
  manualEdits: z.array(manualEditSchema).optional(),
  confidenceScore: z.string().optional(),
  confidenceFactors: confidenceFactorsSchema.optional(),
  subScores: z.object({
    compliance: z.number().min(0).max(10).optional(),
    customerExperience: z.number().min(0).max(10).optional(),
    communication: z.number().min(0).max(10).optional(),
    resolution: z.number().min(0).max(10).optional(),
  }).optional(),
  detectedAgentName: z.string().optional(),
});

export const callAnalysisSchema = insertCallAnalysisSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- TYPES ---
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export type OrgBranding = z.infer<typeof orgBrandingSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof userSchema>;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = z.infer<typeof employeeSchema>;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = z.infer<typeof callSchema>;

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export type InsertSentimentAnalysis = z.infer<typeof insertSentimentAnalysisSchema>;
export type SentimentAnalysis = z.infer<typeof sentimentAnalysisSchema>;

export type InsertCallAnalysis = z.infer<typeof insertCallAnalysisSchema>;
export type CallAnalysis = z.infer<typeof callAnalysisSchema>;

// --- ACCESS REQUEST SCHEMAS ---
export const insertAccessRequestSchema = z.object({
  orgId: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  reason: z.string().optional(),
  requestedRole: z.enum(["viewer", "manager"]).default("viewer"),
});

export const accessRequestSchema = insertAccessRequestSchema.extend({
  id: z.string(),
  orgId: z.string(),
  status: z.enum(["pending", "approved", "denied"]).default("pending"),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = z.infer<typeof accessRequestSchema>;

// --- INVITATION SCHEMAS ---
export const insertInvitationSchema = z.object({
  orgId: z.string().optional(),
  email: z.string().email(),
  role: z.enum(["viewer", "manager", "admin"]).default("viewer"),
  invitedBy: z.string(),
  token: z.string().optional(), // Auto-generated if not provided
  expiresAt: z.string().optional(),
});

export const invitationSchema = insertInvitationSchema.extend({
  id: z.string(),
  orgId: z.string(),
  token: z.string(),
  status: z.enum(["pending", "accepted", "expired", "revoked"]).default("pending"),
  createdAt: z.string().optional(),
  acceptedAt: z.string().optional(),
});

export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;

// --- API KEY SCHEMAS ---
export const insertApiKeySchema = z.object({
  orgId: z.string().optional(),
  name: z.string().min(1),
  keyHash: z.string(), // SHA-256 hash of the key (never store plaintext)
  keyPrefix: z.string(), // First 8 chars for display (e.g., "obs_k_ab")
  permissions: z.array(z.string()).default(["read"]), // "read", "write", "admin"
  createdBy: z.string(),
  expiresAt: z.string().optional(),
});

export const apiKeySchema = insertApiKeySchema.extend({
  id: z.string(),
  orgId: z.string(),
  lastUsedAt: z.string().optional(),
  status: z.enum(["active", "revoked"]).default("active"),
  createdAt: z.string().optional(),
});

export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = z.infer<typeof apiKeySchema>;

// --- BILLING & SUBSCRIPTION SCHEMAS ---
export const PLAN_TIERS = ["free", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const planLimitsSchema = z.object({
  callsPerMonth: z.number(), // -1 = unlimited
  storageMb: z.number(),
  aiAnalysesPerMonth: z.number(),
  apiCallsPerMonth: z.number(),
  maxUsers: z.number(),
  customPromptTemplates: z.boolean(),
  ragEnabled: z.boolean(),
  ssoEnabled: z.boolean(),
  prioritySupport: z.boolean(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** Static plan definitions — no DB needed for these */
export const PLAN_DEFINITIONS: Record<PlanTier, { name: string; description: string; monthlyPriceUsd: number; yearlyPriceUsd: number; limits: PlanLimits }> = {
  free: {
    name: "Free",
    description: "For small teams getting started",
    monthlyPriceUsd: 0,
    yearlyPriceUsd: 0,
    limits: {
      callsPerMonth: 50,
      storageMb: 500,
      aiAnalysesPerMonth: 50,
      apiCallsPerMonth: 1000,
      maxUsers: 3,
      customPromptTemplates: false,
      ragEnabled: false,
      ssoEnabled: false,
      prioritySupport: false,
    },
  },
  pro: {
    name: "Pro",
    description: "For growing teams with advanced needs",
    monthlyPriceUsd: 99,
    yearlyPriceUsd: 948, // $79/mo billed yearly
    limits: {
      callsPerMonth: 1000,
      storageMb: 10000,
      aiAnalysesPerMonth: 1000,
      apiCallsPerMonth: 50000,
      maxUsers: 25,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: false,
      prioritySupport: false,
    },
  },
  enterprise: {
    name: "Enterprise",
    description: "For large organizations with custom requirements",
    monthlyPriceUsd: 499,
    yearlyPriceUsd: 4788, // $399/mo billed yearly
    limits: {
      callsPerMonth: -1, // unlimited
      storageMb: 100000,
      aiAnalysesPerMonth: -1,
      apiCallsPerMonth: -1,
      maxUsers: -1,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: true,
      prioritySupport: true,
    },
  },
};

export const subscriptionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  planTier: z.enum(PLAN_TIERS),
  status: z.enum(["active", "past_due", "canceled", "trialing", "incomplete"]),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  stripePriceId: z.string().optional(),
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  currentPeriodStart: z.string().optional(),
  currentPeriodEnd: z.string().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const insertSubscriptionSchema = subscriptionSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial({ cancelAtPeriodEnd: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// --- REFERENCE DOCUMENT SCHEMAS ---
export const REFERENCE_DOC_CATEGORIES = [
  "employee_handbook",
  "process_manual",
  "product_manual",
  "compliance_guide",
  "training_material",
  "script_template",
  "faq",
  "other",
] as const;
export type ReferenceDocCategory = (typeof REFERENCE_DOC_CATEGORIES)[number];

export const referenceDocumentSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  category: z.enum(REFERENCE_DOC_CATEGORIES),
  description: z.string().optional(),
  fileName: z.string(),
  fileSize: z.number(), // bytes
  mimeType: z.string(),
  storagePath: z.string(), // S3/cloud path
  /** Extracted text content (for injection into AI prompts) */
  extractedText: z.string().optional(),
  /** Which call categories should include this doc in analysis */
  appliesTo: z.array(z.string()).optional(), // e.g., ["inbound", "outbound"] or empty for all
  isActive: z.boolean().default(true),
  uploadedBy: z.string().optional(),
  createdAt: z.string().optional(),
});
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;

export const insertReferenceDocumentSchema = referenceDocumentSchema.omit({ id: true, createdAt: true });
export type InsertReferenceDocument = z.infer<typeof insertReferenceDocumentSchema>;

// --- PROMPT TEMPLATE SCHEMAS ---
export const promptTemplateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  callCategory: z.string(),
  name: z.string(),
  evaluationCriteria: z.string(),
  requiredPhrases: z.array(z.object({
    phrase: z.string(),
    label: z.string(),
    severity: z.enum(["required", "recommended"]).default("required"),
  })).optional(),
  scoringWeights: z.object({
    compliance: z.number().min(0).max(100).default(25),
    customerExperience: z.number().min(0).max(100).default(25),
    communication: z.number().min(0).max(100).default(25),
    resolution: z.number().min(0).max(100).default(25),
  }).optional(),
  additionalInstructions: z.string().optional(),
  isActive: z.boolean().default(true),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const insertPromptTemplateSchema = promptTemplateSchema.omit({ id: true });

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;

// --- ROLE DEFINITIONS ---
export const USER_ROLES = [
  {
    value: "viewer" as const,
    label: "Viewer",
    description: "View-only access to dashboards, reports, transcripts, and team data. Cannot edit or delete anything.",
  },
  {
    value: "manager" as const,
    label: "Manager / QA",
    description: "Everything a Viewer can do, plus: assign calls, edit analysis, manage employees, and export reports.",
  },
  {
    value: "admin" as const,
    label: "Administrator",
    description: "Full access. Manage users, approve access requests, bulk import, delete calls, and configure system settings.",
  },
] as const;

export type UserRole = typeof USER_ROLES[number]["value"];

// --- COACHING SESSION SCHEMAS ---
export const COACHING_CATEGORIES = [
  { value: "compliance", label: "Compliance" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "communication", label: "Communication" },
  { value: "resolution", label: "Resolution" },
  { value: "general", label: "General" },
] as const;

export const insertCoachingSessionSchema = z.object({
  orgId: z.string().optional(),
  employeeId: z.string(),
  callId: z.string().optional(),
  assignedBy: z.string(),
  category: z.string().default("general"),
  title: z.string(),
  notes: z.string().optional(),
  actionPlan: z.array(z.object({
    task: z.string(),
    completed: z.boolean().default(false),
  })).optional(),
  status: z.enum(["pending", "in_progress", "completed", "dismissed"]).default("pending"),
  dueDate: z.string().optional(),
});

export const coachingSessionSchema = insertCoachingSessionSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type InsertCoachingSession = z.infer<typeof insertCoachingSessionSchema>;
export type CoachingSession = z.infer<typeof coachingSessionSchema>;

// --- COACHING RECOMMENDATIONS ---
export type CoachingRecommendationRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  trigger: string;
  category: string;
  title: string;
  description?: string | null;
  severity: string;
  callIds?: string[] | null;
  metrics?: Record<string, unknown> | null;
  status: string;
  coachingSessionId?: string | null;
  createdAt?: string | null;
};

// --- COMBINED TYPES ---
export type CallWithDetails = Call & {
  employee?: Employee;
  transcript?: Transcript;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

/** Lightweight call summary for reporting — excludes transcript text/words to reduce memory */
export type CallSummary = Call & {
  employee?: Employee;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

export type DashboardMetrics = {
  totalCalls: number;
  avgSentiment: number;
  avgTranscriptionTime: number;
  avgPerformanceScore: number;
};

export type SentimentDistribution = {
  positive: number;
  neutral: number;
  negative: number;
};

export type TopPerformer = {
  id: string;
  name: string;
  role?: string;
  avgPerformanceScore: number | null;
  totalCalls: number;
};

/** Audit log entry shape for the audit log viewer */
export type AuditEntry = {
  timestamp?: string;
  event: string;
  orgId?: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
};

/** Authenticated user shape returned by /api/auth/me and stored in session */
export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  orgId: string;
  orgSlug: string;
  mfaEnabled?: boolean;
};
