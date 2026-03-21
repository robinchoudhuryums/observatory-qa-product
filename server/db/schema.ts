/**
 * Drizzle ORM database schema for PostgreSQL.
 *
 * This replaces JSON-file-in-S3 storage with proper relational tables.
 * Audio files remain in S3; everything else lives in PostgreSQL for
 * efficient querying, indexing, and transactional integrity.
 */
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Custom pgvector type for storing embeddings.
 * Requires the pgvector extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      // pgvector returns "[1,2,3]" format
      return value
        .slice(1, -1)
        .split(",")
        .map(Number);
    },
  })(name);

// --- ORGANIZATIONS ---
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("organizations_slug_idx").on(t.slug),
]);

// --- USERS (database-backed, replaces AUTH_USERS env var) ---
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  username: varchar("username", { length: 100 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  isActive: boolean("is_active").notNull().default(true),
  // MFA (TOTP) fields — HIPAA recommended safeguard
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"), // Encrypted TOTP secret (AES-256-GCM)
  mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(), // Hashed backup codes
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
}, (t) => [
  uniqueIndex("users_org_username_idx").on(t.orgId, t.username),
  index("users_org_id_idx").on(t.orgId),
]);

// --- EMPLOYEES ---
export const employees = pgTable("employees", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }),
  initials: varchar("initials", { length: 5 }),
  status: varchar("status", { length: 20 }).default("Active"),
  subTeam: varchar("sub_team", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("employees_org_id_idx").on(t.orgId),
  uniqueIndex("employees_org_email_idx").on(t.orgId, t.email),
]);

// --- CALLS (universal interaction entity: voice, email, chat, SMS) ---
export const calls = pgTable("calls", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").references(() => employees.id),
  fileName: varchar("file_name", { length: 500 }),
  filePath: text("file_path"),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  duration: integer("duration"),
  assemblyAiId: varchar("assembly_ai_id", { length: 255 }),
  callCategory: varchar("call_category", { length: 50 }),
  tags: jsonb("tags").$type<string[]>(),
  fileHash: varchar("file_hash", { length: 64 }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  // Multi-channel support
  channel: varchar("channel", { length: 20 }).notNull().default("voice"),
  // Email-specific fields
  emailSubject: varchar("email_subject", { length: 1000 }),
  emailFrom: varchar("email_from", { length: 500 }),
  emailTo: varchar("email_to", { length: 500 }),
  emailCc: text("email_cc"),
  emailBody: text("email_body"),
  emailBodyHtml: text("email_body_html"),
  emailMessageId: varchar("email_message_id", { length: 500 }),
  emailThreadId: varchar("email_thread_id", { length: 500 }),
  emailReceivedAt: timestamp("email_received_at"),
  // Chat/SMS fields (future)
  chatPlatform: varchar("chat_platform", { length: 50 }),
  messageCount: integer("message_count"),
}, (t) => [
  index("calls_org_id_idx").on(t.orgId),
  index("calls_org_status_idx").on(t.orgId, t.status),
  index("calls_employee_id_idx").on(t.employeeId),
  index("calls_uploaded_at_idx").on(t.uploadedAt),
  index("calls_org_file_hash_idx").on(t.orgId, t.fileHash),
  index("calls_channel_idx").on(t.orgId, t.channel),
  index("calls_email_thread_idx").on(t.orgId, t.emailThreadId),
]);

// --- TRANSCRIPTS ---
export const transcripts = pgTable("transcripts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  text: text("text"),
  confidence: varchar("confidence", { length: 20 }),
  words: jsonb("words"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("transcripts_call_id_idx").on(t.callId),
  index("transcripts_org_id_idx").on(t.orgId),
]);

// --- SENTIMENT ANALYSES ---
export const sentimentAnalyses = pgTable("sentiment_analyses", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  overallSentiment: varchar("overall_sentiment", { length: 20 }),
  overallScore: varchar("overall_score", { length: 20 }),
  segments: jsonb("segments"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("sentiments_call_id_idx").on(t.callId),
  index("sentiments_org_id_idx").on(t.orgId),
]);

