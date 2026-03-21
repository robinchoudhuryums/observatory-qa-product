import {
  type User,
  type InsertUser,
  type Employee,
  type InsertEmployee,
  type Call,
  type InsertCall,
  type Transcript,
  type InsertTranscript,
  type SentimentAnalysis,
  type InsertSentimentAnalysis,
  type CallAnalysis,
  type InsertCallAnalysis,
  type CallWithDetails,
  type CallSummary,
  type DashboardMetrics,
  type SentimentDistribution,
  type TopPerformer,
  type AccessRequest,
  type InsertAccessRequest,
  type PromptTemplate,
  type InsertPromptTemplate,
  type CoachingSession,
  type InsertCoachingSession,
  type Organization,
  type InsertOrganization,
  type Invitation,
  type InsertInvitation,
  type ApiKey,
  type InsertApiKey,
  type Subscription,
  type InsertSubscription,
  type ReferenceDocument,
  type InsertReferenceDocument,
  type ABTest,
  type InsertABTest,
  type UsageRecord,
  type ClinicalNote,
  type LiveSession,
  type InsertLiveSession,
  type Feedback,
  type InsertFeedback,
  type EmployeeBadge,
  type InsuranceNarrative,
  type InsertInsuranceNarrative,
  type CallRevenue,
  type InsertCallRevenue,
  type CalibrationSession,
  type InsertCalibrationSession,
  type CalibrationEvaluation,
  type InsertCalibrationEvaluation,
  type LearningModule,
  type InsertLearningModule,
  type LearningPath,
  type InsertLearningPath,
  type LearningProgress,
  type InsertLearningProgress,
  type MarketingCampaign,
  type InsertMarketingCampaign,
  type CallAttribution,
  type InsertCallAttribution,
} from "@shared/schema";

/**
 * Run async tasks with bounded concurrency.
 * Avoids overwhelming S3/GCS with hundreds of simultaneous requests.
 */
export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Normalize a CallAnalysis for backward-compatibility with older stored data.
 * AI may return objects instead of arrays for topics/flags/actionItems.
 */
