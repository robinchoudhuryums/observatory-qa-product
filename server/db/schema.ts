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
} from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
}, (t) => [
  uniqueIndex("users_username_idx").on(t.username),
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

// --- CALLS ---
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
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (t) => [
  index("calls_org_id_idx").on(t.orgId),
  index("calls_org_status_idx").on(t.orgId, t.status),
  index("calls_employee_id_idx").on(t.employeeId),
  index("calls_uploaded_at_idx").on(t.uploadedAt),
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