// --- CALL ANALYSES ---
export const callAnalyses = pgTable("call_analyses", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  performanceScore: varchar("performance_score", { length: 20 }),
  talkTimeRatio: varchar("talk_time_ratio", { length: 20 }),
  responseTime: varchar("response_time", { length: 20 }),
  keywords: jsonb("keywords").$type<string[]>(),
  topics: jsonb("topics").$type<string[]>(),
  summary: text("summary"),
  actionItems: jsonb("action_items").$type<string[]>(),
  feedback: jsonb("feedback"),
  lemurResponse: jsonb("lemur_response"),
  callPartyType: varchar("call_party_type", { length: 50 }),
  flags: jsonb("flags").$type<string[]>(),
  manualEdits: jsonb("manual_edits"),
  confidenceScore: varchar("confidence_score", { length: 20 }),
  confidenceFactors: jsonb("confidence_factors"),
  subScores: jsonb("sub_scores"),
  detectedAgentName: varchar("detected_agent_name", { length: 255 }),
  clinicalNote: jsonb("clinical_note"),
  speechMetrics: jsonb("speech_metrics"),
  selfReview: jsonb("self_review"),
  scoreDispute: jsonb("score_dispute"),
  patientSummary: text("patient_summary"),
  referralLetter: text("referral_letter"),
  suggestedBillingCodes: jsonb("suggested_billing_codes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("analyses_call_id_idx").on(t.callId),
  index("analyses_org_id_idx").on(t.orgId),
  index("analyses_performance_idx").on(t.orgId, t.performanceScore),
]);

// --- ACCESS REQUESTS ---
export const accessRequests = pgTable("access_requests", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  reason: text("reason"),
  requestedRole: varchar("requested_role", { length: 20 }).notNull().default("viewer"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("access_requests_org_id_idx").on(t.orgId),
  index("access_requests_status_idx").on(t.orgId, t.status),
]);

// --- PROMPT TEMPLATES ---
export const promptTemplates = pgTable("prompt_templates", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callCategory: varchar("call_category", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  evaluationCriteria: text("evaluation_criteria").notNull(),
  requiredPhrases: jsonb("required_phrases"),
  scoringWeights: jsonb("scoring_weights"),
  additionalInstructions: text("additional_instructions"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by", { length: 255 }),
}, (t) => [
  index("prompt_templates_org_id_idx").on(t.orgId),
  index("prompt_templates_org_category_idx").on(t.orgId, t.callCategory),
]);

// --- COACHING SESSIONS ---
export const coachingSessions = pgTable("coaching_sessions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  callId: text("call_id").references(() => calls.id),
  assignedBy: varchar("assigned_by", { length: 255 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  title: varchar("title", { length: 500 }).notNull(),
  notes: text("notes"),
  actionPlan: jsonb("action_plan"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("coaching_org_id_idx").on(t.orgId),
  index("coaching_employee_id_idx").on(t.employeeId),
  index("coaching_status_idx").on(t.orgId, t.status),
]);

// --- COACHING RECOMMENDATIONS (auto-generated) ---
export const coachingRecommendations = pgTable("coaching_recommendations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  trigger: varchar("trigger", { length: 100 }).notNull(), // e.g. "low_compliance", "negative_sentiment_trend"
  category: varchar("category", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).notNull().default("medium"), // low, medium, high
  callIds: jsonb("call_ids"), // array of call IDs that triggered this
  metrics: jsonb("metrics"), // snapshot of metrics at time of recommendation
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, dismissed
  coachingSessionId: text("coaching_session_id").references(() => coachingSessions.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("coaching_rec_org_id_idx").on(t.orgId),
  index("coaching_rec_employee_idx").on(t.orgId, t.employeeId),
  index("coaching_rec_status_idx").on(t.orgId, t.status),
]);

// --- API KEYS ---
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 128 }).notNull(), // SHA-256 hex
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(), // e.g., "obs_k_ab12cd34"
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("api_keys_hash_idx").on(t.keyHash),
  index("api_keys_org_id_idx").on(t.orgId),
]);

// --- INVITATIONS ---
export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  token: varchar("token", { length: 255 }).notNull(),
  invitedBy: varchar("invited_by", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("invitations_token_idx").on(t.token),
  index("invitations_org_id_idx").on(t.orgId),
  index("invitations_email_idx").on(t.orgId, t.email),
]);