export function normalizeAnalysis(analysis: CallAnalysis): CallAnalysis;
export function normalizeAnalysis(analysis: CallAnalysis | undefined): CallAnalysis | undefined;
export function normalizeAnalysis(analysis: CallAnalysis | undefined): CallAnalysis | undefined {
  if (!analysis) return undefined;

  // Clamp a numeric value to a valid range, handling string/null/undefined
  const clamp = (v: unknown, min: number, max: number): number | undefined => {
    if (v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (isNaN(n)) return undefined;
    return Math.max(min, Math.min(max, n));
  };

  const normalized: CallAnalysis = {
    ...analysis,
    topics: Array.isArray(analysis.topics) ? analysis.topics : [],
    actionItems: Array.isArray(analysis.actionItems) ? analysis.actionItems : [],
    flags: Array.isArray(analysis.flags) ? analysis.flags : [],
    feedback: (analysis.feedback && typeof analysis.feedback === "object" && !Array.isArray(analysis.feedback))
      ? analysis.feedback
      : { strengths: [], suggestions: [] },
    summary: typeof analysis.summary === "string" ? analysis.summary : "",
  };

  // Clamp scores to valid ranges when present
  if (normalized.performanceScore !== undefined) {
    const clamped = clamp(normalized.performanceScore, 0, 10);
    normalized.performanceScore = clamped !== undefined ? String(clamped) : undefined;
  }
  if (normalized.subScores) {
    normalized.subScores = {
      compliance: clamp(normalized.subScores.compliance, 0, 10),
      customerExperience: clamp(normalized.subScores.customerExperience, 0, 10),
      communication: clamp(normalized.subScores.communication, 0, 10),
      resolution: clamp(normalized.subScores.resolution, 0, 10),
    };
  }

  return normalized;
}

/** Apply standard call filters (status, sentiment, employee) */
export function applyCallFilters<T extends { status?: string; employeeId?: string; sentiment?: { overallSentiment?: string } }>(
  calls: T[],
  filters: { status?: string; sentiment?: string; employee?: string }
): T[] {
  let result = calls;
  if (filters.status) result = result.filter((c) => c.status === filters.status);
  if (filters.sentiment) result = result.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
  if (filters.employee) result = result.filter((c) => c.employeeId === filters.employee);
  return result;
}

/** Common interface for GCS and S3 object storage clients */
export interface ObjectStorageClient {
  uploadJson(objectName: string, data: unknown): Promise<void>;
  uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<void>;
  downloadJson<T>(objectName: string): Promise<T | undefined>;
  downloadFile(objectName: string): Promise<Buffer | undefined>;
  listObjects(prefix: string): Promise<string[]>;
  listObjectsWithMetadata(prefix: string): Promise<Array<{ name: string; size: string; updated: string }>>;
  listAndDownloadJson<T>(prefix: string): Promise<T[]>;
  deleteObject(objectName: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

export interface IStorage {
  // Organization operations
  getOrganization(orgId: string): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization | undefined>;
  listOrganizations(): Promise<Organization[]>;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string, orgId?: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  listUsersByOrg(orgId: string): Promise<User[]>;
  updateUser(orgId: string, id: string, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(orgId: string, id: string): Promise<void>;

  // Employee operations (org-scoped)
  getEmployee(orgId: string, id: string): Promise<Employee | undefined>;
  getEmployeeByEmail(orgId: string, email: string): Promise<Employee | undefined>;
  createEmployee(orgId: string, employee: InsertEmployee): Promise<Employee>;
  updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee | undefined>;
  getAllEmployees(orgId: string): Promise<Employee[]>;

  // Call operations (org-scoped)
  getCall(orgId: string, id: string): Promise<Call | undefined>;
  createCall(orgId: string, call: InsertCall): Promise<Call>;
  updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call | undefined>;
  deleteCall(orgId: string, id: string): Promise<void>;
  getCallByFileHash(orgId: string, fileHash: string): Promise<Call | undefined>;
  getAllCalls(orgId: string): Promise<Call[]>;
  getCallsWithDetails(orgId: string, filters?: { status?: string; sentiment?: string; employee?: string; limit?: number; offset?: number }): Promise<CallWithDetails[]>;
  /** Lightweight version of getCallsWithDetails — excludes transcript text/words for reporting */
  getCallSummaries(orgId: string, filters?: { status?: string; sentiment?: string; employee?: string; limit?: number; offset?: number }): Promise<CallSummary[]>;

  // Transcript operations (org-scoped)
  getTranscript(orgId: string, callId: string): Promise<Transcript | undefined>;
  createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript>;
  updateTranscript(orgId: string, callId: string, updates: { text: string }): Promise<Transcript | undefined>;

  // Sentiment analysis operations (org-scoped)
  getSentimentAnalysis(orgId: string, callId: string): Promise<SentimentAnalysis | undefined>;
  createSentimentAnalysis(orgId: string, sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis>;

  // Call analysis operations (org-scoped)
  getCallAnalysis(orgId: string, callId: string): Promise<CallAnalysis | undefined>;
  createCallAnalysis(orgId: string, analysis: InsertCallAnalysis): Promise<CallAnalysis>;

  // Dashboard metrics (org-scoped)
  getDashboardMetrics(orgId: string): Promise<DashboardMetrics>;
  getSentimentDistribution(orgId: string): Promise<SentimentDistribution>;
  getTopPerformers(orgId: string, limit?: number): Promise<TopPerformer[]>;

  // Search and filtering (org-scoped)
  searchCalls(orgId: string, query: string): Promise<CallWithDetails[]>;

  // Clinical metrics (PostgreSQL-optimized, optional — returns undefined for non-PG backends)
  getClinicalCallMetrics?(orgId: string, clinicalCategories: string[]): Promise<{
    totalEncounters: number;
    completed: number;
    notesWithData: Array<{ clinicalNote: ClinicalNote | null; uploadedAt: string | null }>;
  }>;
  getAttestedClinicalNotes?(orgId: string, clinicalCategories: string[]): Promise<Array<{
    clinicalNote: ClinicalNote | null;
    uploadedAt: string | null;
  }>>;

  // Audio file operations (org-scoped)
  uploadAudio(orgId: string, callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void>;
  getAudioFiles(orgId: string, callId: string): Promise<string[]>;
  downloadAudio(orgId: string, objectName: string): Promise<Buffer | undefined>;

  // Access request operations (org-scoped)
  createAccessRequest(orgId: string, request: InsertAccessRequest): Promise<AccessRequest>;
  getAllAccessRequests(orgId: string): Promise<AccessRequest[]>;
  getAccessRequest(orgId: string, id: string): Promise<AccessRequest | undefined>;
  updateAccessRequest(orgId: string, id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined>;

  // Prompt template operations (org-scoped)
  getPromptTemplate(orgId: string, id: string): Promise<PromptTemplate | undefined>;
  getPromptTemplateByCategory(orgId: string, callCategory: string): Promise<PromptTemplate | undefined>;
  getAllPromptTemplates(orgId: string): Promise<PromptTemplate[]>;
  createPromptTemplate(orgId: string, template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(orgId: string, id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(orgId: string, id: string): Promise<void>;

  // Coaching session operations (org-scoped)
  createCoachingSession(orgId: string, session: InsertCoachingSession): Promise<CoachingSession>;
  getCoachingSession(orgId: string, id: string): Promise<CoachingSession | undefined>;
  getAllCoachingSessions(orgId: string): Promise<CoachingSession[]>;
  getCoachingSessionsByEmployee(orgId: string, employeeId: string): Promise<CoachingSession[]>;
  updateCoachingSession(orgId: string, id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined>;

  // Data retention (org-scoped)
  purgeExpiredCalls(orgId: string, retentionDays: number): Promise<number>;

  // Usage tracking (org-scoped)
  recordUsageEvent(event: { orgId: string; eventType: string; quantity: number; metadata?: Record<string, unknown> }): Promise<void>;
  getUsageSummary(orgId: string, startDate?: Date, endDate?: Date): Promise<UsageSummary[]>;

  // Invitation operations (org-scoped)
  createInvitation(orgId: string, invitation: InsertInvitation): Promise<Invitation>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  listInvitations(orgId: string): Promise<Invitation[]>;
  updateInvitation(orgId: string, id: string, updates: Partial<Invitation>): Promise<Invitation | undefined>;
  deleteInvitation(orgId: string, id: string): Promise<void>;

  // API key operations (org-scoped)
  createApiKey(orgId: string, apiKey: InsertApiKey): Promise<ApiKey>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  listApiKeys(orgId: string): Promise<ApiKey[]>;
  updateApiKey(orgId: string, id: string, updates: Partial<ApiKey>): Promise<ApiKey | undefined>;
  deleteApiKey(orgId: string, id: string): Promise<void>;

  // Subscription operations (org-scoped)
  getSubscription(orgId: string): Promise<Subscription | undefined>;
  getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined>;
  getSubscriptionByStripeSubId(stripeSubscriptionId: string): Promise<Subscription | undefined>;
  upsertSubscription(orgId: string, sub: InsertSubscription): Promise<Subscription>;
  updateSubscription(orgId: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;

  // Reference document operations (org-scoped)
  createReferenceDocument(orgId: string, doc: InsertReferenceDocument): Promise<ReferenceDocument>;
  getReferenceDocument(orgId: string, id: string): Promise<ReferenceDocument | undefined>;
  listReferenceDocuments(orgId: string): Promise<ReferenceDocument[]>;
  getReferenceDocumentsForCategory(orgId: string, callCategory: string): Promise<ReferenceDocument[]>;
  updateReferenceDocument(orgId: string, id: string, updates: Partial<ReferenceDocument>): Promise<ReferenceDocument | undefined>;
  deleteReferenceDocument(orgId: string, id: string): Promise<void>;

  // A/B test operations (org-scoped)
  createABTest(orgId: string, test: InsertABTest): Promise<ABTest>;
  getABTest(orgId: string, id: string): Promise<ABTest | undefined>;
  getAllABTests(orgId: string): Promise<ABTest[]>;
  updateABTest(orgId: string, id: string, updates: Partial<ABTest>): Promise<ABTest | undefined>;
  deleteABTest(orgId: string, id: string): Promise<void>;

  // Spend tracking / usage records (org-scoped)
  createUsageRecord(orgId: string, record: UsageRecord): Promise<void>;
  getUsageRecords(orgId: string): Promise<UsageRecord[]>;

  // Live session operations (org-scoped, real-time clinical recording)
  createLiveSession(orgId: string, session: InsertLiveSession): Promise<LiveSession>;
  getLiveSession(orgId: string, id: string): Promise<LiveSession | undefined>;
  updateLiveSession(orgId: string, id: string, updates: Partial<LiveSession>): Promise<LiveSession | undefined>;
  getActiveLiveSessions(orgId: string): Promise<LiveSession[]>;
  getLiveSessionsByUser(orgId: string, userId: string): Promise<LiveSession[]>;

  // Feedback operations (org-scoped)
  createFeedback(orgId: string, feedback: InsertFeedback): Promise<Feedback>;
  getFeedback(orgId: string, id: string): Promise<Feedback | undefined>;
  listFeedback(orgId: string, filters?: { type?: string; status?: string }): Promise<Feedback[]>;
  updateFeedback(orgId: string, id: string, updates: Partial<Feedback>): Promise<Feedback | undefined>;

  // Gamification operations (org-scoped)
  getEmployeeBadges(orgId: string, employeeId: string): Promise<EmployeeBadge[]>;
  awardBadge(orgId: string, badge: Omit<EmployeeBadge, "id">): Promise<EmployeeBadge>;
  getGamificationProfile(orgId: string, employeeId: string): Promise<{ totalPoints: number; currentStreak: number; longestStreak: number }>;
  updateGamificationProfile(orgId: string, employeeId: string, updates: { totalPoints?: number; currentStreak?: number; longestStreak?: number; lastActivityDate?: string }): Promise<void>;
  getLeaderboard(orgId: string, limit?: number): Promise<Array<{ employeeId: string; totalPoints: number; currentStreak: number; badgeCount: number }>>;

  // Insurance narrative operations (org-scoped)
  createInsuranceNarrative(orgId: string, narrative: InsertInsuranceNarrative): Promise<InsuranceNarrative>;
  getInsuranceNarrative(orgId: string, id: string): Promise<InsuranceNarrative | undefined>;
  listInsuranceNarratives(orgId: string, filters?: { callId?: string; status?: string }): Promise<InsuranceNarrative[]>;
  updateInsuranceNarrative(orgId: string, id: string, updates: Partial<InsuranceNarrative>): Promise<InsuranceNarrative | undefined>;
  deleteInsuranceNarrative(orgId: string, id: string): Promise<void>;

  // Call revenue operations (org-scoped)
  createCallRevenue(orgId: string, revenue: InsertCallRevenue): Promise<CallRevenue>;
  getCallRevenue(orgId: string, callId: string): Promise<CallRevenue | undefined>;
  listCallRevenues(orgId: string, filters?: { conversionStatus?: string }): Promise<CallRevenue[]>;
  updateCallRevenue(orgId: string, callId: string, updates: Partial<CallRevenue>): Promise<CallRevenue | undefined>;
  getRevenueMetrics(orgId: string): Promise<{ totalEstimated: number; totalActual: number; conversionRate: number; avgDealValue: number }>;

  // Calibration session operations (org-scoped)
  createCalibrationSession(orgId: string, session: InsertCalibrationSession): Promise<CalibrationSession>;
  getCalibrationSession(orgId: string, id: string): Promise<CalibrationSession | undefined>;
  listCalibrationSessions(orgId: string, filters?: { status?: string }): Promise<CalibrationSession[]>;
  updateCalibrationSession(orgId: string, id: string, updates: Partial<CalibrationSession>): Promise<CalibrationSession | undefined>;
  deleteCalibrationSession(orgId: string, id: string): Promise<void>;

  // Calibration evaluation operations (org-scoped)
  createCalibrationEvaluation(orgId: string, evaluation: InsertCalibrationEvaluation): Promise<CalibrationEvaluation>;
  getCalibrationEvaluations(orgId: string, sessionId: string): Promise<CalibrationEvaluation[]>;
  updateCalibrationEvaluation(orgId: string, id: string, updates: Partial<CalibrationEvaluation>): Promise<CalibrationEvaluation | undefined>;
  // Marketing attribution operations (org-scoped)
  createMarketingCampaign(orgId: string, campaign: InsertMarketingCampaign): Promise<MarketingCampaign>;
  getMarketingCampaign(orgId: string, id: string): Promise<MarketingCampaign | undefined>;
  listMarketingCampaigns(orgId: string, filters?: { source?: string; isActive?: boolean }): Promise<MarketingCampaign[]>;
  updateMarketingCampaign(orgId: string, id: string, updates: Partial<MarketingCampaign>): Promise<MarketingCampaign | undefined>;
  deleteMarketingCampaign(orgId: string, id: string): Promise<void>;

  createCallAttribution(orgId: string, attribution: InsertCallAttribution): Promise<CallAttribution>;
  getCallAttribution(orgId: string, callId: string): Promise<CallAttribution | undefined>;
  listCallAttributions(orgId: string, filters?: { source?: string; campaignId?: string }): Promise<CallAttribution[]>;
  updateCallAttribution(orgId: string, callId: string, updates: Partial<CallAttribution>): Promise<CallAttribution | undefined>;
  deleteCallAttribution(orgId: string, callId: string): Promise<void>;

  // LMS: Learning Module operations (org-scoped)
  createLearningModule(orgId: string, module: InsertLearningModule): Promise<LearningModule>;
  getLearningModule(orgId: string, id: string): Promise<LearningModule | undefined>;
  listLearningModules(orgId: string, filters?: { category?: string; contentType?: string; isPublished?: boolean }): Promise<LearningModule[]>;
  updateLearningModule(orgId: string, id: string, updates: Partial<LearningModule>): Promise<LearningModule | undefined>;
  deleteLearningModule(orgId: string, id: string): Promise<void>;

  // LMS: Learning Path operations (org-scoped)
  createLearningPath(orgId: string, path: InsertLearningPath): Promise<LearningPath>;
  getLearningPath(orgId: string, id: string): Promise<LearningPath | undefined>;
  listLearningPaths(orgId: string): Promise<LearningPath[]>;
  updateLearningPath(orgId: string, id: string, updates: Partial<LearningPath>): Promise<LearningPath | undefined>;
  deleteLearningPath(orgId: string, id: string): Promise<void>;

  // LMS: Learning Progress operations (org-scoped)
  upsertLearningProgress(orgId: string, progress: InsertLearningProgress): Promise<LearningProgress>;
  getLearningProgress(orgId: string, employeeId: string, moduleId: string): Promise<LearningProgress | undefined>;
  getEmployeeLearningProgress(orgId: string, employeeId: string): Promise<LearningProgress[]>;
  getModuleCompletionStats(orgId: string, moduleId: string): Promise<{ total: number; completed: number; inProgress: number; avgScore: number }>;
}

export interface UsageSummary {
  eventType: string;
  totalQuantity: number;
  eventCount: number;
}
