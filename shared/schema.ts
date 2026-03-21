import { z } from "zod";

// --- ORGANIZATION SCHEMAS ---
export const orgBrandingSchema = z.object({
  appName: z.string().default("Observatory"),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(), // Hex color (e.g., "#10b981") to override default theme
  secondaryColor: z.string().optional(), // Hex color for accent/secondary elements
  onboardingCompleted: z.boolean().optional(),
});

export const INDUSTRY_TYPES = [
  { value: "contact_center", label: "Contact Center / Call Center" },
  { value: "healthcare", label: "Healthcare (General)" },
  { value: "dental", label: "Dental Practice" },
  { value: "behavioral_health", label: "Behavioral Health" },
  { value: "insurance", label: "Insurance" },
  { value: "financial", label: "Financial Services" },
  { value: "legal", label: "Legal" },
  { value: "veterinary", label: "Veterinary" },
  { value: "other", label: "Other" },
] as const;

export type IndustryType = typeof INDUSTRY_TYPES[number]["value"];

export const orgSettingsSchema = z.object({
  industryType: z.string().optional(),
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
  // EHR integration configuration
  ehrConfig: z.object({
    system: z.enum(["open_dental", "eaglesoft", "dentrix"]),
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    options: z.record(z.string()).optional(),
    enabled: z.boolean().default(false),
  }).optional(),
  // Provider-specific clinical note style preferences (self-learning feature)
  providerStylePreferences: z.record(z.string(), z.object({
    noteFormat: z.string().optional(),
    sectionOrder: z.array(z.string()).optional(),
    abbreviationLevel: z.enum(["minimal", "moderate", "heavy"]).optional(),
    includeNegativePertinents: z.boolean().optional(),
    defaultSpecialty: z.string().optional(),
    customSections: z.array(z.string()).optional(),
    templateOverrides: z.record(z.string()).optional(),
  })).optional(),
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
  orgId: z.string(),
  name: z.string(),
  role: z.string().optional(),
  email: z.string(),
  initials: z.string().max(2).optional(),
  status: z.enum(["Active", "Inactive"]).default("Active").optional(),
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

// --- COMMUNICATION CHANNELS ---
export const COMMUNICATION_CHANNELS = [
  { value: "voice", label: "Voice Call", description: "Audio call recording (transcribed by AssemblyAI)" },
  { value: "email", label: "Email", description: "Email message (text analyzed directly, no transcription cost)" },
  { value: "chat", label: "Chat", description: "Live chat or messaging conversation" },
  { value: "sms", label: "SMS", description: "Text message conversation" },
] as const;

export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number]["value"];

// --- CALL CATEGORY ---
export const CALL_CATEGORIES = [
  { value: "inbound", label: "Inbound Call", description: "Customer/patient calling into the company" },
  { value: "outbound", label: "Outbound Call", description: "Employee calling a customer/patient" },
  { value: "internal", label: "Internal", description: "Call between coworkers or departments" },
  { value: "vendor", label: "Vendor/Partner", description: "Call with an external vendor or partner" },
  { value: "clinical_encounter", label: "Clinical Encounter", description: "Doctor-patient clinical visit recording" },
  { value: "telemedicine", label: "Telemedicine Visit", description: "Remote telehealth consultation" },
  // Dental practice categories
  { value: "dental_scheduling", label: "Dental Scheduling", description: "Appointment scheduling, rescheduling, or cancellation call" },
  { value: "dental_insurance", label: "Dental Insurance", description: "Insurance verification, benefits explanation, or pre-authorization" },
  { value: "dental_treatment", label: "Dental Treatment Discussion", description: "Treatment plan discussion, acceptance, or financial arrangements" },
  { value: "dental_recall", label: "Dental Recall/Recare", description: "Recall or recare reminder call, hygiene appointment booking" },
  { value: "dental_emergency", label: "Dental Emergency Triage", description: "Emergency triage call — toothache, trauma, swelling" },
  { value: "dental_encounter", label: "Dental Clinical Encounter", description: "In-office dental visit or procedure recording" },
  { value: "dental_consultation", label: "Dental Consultation", description: "New patient consultation or second opinion" },
  // Email categories
  { value: "email_support", label: "Support Email", description: "Customer support or help request email" },
  { value: "email_billing", label: "Billing Email", description: "Billing inquiry, payment, or invoice-related email" },
  { value: "email_complaint", label: "Complaint Email", description: "Customer complaint or escalation email" },
  { value: "email_appointment", label: "Appointment Email", description: "Appointment request, confirmation, or scheduling email" },
  { value: "email_insurance", label: "Insurance Email", description: "Insurance inquiry, authorization, or claims email" },
  { value: "email_referral", label: "Referral Email", description: "Patient or customer referral communication" },
  { value: "email_followup", label: "Follow-up Email", description: "Post-service or post-appointment follow-up" },
  { value: "email_general", label: "General Email", description: "General inquiry or miscellaneous email" },
] as const;

// --- CLINICAL NOTE SCHEMAS ---
export const CLINICAL_SPECIALTIES = [
  { value: "primary_care", label: "Primary Care / Family Medicine" },
  { value: "internal_medicine", label: "Internal Medicine" },
  { value: "cardiology", label: "Cardiology" },
  { value: "dermatology", label: "Dermatology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "psychiatry", label: "Psychiatry / Behavioral Health" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "ob_gyn", label: "OB/GYN" },
  { value: "emergency", label: "Emergency Medicine" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "general", label: "General / Other" },
  // Dental specialties
  { value: "general_dentistry", label: "General Dentistry" },
  { value: "periodontics", label: "Periodontics" },
  { value: "endodontics", label: "Endodontics" },
  { value: "oral_surgery", label: "Oral & Maxillofacial Surgery" },
  { value: "orthodontics", label: "Orthodontics" },
  { value: "prosthodontics", label: "Prosthodontics" },
  { value: "pediatric_dentistry", label: "Pediatric Dentistry" },
] as const;

export const CLINICAL_NOTE_FORMATS = [
  { value: "soap", label: "SOAP Note", description: "Subjective, Objective, Assessment, Plan" },
  { value: "hpi_focused", label: "HPI-Focused", description: "Detailed History of Present Illness narrative" },
  { value: "procedure_note", label: "Procedure Note", description: "Procedural documentation" },
  { value: "progress_note", label: "Progress Note", description: "Follow-up visit documentation" },
  // Behavioral health note formats
  { value: "dap", label: "DAP Note", description: "Data, Assessment, Plan — common for therapy/counseling" },
  { value: "birp", label: "BIRP Note", description: "Behavior, Intervention, Response, Plan — behavioral health" },
  // Dental note formats
  { value: "dental_exam", label: "Dental Examination", description: "Comprehensive or periodic oral examination" },
  { value: "dental_operative", label: "Operative Note", description: "Restorative/operative procedure documentation" },
  { value: "dental_perio", label: "Periodontal Note", description: "Periodontal examination and treatment" },
  { value: "dental_endo", label: "Endodontic Note", description: "Root canal or endodontic procedure" },
  { value: "dental_ortho_progress", label: "Ortho Progress Note", description: "Orthodontic adjustment/progress visit" },
  { value: "dental_surgery", label: "Oral Surgery Note", description: "Extraction or oral surgery documentation" },
  { value: "dental_treatment_plan", label: "Treatment Plan", description: "Comprehensive treatment plan documentation" },
] as const;

export const clinicalNoteSchema = z.object({
  format: z.string().default("soap"),
  specialty: z.string().optional(),
  chiefComplaint: z.string().optional(),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.array(z.string()).optional(),
  hpiNarrative: z.string().optional(),
  reviewOfSystems: z.record(z.string()).optional(),
  differentialDiagnoses: z.array(z.string()).optional(),
  icd10Codes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  cptCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  prescriptions: z.array(z.object({
    medication: z.string(),
    dosage: z.string().optional(),
    instructions: z.string().optional(),
  })).optional(),
  followUp: z.string().optional(),
  documentationCompleteness: z.number().min(0).max(10).optional(),
  clinicalAccuracy: z.number().min(0).max(10).optional(),
  missingSections: z.array(z.string()).optional(),
  patientConsentObtained: z.boolean().optional(),
  providerAttested: z.boolean().default(false),
  // Optimistic locking for concurrent edit detection
  version: z.number().optional(),
  // Attestation & audit metadata (HIPAA-required)
  attestedBy: z.string().optional(),
  attestedById: z.string().optional(),
  attestedNpi: z.string().optional(),
  attestedAt: z.string().optional(),
  consentRecordedBy: z.string().optional(),
  consentRecordedAt: z.string().optional(),
  editHistory: z.array(z.object({
    editedBy: z.string(),
    editedAt: z.string(),
    fieldsChanged: z.array(z.string()),
  })).optional(),
  // Behavioral health (DAP/BIRP) fields
  data: z.string().optional(), // DAP: combined subjective/objective data
  behavior: z.string().optional(), // BIRP: observable client behaviors
  intervention: z.string().optional(), // BIRP: therapeutic interventions applied
  response: z.string().optional(), // BIRP: client's response to interventions
  // Validation warnings from server-side code/format validation
  validationWarnings: z.array(z.string()).optional(),
  // Dental-specific fields
  cdtCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  toothNumbers: z.array(z.string()).optional(),
  quadrants: z.array(z.string()).optional(),
  periodontalFindings: z.record(z.string()).optional(),
  treatmentPhases: z.array(z.object({
    phase: z.number(),
    description: z.string(),
    procedures: z.array(z.string()),
    estimatedCost: z.string().optional(),
  })).optional(),
});

export type ClinicalNote = z.infer<typeof clinicalNoteSchema>;

export type CallCategory = typeof CALL_CATEGORIES[number]["value"];

// --- CALL SCHEMAS ---
// "Call" is the universal interaction entity — supports voice calls, emails, chat, and SMS.
// Channel defaults to "voice" for backward compatibility. Email/chat/SMS skip transcription.
export const insertCallSchema = z.object({
  orgId: z.string(),
  employeeId: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  fileHash: z.string().optional(),
  status: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
  callCategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Multi-channel support (defaults to "voice" in storage layer for backward compatibility)
  channel: z.enum(["voice", "email", "chat", "sms"]).optional(),
  // Email-specific fields (populated when channel="email")
  emailSubject: z.string().optional(),
  emailFrom: z.string().optional(),
  emailTo: z.string().optional(),
  emailCc: z.string().optional(),
  emailBody: z.string().optional(),      // plain text body
  emailBodyHtml: z.string().optional(),  // HTML body (for display)
  emailMessageId: z.string().optional(), // external message ID (Gmail, Outlook, etc.)
  emailThreadId: z.string().optional(),  // thread/conversation grouping
  emailReceivedAt: z.string().optional(),
  // Chat/SMS fields (for future use)
  chatPlatform: z.string().optional(),   // "intercom", "zendesk", "twilio", etc.
  messageCount: z.number().optional(),   // number of messages in conversation
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
  orgId: z.string(),
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
  orgId: z.string(),
  callId: z.string(),
  overallSentiment: z.enum(["positive", "neutral", "negative"]).optional(),
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

// Speech analytics computed from word timing data
export const speechMetricsSchema = z.object({
  talkSpeedWpm: z.number().optional(),             // Words per minute
  deadAirSeconds: z.number().optional(),            // Total silence > 3s
  deadAirCount: z.number().optional(),              // Number of silence gaps > 3s
  longestDeadAirSeconds: z.number().optional(),     // Longest single silence
  interruptionCount: z.number().optional(),         // Times speakers overlapped
  fillerWordCount: z.number().optional(),           // "um", "uh", "like", "you know" etc.
  fillerWords: z.record(z.number()).optional(),      // Breakdown by filler word
  avgResponseTimeMs: z.number().optional(),         // Avg time between speaker turns
  talkListenRatio: z.number().optional(),           // Agent talk / total talk ratio
  speakerATalkPercent: z.number().optional(),       // Speaker A % of total talk time
  speakerBTalkPercent: z.number().optional(),       // Speaker B % of total talk time
});

export const insertCallAnalysisSchema = z.object({
  orgId: z.string(),
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
  clinicalNote: clinicalNoteSchema.optional(),
  speechMetrics: speechMetricsSchema.optional(),
  // Self-review: agent can review their own call
  selfReview: z.object({
    score: z.number().min(0).max(10).optional(),
    notes: z.string().optional(),
    reviewedAt: z.string().optional(),
    reviewedBy: z.string().optional(),
  }).optional(),
  // Score dispute: agent can dispute the QA score
  scoreDispute: z.object({
    status: z.enum(["open", "under_review", "accepted", "rejected"]),
    reason: z.string(),
    disputedBy: z.string(),
    disputedAt: z.string(),
    resolvedBy: z.string().optional(),
    resolvedAt: z.string().optional(),
    resolution: z.string().optional(),
    originalScore: z.number().optional(),
    adjustedScore: z.number().optional(),
  }).optional(),
  // Patient-facing visit summary (plain language)
  patientSummary: z.string().optional(),
  // AI-generated referral letter
  referralLetter: z.string().optional(),
  // Auto-suggested billing codes from transcript
  suggestedBillingCodes: z.object({
    cptCodes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
    icd10Codes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
    cdtCodes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
  }).optional(),
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
  orgId: z.string(),
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
  orgId: z.string(),
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
  orgId: z.string(),
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
export const PLAN_TIERS = ["free", "pro", "enterprise", "clinical"] as const;
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
  clinicalDocumentationEnabled: z.boolean().default(false),
  abTestingEnabled: z.boolean().default(false),
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
      clinicalDocumentationEnabled: false,
      abTestingEnabled: false,
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
      clinicalDocumentationEnabled: false,
      abTestingEnabled: true,
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
      clinicalDocumentationEnabled: false,
      abTestingEnabled: true,
    },
  },
  clinical: {
    name: "Clinical Documentation",
    description: "AI-powered clinical note drafting for healthcare providers",
    monthlyPriceUsd: 149,
    yearlyPriceUsd: 1428, // $119/mo billed yearly
    limits: {
      callsPerMonth: 500, // encounters per month
      storageMb: 5000,
      aiAnalysesPerMonth: 500,
      apiCallsPerMonth: 10000,
      maxUsers: 10,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: false,
      prioritySupport: true,
      clinicalDocumentationEnabled: true,
      abTestingEnabled: false,
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

// --- BEDROCK MODEL PRESETS (for A/B testing and admin model selection) ---
export const BEDROCK_MODEL_PRESETS = [
  { value: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Current)", cost: "$$" },
  { value: "us.anthropic.claude-sonnet-4-20250514", label: "Claude Sonnet 4", cost: "$$" },
  { value: "us.anthropic.claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", cost: "$" },
  { value: "anthropic.claude-3-haiku-20240307", label: "Claude 3 Haiku (Cheapest)", cost: "$" },
  { value: "anthropic.claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet v2", cost: "$$" },
] as const;

// --- A/B MODEL TEST SCHEMAS ---
export const insertABTestSchema = z.object({
  orgId: z.string(),
  fileName: z.string(),
  callCategory: z.string().optional(),
  baselineModel: z.string(),
  testModel: z.string(),
  status: z.enum(["processing", "analyzing", "completed", "failed"]).default("processing"),
  transcriptText: z.string().optional(),
  baselineAnalysis: z.record(z.unknown()).optional(),
  testAnalysis: z.record(z.unknown()).optional(),
  baselineLatencyMs: z.number().optional(),
  testLatencyMs: z.number().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
});

export const abTestSchema = insertABTestSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertABTest = z.infer<typeof insertABTestSchema>;
export type ABTest = z.infer<typeof abTestSchema>;

// --- SPEND TRACKING / USAGE RECORD SCHEMAS ---
export const usageRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  callId: z.string(),
  type: z.enum(["call", "ab-test"]),
  timestamp: z.string(),
  user: z.string(),
  services: z.object({
    assemblyai: z.object({
      durationSeconds: z.number().default(0),
      estimatedCost: z.number().default(0),
    }).optional(),
    bedrock: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
    bedrockSecondary: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
  }),
  totalEstimatedCost: z.number(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

// --- LIVE SESSION SCHEMAS (real-time clinical recording) ---
export const LIVE_SESSION_STATUSES = ["active", "paused", "completed", "failed"] as const;
export type LiveSessionStatus = typeof LIVE_SESSION_STATUSES[number];

export const insertLiveSessionSchema = z.object({
  orgId: z.string(),
  createdBy: z.string(),
  specialty: z.string().optional(),
  noteFormat: z.string().optional(),
  encounterType: z.string().optional(),
  status: z.enum(LIVE_SESSION_STATUSES).optional(),
  /** Accumulated final transcript segments */
  transcriptText: z.string().optional(),
  /** Latest draft clinical note (regenerated periodically) */
  draftClinicalNote: clinicalNoteSchema.optional(),
  /** Duration in seconds of accumulated audio */
  durationSeconds: z.number().optional(),
  /** Patient consent for recording */
  consentObtained: z.boolean().optional(),
  /** Associated call ID (created on session end for permanent storage) */
  callId: z.string().optional(),
});

export const liveSessionSchema = insertLiveSessionSchema.extend({
  id: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export type InsertLiveSession = z.infer<typeof insertLiveSessionSchema>;
export type LiveSession = z.infer<typeof liveSessionSchema>;

// --- ROLE DEFINITIONS ---
// Role hierarchy: super_admin (4) > admin (3) > manager (2) > viewer (1)
// super_admin is a platform-level role configured via the SUPER_ADMIN_USERS env var
// Format: username:password:displayName (comma-separated for multiple)
// Super admins are NOT scoped to any single org — they can manage ALL organizations.
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
  {
    value: "super_admin" as const,
    label: "Super Administrator",
    description: "Platform-level admin. Can manage ALL organizations, view platform-wide stats, and impersonate org admins for debugging.",
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
  orgId: z.string(),
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

// --- USER FEEDBACK SCHEMAS ---
export const FEEDBACK_TYPES = ["feature_rating", "bug_report", "suggestion", "nps", "general"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_CONTEXTS = [
  "dashboard", "transcripts", "upload", "coaching", "clinical", "search",
  "reports", "insights", "ab_testing", "spend_tracking", "ehr", "general",
] as const;
export type FeedbackContext = (typeof FEEDBACK_CONTEXTS)[number];

export const insertFeedbackSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  type: z.enum(FEEDBACK_TYPES),
  context: z.enum(FEEDBACK_CONTEXTS).optional(),
  rating: z.number().min(1).max(10).optional(), // 1-10 for feature ratings, 0-10 for NPS
  comment: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(), // page, feature name, browser, etc.
});

export const feedbackSchema = insertFeedbackSchema.extend({
  id: z.string(),
  status: z.enum(["new", "reviewed", "actioned", "dismissed"]).default("new"),
  adminResponse: z.string().optional(),
  createdAt: z.string().optional(),
});

export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;

// --- GAMIFICATION SCHEMAS ---
export const BADGE_DEFINITIONS = [
  // Performance badges
  { id: "first_call", name: "First Call", description: "Processed your first call", icon: "phone", category: "milestone" },
  { id: "ten_calls", name: "10 Calls", description: "Processed 10 calls", icon: "phone-forwarded", category: "milestone" },
  { id: "hundred_calls", name: "Century", description: "Processed 100 calls", icon: "trophy", category: "milestone" },
  { id: "perfect_score", name: "Perfect 10", description: "Achieved a perfect 10.0 score", icon: "star", category: "performance" },
  { id: "high_performer", name: "High Performer", description: "5+ calls with score above 9.0", icon: "award", category: "performance" },
  { id: "consistency_king", name: "Consistency King", description: "10 consecutive calls above 8.0", icon: "target", category: "performance" },
  // Improvement badges
  { id: "most_improved", name: "Most Improved", description: "Improved avg score by 2+ points in a month", icon: "trending-up", category: "improvement" },
  { id: "comeback_kid", name: "Comeback Kid", description: "Recovered from below 5.0 to above 8.0", icon: "refresh-cw", category: "improvement" },
  // Engagement badges
  { id: "self_reviewer", name: "Self Reviewer", description: "Completed 5 self-reviews", icon: "clipboard-check", category: "engagement" },
  { id: "coaching_champion", name: "Coaching Champion", description: "Completed 10 coaching sessions", icon: "book-open", category: "engagement" },
  { id: "streak_7", name: "Weekly Warrior", description: "7-day activity streak", icon: "flame", category: "streak" },
  { id: "streak_30", name: "Monthly Maven", description: "30-day activity streak", icon: "zap", category: "streak" },
] as const;

export type BadgeDefinition = typeof BADGE_DEFINITIONS[number];
export type BadgeId = typeof BADGE_DEFINITIONS[number]["id"];

export const employeeBadgeSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  employeeId: z.string(),
  badgeId: z.string(),
  awardedAt: z.string(),
  awardedFor: z.string().optional(), // specific call/event that triggered
});

export type EmployeeBadge = z.infer<typeof employeeBadgeSchema>;

export const gamificationProfileSchema = z.object({
  employeeId: z.string(),
  totalPoints: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  badges: z.array(employeeBadgeSchema),
  level: z.number(), // computed: points / 100
  rank: z.number().optional(), // position in org leaderboard
});

export type GamificationProfile = z.infer<typeof gamificationProfileSchema>;

export const leaderboardEntrySchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  totalPoints: z.number(),
  currentStreak: z.number(),
  badgeCount: z.number(),
  avgPerformanceScore: z.number(),
  totalCalls: z.number(),
  rank: z.number(),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

// --- INSURANCE NARRATIVE SCHEMAS ---
export const INSURANCE_LETTER_TYPES = [
  { value: "prior_auth", label: "Prior Authorization Request", description: "Request pre-approval for planned treatment" },
  { value: "appeal", label: "Insurance Appeal", description: "Appeal a denied claim with clinical justification" },
  { value: "predetermination", label: "Predetermination of Benefits", description: "Estimate insurance coverage before treatment" },
  { value: "medical_necessity", label: "Medical Necessity Letter", description: "Justify clinical need for specific treatment" },
  { value: "peer_to_peer", label: "Peer-to-Peer Review Summary", description: "Summary for peer-to-peer review with insurer" },
] as const;

export type InsuranceLetterType = typeof INSURANCE_LETTER_TYPES[number]["value"];

export const insertInsuranceNarrativeSchema = z.object({
  orgId: z.string(),
  callId: z.string().optional(), // linked clinical encounter
  patientName: z.string(),
  patientDob: z.string().optional(),
  memberId: z.string().optional(),
  insurerName: z.string(),
  insurerAddress: z.string().optional(),
  letterType: z.string(),
  diagnosisCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  procedureCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  clinicalJustification: z.string().optional(), // pulled from clinical note or manual
  priorDenialReference: z.string().optional(), // for appeals
  generatedNarrative: z.string().optional(), // AI-generated letter
  status: z.enum(["draft", "finalized", "submitted"]).default("draft"),
  createdBy: z.string(),
});

export const insuranceNarrativeSchema = insertInsuranceNarrativeSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertInsuranceNarrative = z.infer<typeof insertInsuranceNarrativeSchema>;
export type InsuranceNarrative = z.infer<typeof insuranceNarrativeSchema>;

// --- REVENUE TRACKING SCHEMAS ---
export const insertCallRevenueSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  estimatedRevenue: z.number().optional(), // dollar value estimated from call
  actualRevenue: z.number().optional(), // confirmed revenue (entered manually or from EHR)
  revenueType: z.enum(["production", "collection", "scheduled", "lost"]).optional(),
  treatmentValue: z.number().optional(), // total treatment plan value discussed
  scheduledProcedures: z.array(z.object({
    code: z.string(),
    description: z.string(),
    estimatedValue: z.number(),
  })).optional(),
  conversionStatus: z.enum(["converted", "pending", "lost", "unknown"]).default("unknown"),
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const callRevenueSchema = insertCallRevenueSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertCallRevenue = z.infer<typeof insertCallRevenueSchema>;
export type CallRevenue = z.infer<typeof callRevenueSchema>;

// --- CALIBRATION SESSION SCHEMAS ---
export const CALIBRATION_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export const insertCalibrationSessionSchema = z.object({
  orgId: z.string(),
  title: z.string(),
  callId: z.string(), // the call being evaluated
  facilitatorId: z.string(), // user who created/leads the session
  evaluatorIds: z.array(z.string()), // users participating
  scheduledAt: z.string().optional(),
  status: z.enum(CALIBRATION_STATUSES).default("scheduled"),
  targetScore: z.number().min(0).max(10).optional(), // "correct" score after discussion
  consensusNotes: z.string().optional(),
});

export const calibrationSessionSchema = insertCalibrationSessionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type InsertCalibrationSession = z.infer<typeof insertCalibrationSessionSchema>;
export type CalibrationSession = z.infer<typeof calibrationSessionSchema>;

export const insertCalibrationEvaluationSchema = z.object({
  orgId: z.string(),
  sessionId: z.string(),
  evaluatorId: z.string(),
  performanceScore: z.number().min(0).max(10),
  subScores: z.object({
    compliance: z.number().min(0).max(10).optional(),
    customerExperience: z.number().min(0).max(10).optional(),
    communication: z.number().min(0).max(10).optional(),
    resolution: z.number().min(0).max(10).optional(),
  }).optional(),
  notes: z.string().optional(),
});

export const calibrationEvaluationSchema = insertCalibrationEvaluationSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertCalibrationEvaluation = z.infer<typeof insertCalibrationEvaluationSchema>;
export type CalibrationEvaluation = z.infer<typeof calibrationEvaluationSchema>;

/** Calibration session with evaluations attached */
export type CalibrationSessionWithEvaluations = CalibrationSession & {
  evaluations: CalibrationEvaluation[];
  scoreVariance?: number; // standard deviation of evaluator scores
  call?: Call;
};

// --- LMS (LEARNING MANAGEMENT SYSTEM) SCHEMAS ---

export const LMS_CONTENT_TYPES = [
  { value: "article", label: "Article", description: "Text-based learning content" },
  { value: "quiz", label: "Quiz", description: "Knowledge assessment" },
  { value: "video", label: "Video", description: "Video learning content" },
  { value: "document", label: "Document", description: "Uploaded reference document" },
  { value: "ai_generated", label: "AI-Generated Module", description: "Auto-generated from reference docs" },
] as const;

export type LmsContentType = typeof LMS_CONTENT_TYPES[number]["value"];

export const LMS_CATEGORIES = [
  { value: "onboarding", label: "New Hire Onboarding" },
  { value: "compliance", label: "Compliance & HIPAA" },
  { value: "product_knowledge", label: "Product Knowledge" },
  { value: "call_handling", label: "Call Handling & Scripts" },
  { value: "insurance_basics", label: "Insurance Fundamentals" },
  { value: "clinical_terminology", label: "Clinical Terminology" },
  { value: "dental_codes", label: "Dental Codes & Procedures" },
  { value: "customer_service", label: "Customer Service Skills" },
  { value: "software_training", label: "Software & Tools Training" },
  { value: "leadership", label: "Leadership & Coaching" },
  { value: "general", label: "General Knowledge" },
] as const;

export type LmsCategory = typeof LMS_CATEGORIES[number]["value"];

// --- Learning Module (the content unit) ---
export const insertLearningModuleSchema = z.object({
  orgId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  contentType: z.string(), // article, quiz, video, document, ai_generated
  category: z.string().optional(),
  content: z.string().optional(), // markdown/HTML body for articles
  quizQuestions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()),
    correctIndex: z.number(),
    explanation: z.string().optional(),
  })).optional(),
  estimatedMinutes: z.number().optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  tags: z.array(z.string()).optional(),
  sourceDocumentId: z.string().optional(), // reference doc this was generated from
  isPublished: z.boolean().optional(),
  isPlatformContent: z.boolean().optional(), // true = Observatory-curated content
  createdBy: z.string(),
  sortOrder: z.number().optional(),
});

export const learningModuleSchema = insertLearningModuleSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningModule = z.infer<typeof insertLearningModuleSchema>;
export type LearningModule = z.infer<typeof learningModuleSchema>;

// --- Learning Path (ordered sequence of modules) ---
export const insertLearningPathSchema = z.object({
  orgId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  moduleIds: z.array(z.string()), // ordered list of module IDs
  isRequired: z.boolean().optional(), // required for all employees
  assignedTo: z.array(z.string()).optional(), // specific employee IDs (empty = all)
  estimatedMinutes: z.number().optional(), // total estimated time
  createdBy: z.string(),
});

export const learningPathSchema = insertLearningPathSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningPath = z.infer<typeof insertLearningPathSchema>;
export type LearningPath = z.infer<typeof learningPathSchema>;

// --- Employee Learning Progress ---
export const insertLearningProgressSchema = z.object({
  orgId: z.string(),
  employeeId: z.string(),
  moduleId: z.string(),
  pathId: z.string().optional(), // which learning path this is part of
  status: z.enum(["not_started", "in_progress", "completed"]).default("not_started"),
  quizScore: z.number().optional(), // 0-100 for quiz modules
  quizAttempts: z.number().optional(),
  timeSpentMinutes: z.number().optional(),
  completedAt: z.string().optional(),
  notes: z.string().optional(), // employee notes/reflections
});

export const learningProgressSchema = insertLearningProgressSchema.extend({
  id: z.string(),
  startedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningProgress = z.infer<typeof insertLearningProgressSchema>;
export type LearningProgress = z.infer<typeof learningProgressSchema>;

/** Learning module with progress for a specific employee */
export type LearningModuleWithProgress = LearningModule & {
  progress?: LearningProgress;
};

/** Learning path with all modules and their progress */
export type LearningPathWithModules = LearningPath & {
  modules: LearningModuleWithProgress[];
  completedCount: number;
  totalModules: number;
};

// --- MARKETING ATTRIBUTION SCHEMAS ---

export const MARKETING_SOURCES = [
  { value: "google_ads", label: "Google Ads", icon: "search" },
  { value: "facebook_ads", label: "Facebook/Meta Ads", icon: "share-2" },
  { value: "instagram", label: "Instagram", icon: "camera" },
  { value: "website", label: "Website", icon: "globe" },
  { value: "google_organic", label: "Google Organic", icon: "search" },
  { value: "yelp", label: "Yelp", icon: "star" },
  { value: "referral_patient", label: "Patient Referral", icon: "users" },
  { value: "referral_doctor", label: "Doctor Referral", icon: "user-plus" },
  { value: "walk_in", label: "Walk-In", icon: "map-pin" },
  { value: "phone_directory", label: "Phone Directory", icon: "phone" },
  { value: "direct_mail", label: "Direct Mail", icon: "mail" },
  { value: "email_campaign", label: "Email Campaign", icon: "mail" },
  { value: "sms_campaign", label: "SMS Campaign", icon: "message-square" },
  { value: "insurance_portal", label: "Insurance Portal", icon: "shield" },
  { value: "community_event", label: "Community Event", icon: "calendar" },
  { value: "social_organic", label: "Social Media (Organic)", icon: "share" },
  { value: "returning_patient", label: "Returning Patient", icon: "repeat" },
  { value: "unknown", label: "Unknown / Not Asked", icon: "help-circle" },
  { value: "other", label: "Other", icon: "more-horizontal" },
] as const;

export type MarketingSourceType = typeof MARKETING_SOURCES[number]["value"];

// Marketing campaign for grouping attribution data
export const insertMarketingCampaignSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  source: z.string(), // from MARKETING_SOURCES
  medium: z.string().optional(), // e.g., "cpc", "organic", "social", "referral"
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().optional(), // total campaign budget in dollars
  trackingCode: z.string().optional(), // UTM or tracking phone number
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
});

export const marketingCampaignSchema = insertMarketingCampaignSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;
export type MarketingCampaign = z.infer<typeof marketingCampaignSchema>;

// Attribution record — links a call to its marketing source
export const insertCallAttributionSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  source: z.string(), // from MARKETING_SOURCES
  campaignId: z.string().optional(), // linked campaign
  medium: z.string().optional(),
  isNewPatient: z.boolean().optional(),
  referrerName: z.string().optional(), // for referral sources
  detectionMethod: z.enum(["manual", "ai_detected", "tracking_number", "utm"]).optional(),
  confidence: z.number().optional(), // 0-1 for AI-detected
  notes: z.string().optional(),
  attributedBy: z.string().optional(),
});

export const callAttributionSchema = insertCallAttributionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertCallAttribution = z.infer<typeof insertCallAttributionSchema>;
export type CallAttribution = z.infer<typeof callAttributionSchema>;

/** Marketing metrics aggregated by source */
export type MarketingSourceMetrics = {
  source: string;
  totalCalls: number;
  newPatients: number;
  convertedCalls: number; // calls with revenue
  totalRevenue: number;
  avgPerformanceScore: number;
  costPerLead: number | null; // budget / totalCalls (if campaign has budget)
  roi: number | null; // (revenue - budget) / budget
};