// --- SUBSCRIPTIONS ---
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  planTier: varchar("plan_tier", { length: 20 }).notNull().default("free"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  billingInterval: varchar("billing_interval", { length: 10 }).notNull().default("monthly"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("subscriptions_org_id_idx").on(t.orgId),
  index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId),
  index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
]);

// --- REFERENCE DOCUMENTS ---
export const referenceDocuments = pgTable("reference_documents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text"),
  appliesTo: jsonb("applies_to"), // string[]
  isActive: boolean("is_active").notNull().default(true),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("ref_docs_org_id_idx").on(t.orgId),
  index("ref_docs_category_idx").on(t.orgId, t.category),
]);

// --- DOCUMENT CHUNKS (pgvector-powered RAG) ---
export const documentChunks = pgTable("document_chunks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  documentId: text("document_id").notNull().references(() => referenceDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  sectionHeader: varchar("section_header", { length: 500 }),
  tokenCount: integer("token_count").notNull(),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  embedding: vector("embedding", 1024), // Amazon Titan Embed V2 — 1024 dimensions
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("doc_chunks_org_id_idx").on(t.orgId),
  index("doc_chunks_document_id_idx").on(t.documentId),
]);

// --- PASSWORD RESET TOKENS ---
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(), // SHA-256 hashed
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("password_reset_user_idx").on(t.userId),
  uniqueIndex("password_reset_token_hash_idx").on(t.tokenHash),
]);

// --- USAGE EVENTS (per-org metering for billing) ---
export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  eventType: varchar("event_type", { length: 50 }).notNull(), // 'transcription', 'ai_analysis', 'storage_mb'
  quantity: real("quantity").notNull().default(1),
  metadata: jsonb("metadata"), // e.g., { callId, model, durationSeconds }
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("usage_org_type_idx").on(t.orgId, t.eventType),
  index("usage_created_at_idx").on(t.createdAt),
]);

// --- A/B TESTS ---
export const abTests = pgTable("ab_tests", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  callCategory: varchar("call_category", { length: 50 }),
  baselineModel: varchar("baseline_model", { length: 255 }).notNull(),
  testModel: varchar("test_model", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("processing"),
  transcriptText: text("transcript_text"),
  baselineAnalysis: jsonb("baseline_analysis"),
  testAnalysis: jsonb("test_analysis"),
  baselineLatencyMs: integer("baseline_latency_ms"),
  testLatencyMs: integer("test_latency_ms"),
  notes: text("notes"),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("ab_tests_org_id_idx").on(t.orgId),
  index("ab_tests_status_idx").on(t.orgId, t.status),
]);

// --- SPEND RECORDS (detailed per-call cost tracking) ---
export const spendRecords = pgTable("spend_records", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'call' | 'ab-test'
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  userName: varchar("user_name", { length: 255 }).notNull(),
  services: jsonb("services").notNull(), // { assemblyai, bedrock, bedrockSecondary }
  totalEstimatedCost: real("total_estimated_cost").notNull().default(0),
}, (t) => [
  index("spend_records_org_id_idx").on(t.orgId),
  index("spend_records_timestamp_idx").on(t.orgId, t.timestamp),
]);

// --- LIVE SESSIONS (real-time clinical recording) ---
export const liveSessions = pgTable("live_sessions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  specialty: varchar("specialty", { length: 100 }),
  noteFormat: varchar("note_format", { length: 50 }).notNull().default("soap"),
  encounterType: varchar("encounter_type", { length: 50 }).notNull().default("clinical_encounter"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  transcriptText: text("transcript_text").default(""),
  draftClinicalNote: jsonb("draft_clinical_note"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  consentObtained: boolean("consent_obtained").notNull().default(false),
  callId: text("call_id").references(() => calls.id),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
}, (t) => [
  index("live_sessions_org_id_idx").on(t.orgId),
  index("live_sessions_status_idx").on(t.orgId, t.status),
  index("live_sessions_created_by_idx").on(t.orgId, t.createdBy),
]);

// --- USER FEEDBACK ---
export const feedbacks = pgTable("feedbacks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull(),
  type: varchar("type", { length: 30 }).notNull(), // feature_rating, bug_report, suggestion, nps, general
  context: varchar("context", { length: 50 }), // which page/feature
  rating: integer("rating"), // 1-10
  comment: text("comment"),
  metadata: jsonb("metadata"),
  status: varchar("status", { length: 20 }).notNull().default("new"),
  adminResponse: text("admin_response"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("feedbacks_org_id_idx").on(t.orgId),
  index("feedbacks_type_idx").on(t.orgId, t.type),
  index("feedbacks_created_at_idx").on(t.orgId, t.createdAt),
]);

// --- GAMIFICATION: EMPLOYEE BADGES ---
export const employeeBadges = pgTable("employee_badges", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  badgeId: varchar("badge_id", { length: 50 }).notNull(),
  awardedAt: timestamp("awarded_at").defaultNow(),
  awardedFor: text("awarded_for"), // callId or event description
}, (t) => [
  index("employee_badges_org_idx").on(t.orgId),
  index("employee_badges_employee_idx").on(t.orgId, t.employeeId),
  uniqueIndex("employee_badges_unique_idx").on(t.orgId, t.employeeId, t.badgeId),
]);

// --- GAMIFICATION: POINTS/STREAKS ---
export const gamificationProfiles = pgTable("gamification_profiles", {
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  totalPoints: integer("total_points").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActivityDate: varchar("last_activity_date", { length: 10 }), // YYYY-MM-DD
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("gamification_profiles_pk_idx").on(t.orgId, t.employeeId),
  index("gamification_profiles_points_idx").on(t.orgId, t.totalPoints),
]);

// --- INSURANCE NARRATIVES ---
export const insuranceNarratives = pgTable("insurance_narratives", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").references(() => calls.id),
  patientName: varchar("patient_name", { length: 255 }).notNull(),
  patientDob: varchar("patient_dob", { length: 20 }),
  memberId: varchar("member_id", { length: 100 }),
  insurerName: varchar("insurer_name", { length: 255 }).notNull(),
  insurerAddress: text("insurer_address"),
  letterType: varchar("letter_type", { length: 50 }).notNull(),
  diagnosisCodes: jsonb("diagnosis_codes"),
  procedureCodes: jsonb("procedure_codes"),
  clinicalJustification: text("clinical_justification"),
  priorDenialReference: text("prior_denial_reference"),
  generatedNarrative: text("generated_narrative"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("insurance_narratives_org_idx").on(t.orgId),
  index("insurance_narratives_call_idx").on(t.orgId, t.callId),
  index("insurance_narratives_status_idx").on(t.orgId, t.status),
]);

// --- CALL REVENUE TRACKING ---
export const callRevenues = pgTable("call_revenues", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull().references(() => calls.id),
  estimatedRevenue: real("estimated_revenue"),
  actualRevenue: real("actual_revenue"),
  revenueType: varchar("revenue_type", { length: 20 }),
  treatmentValue: real("treatment_value"),
  scheduledProcedures: jsonb("scheduled_procedures"),
  conversionStatus: varchar("conversion_status", { length: 20 }).notNull().default("unknown"),
  notes: text("notes"),
  updatedBy: varchar("updated_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("call_revenues_org_idx").on(t.orgId),
  uniqueIndex("call_revenues_call_idx").on(t.orgId, t.callId),
  index("call_revenues_conversion_idx").on(t.orgId, t.conversionStatus),
]);

// --- CALIBRATION SESSIONS ---
export const calibrationSessions = pgTable("calibration_sessions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  title: varchar("title", { length: 500 }).notNull(),
  callId: text("call_id").notNull().references(() => calls.id),
  facilitatorId: text("facilitator_id").notNull(),
  evaluatorIds: jsonb("evaluator_ids").$type<string[]>().notNull(),
  scheduledAt: timestamp("scheduled_at"),
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  targetScore: real("target_score"),
  consensusNotes: text("consensus_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("calibration_sessions_org_idx").on(t.orgId),
  index("calibration_sessions_status_idx").on(t.orgId, t.status),
]);

// --- CALIBRATION EVALUATIONS ---
export const calibrationEvaluations = pgTable("calibration_evaluations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  sessionId: text("session_id").notNull().references(() => calibrationSessions.id, { onDelete: "cascade" }),
  evaluatorId: text("evaluator_id").notNull(),
  performanceScore: real("performance_score").notNull(),
  subScores: jsonb("sub_scores"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("calibration_evals_session_idx").on(t.sessionId),
  uniqueIndex("calibration_evals_unique_idx").on(t.sessionId, t.evaluatorId),
]);

// --- LMS: LEARNING MODULES ---
export const learningModules = pgTable("learning_modules", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  contentType: varchar("content_type", { length: 30 }).notNull(),
  category: varchar("category", { length: 50 }),
  content: text("content"), // markdown/HTML
  quizQuestions: jsonb("quiz_questions"),
  estimatedMinutes: integer("estimated_minutes"),
  difficulty: varchar("difficulty", { length: 20 }),
  tags: jsonb("tags").$type<string[]>(),
  sourceDocumentId: text("source_document_id"),
  isPublished: boolean("is_published").notNull().default(false),
  isPlatformContent: boolean("is_platform_content").notNull().default(false),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("learning_modules_org_idx").on(t.orgId),
  index("learning_modules_category_idx").on(t.orgId, t.category),
  index("learning_modules_published_idx").on(t.orgId, t.isPublished),
]);

// --- LMS: LEARNING PATHS ---
export const learningPaths = pgTable("learning_paths", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }),
  moduleIds: jsonb("module_ids").$type<string[]>().notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  assignedTo: jsonb("assigned_to").$type<string[]>(),
  estimatedMinutes: integer("estimated_minutes"),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("learning_paths_org_idx").on(t.orgId),
  index("learning_paths_category_idx").on(t.orgId, t.category),
]);

// --- LMS: EMPLOYEE LEARNING PROGRESS ---
export const learningProgress = pgTable("learning_progress", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  moduleId: text("module_id").notNull(),
  pathId: text("path_id"),
  status: varchar("status", { length: 20 }).notNull().default("not_started"),
  quizScore: integer("quiz_score"),
  quizAttempts: integer("quiz_attempts"),
  timeSpentMinutes: integer("time_spent_minutes"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  startedAt: timestamp("started_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("learning_progress_org_idx").on(t.orgId),
  index("learning_progress_employee_idx").on(t.orgId, t.employeeId),
  uniqueIndex("learning_progress_unique_idx").on(t.orgId, t.employeeId, t.moduleId),
]);

// --- MARKETING CAMPAIGNS ---
export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 500 }).notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  medium: varchar("medium", { length: 50 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  budget: real("budget"),
  trackingCode: varchar("tracking_code", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("marketing_campaigns_org_idx").on(t.orgId),
  index("marketing_campaigns_source_idx").on(t.orgId, t.source),
]);

// --- CALL ATTRIBUTION ---
export const callAttributions = pgTable("call_attributions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 50 }).notNull(),
  campaignId: text("campaign_id").references(() => marketingCampaigns.id),
  medium: varchar("medium", { length: 50 }),
  isNewPatient: boolean("is_new_patient"),
  referrerName: varchar("referrer_name", { length: 255 }),
  detectionMethod: varchar("detection_method", { length: 30 }),
  confidence: real("confidence"),
  notes: text("notes"),
  attributedBy: varchar("attributed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("call_attributions_org_idx").on(t.orgId),
  uniqueIndex("call_attributions_call_idx").on(t.orgId, t.callId),
  index("call_attributions_source_idx").on(t.orgId, t.source),
  index("call_attributions_campaign_idx").on(t.orgId, t.campaignId),
]);

// --- AUDIT LOGS (append-only, tamper-evident, HIPAA compliance) ---
export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  event: varchar("event", { length: 100 }).notNull(),
  userId: text("user_id"),
  username: varchar("username", { length: 100 }),
  role: varchar("role", { length: 20 }),
  resourceType: varchar("resource_type", { length: 50 }).notNull(),
  resourceId: text("resource_id"),
  ip: varchar("ip", { length: 45 }),
  userAgent: text("user_agent"),
  detail: text("detail"),
  // Tamper-evident hash chain: SHA-256(prevHash + entryData)
  // If any row is modified or deleted, the chain breaks and verification fails
  integrityHash: varchar("integrity_hash", { length: 64 }),
  prevHash: varchar("prev_hash", { length: 64 }),
  sequenceNum: integer("sequence_num"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("audit_logs_org_idx").on(t.orgId, t.createdAt),
  index("audit_logs_event_idx").on(t.orgId, t.event),
  index("audit_logs_user_idx").on(t.orgId, t.userId),
  index("audit_logs_sequence_idx").on(t.orgId, t.sequenceNum),
]);
