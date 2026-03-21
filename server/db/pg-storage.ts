/**
 * PostgreSQL storage backend implementing IStorage.
 *
 * Replaces S3 JSON files with proper relational queries for all
 * structured data. Audio files remain in S3 via a separate ObjectStorageClient.
 *
 * Benefits over CloudStorage:
 * - O(1) lookups instead of downloading JSON files
 * - SQL-level filtering, sorting, pagination
 * - Transactional integrity
 * - Full-text search via PostgreSQL (no need to load all transcripts into memory)
 * - Proper indexing for dashboard metrics
 */
import { eq, and, or, desc, sql, ilike, lt, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Database } from "./index";
import type { ObjectStorageClient } from "../storage";
import type { IStorage } from "../storage";
import type {
  User, InsertUser,
  Employee, InsertEmployee,
  Call, InsertCall,
  Transcript, InsertTranscript,
  SentimentAnalysis, InsertSentimentAnalysis,
  CallAnalysis, InsertCallAnalysis,
  CallWithDetails, CallSummary, DashboardMetrics, SentimentDistribution, TopPerformer,
  AccessRequest, InsertAccessRequest,
  PromptTemplate, InsertPromptTemplate,
  CoachingSession, InsertCoachingSession,
  Organization, InsertOrganization,
  Invitation, InsertInvitation,
  ApiKey, InsertApiKey,
  Subscription, InsertSubscription,
  ReferenceDocument, InsertReferenceDocument,
  ABTest, InsertABTest,
  UsageRecord,
  LiveSession, InsertLiveSession,
  Feedback, InsertFeedback,
  EmployeeBadge,
  InsuranceNarrative, InsertInsuranceNarrative,
  CallRevenue, InsertCallRevenue,
  CalibrationSession, InsertCalibrationSession,
  CalibrationEvaluation, InsertCalibrationEvaluation,
  LearningModule, InsertLearningModule,
  LearningPath, InsertLearningPath,
  LearningProgress, InsertLearningProgress,
  MarketingCampaign, InsertMarketingCampaign,
  CallAttribution, InsertCallAttribution,
} from "@shared/schema";
import * as tables from "./schema";
import { normalizeAnalysis } from "../storage";
import { logger } from "../services/logger";

/**
 * Convert a Drizzle row (with Date objects for timestamps)
 * to the app's format (ISO strings for timestamps).
 */
function toISOString(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

export class PostgresStorage implements IStorage {
  private db: Database;
  private blobClient: ObjectStorageClient | null;

  /**
   * @param db - Drizzle database instance
   * @param blobClient - Optional S3/GCS client for audio file storage
   */
  constructor(db: Database, blobClient: ObjectStorageClient | null = null) {
    this.db = db;
    this.blobClient = blobClient;
  }

  // --- Organization operations ---
  async getOrganization(orgId: string): Promise<Organization | undefined> {
    const rows = await this.db.select().from(tables.organizations).where(eq(tables.organizations.id, orgId)).limit(1);
    return rows[0] ? this.mapOrg(rows[0]) : undefined;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const rows = await this.db.select().from(tables.organizations).where(eq(tables.organizations.slug, slug)).limit(1);
    return rows[0] ? this.mapOrg(rows[0]) : undefined;
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.organizations).values({
      id,
      name: org.name,
      slug: org.slug,
      status: org.status || "active",
      settings: org.settings || null,
    }).returning();
    return this.mapOrg(row);
  }

  async updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const [row] = await this.db.update(tables.organizations)
      .set({
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.slug !== undefined ? { slug: updates.slug } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.settings !== undefined ? { settings: updates.settings } : {}),
      })
      .where(eq(tables.organizations.id, orgId))
      .returning();
    return row ? this.mapOrg(row) : undefined;
  }

  async listOrganizations(): Promise<Organization[]> {
    const rows = await this.db.select().from(tables.organizations);
    return rows.map((r) => this.mapOrg(r));
  }

  // --- User operations ---
  async getUser(id: string): Promise<User | undefined> {
    const rows = await this.db.select().from(tables.users).where(eq(tables.users.id, id)).limit(1);
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  async getUserByUsername(username: string, orgId?: string): Promise<User | undefined> {
    const conditions = [eq(tables.users.username, username)];
    if (orgId) conditions.push(eq(tables.users.orgId, orgId));
    const rows = await this.db.select().from(tables.users).where(and(...conditions)).limit(1);
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.users).values({
      id,
      orgId: user.orgId || "",
      username: user.username,
      passwordHash: user.passwordHash,
      name: user.name,
      role: user.role || "viewer",
    }).returning();
    return this.mapUser(row);
  }

  async listUsersByOrg(orgId: string): Promise<User[]> {
    const rows = await this.db.select().from(tables.users)
      .where(eq(tables.users.orgId, orgId));
    return rows.map((r) => this.mapUser(r));
  }

  async updateUser(orgId: string, id: string, updates: Partial<User>): Promise<User | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.role !== undefined) setClause.role = updates.role;
    if (updates.passwordHash !== undefined) setClause.passwordHash = updates.passwordHash;

    if (Object.keys(setClause).length === 0) return this.getUser(id);

    const [row] = await this.db.update(tables.users)
      .set(setClause)
      .where(and(eq(tables.users.id, id), eq(tables.users.orgId, orgId)))
      .returning();
    return row ? this.mapUser(row) : undefined;
  }

  async deleteUser(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.users)
      .where(and(eq(tables.users.id, id), eq(tables.users.orgId, orgId)));
  }

  // --- Employee operations ---
  async getEmployee(orgId: string, id: string): Promise<Employee | undefined> {
    const rows = await this.db.select().from(tables.employees)
      .where(and(eq(tables.employees.id, id), eq(tables.employees.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapEmployee(rows[0]) : undefined;
  }

  async getEmployeeByEmail(orgId: string, email: string): Promise<Employee | undefined> {
    const rows = await this.db.select().from(tables.employees)
      .where(and(eq(tables.employees.orgId, orgId), eq(tables.employees.email, email)))
      .limit(1);
    return rows[0] ? this.mapEmployee(rows[0]) : undefined;
  }

  async createEmployee(orgId: string, employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.employees).values({
      id,
      orgId,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      initials: employee.initials,
      status: employee.status || "Active",
      subTeam: employee.subTeam,
    }).returning();
    return this.mapEmployee(row);
  }

  async updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const [row] = await this.db.update(tables.employees)
      .set({
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.email !== undefined ? { email: updates.email } : {}),
        ...(updates.role !== undefined ? { role: updates.role } : {}),
        ...(updates.initials !== undefined ? { initials: updates.initials } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.subTeam !== undefined ? { subTeam: updates.subTeam } : {}),
      })
      .where(and(eq(tables.employees.id, id), eq(tables.employees.orgId, orgId)))
      .returning();
    return row ? this.mapEmployee(row) : undefined;
  }

  async getAllEmployees(orgId: string): Promise<Employee[]> {
    const rows = await this.db.select().from(tables.employees).where(eq(tables.employees.orgId, orgId));
    return rows.map((r) => this.mapEmployee(r));
  }

  // --- Call operations ---
  async getCall(orgId: string, id: string): Promise<Call | undefined> {
    const rows = await this.db.select().from(tables.calls)
      .where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : undefined;
  }

  async createCall(orgId: string, call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.calls).values({
      id,
      orgId,
      employeeId: call.employeeId,
      fileName: call.fileName,
      filePath: call.filePath,
      status: call.status || "pending",
      duration: call.duration,
      assemblyAiId: call.assemblyAiId,
      callCategory: call.callCategory,
      tags: call.tags || null,
      channel: call.channel || "voice",
      emailSubject: call.emailSubject,
      emailFrom: call.emailFrom,
      emailTo: call.emailTo,
      emailCc: call.emailCc,
      emailBody: call.emailBody,
      emailBodyHtml: call.emailBodyHtml,
      emailMessageId: call.emailMessageId,
      emailThreadId: call.emailThreadId,
      emailReceivedAt: call.emailReceivedAt ? new Date(call.emailReceivedAt) : undefined,
      chatPlatform: call.chatPlatform,
      messageCount: call.messageCount,
    }).returning();
    return this.mapCall(row);
  }

  async updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.employeeId !== undefined) setClause.employeeId = updates.employeeId;
    if (updates.fileName !== undefined) setClause.fileName = updates.fileName;
    if (updates.filePath !== undefined) setClause.filePath = updates.filePath;
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.duration !== undefined) setClause.duration = updates.duration;
    if (updates.assemblyAiId !== undefined) setClause.assemblyAiId = updates.assemblyAiId;
    if (updates.callCategory !== undefined) setClause.callCategory = updates.callCategory;
    if (updates.tags !== undefined) setClause.tags = updates.tags;
    if (updates.channel !== undefined) setClause.channel = updates.channel;
    if (updates.emailSubject !== undefined) setClause.emailSubject = updates.emailSubject;
    if (updates.emailFrom !== undefined) setClause.emailFrom = updates.emailFrom;
    if (updates.emailTo !== undefined) setClause.emailTo = updates.emailTo;
    if (updates.emailBody !== undefined) setClause.emailBody = updates.emailBody;
    if (updates.emailThreadId !== undefined) setClause.emailThreadId = updates.emailThreadId;

    const [row] = await this.db.update(tables.calls)
      .set(setClause)
      .where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)))
      .returning();
    return row ? this.mapCall(row) : undefined;
  }

  async deleteCall(orgId: string, id: string): Promise<void> {
    // Cascading deletes handle transcripts, sentiments, analyses
    await this.db.delete(tables.calls)
      .where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)));
    // Clean up audio from blob storage
    if (this.blobClient) {
      try {
        await this.blobClient.deleteByPrefix(`orgs/${orgId}/audio/${id}/`);
      } catch (error) {
        logger.error({ err: error, callId: id, orgId }, "Failed to delete audio blobs");
      }
    }
  }

  async getCallByFileHash(orgId: string, fileHash: string): Promise<Call | undefined> {
    const rows = await this.db.select().from(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        eq(tables.calls.fileHash, fileHash),
        sql`${tables.calls.status} != 'failed'`
      ))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : undefined;
  }

  async getAllCalls(orgId: string): Promise<Call[]> {
    const rows = await this.db.select().from(tables.calls)
      .where(eq(tables.calls.orgId, orgId))
      .orderBy(desc(tables.calls.uploadedAt));
    return rows.map((r) => this.mapCall(r));
  }

  async getCallsWithDetails(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string; limit?: number; offset?: number } = {},
  ): Promise<CallWithDetails[]> {
    // Build dynamic where conditions
    const conditions = [eq(tables.calls.orgId, orgId)];
    if (filters.status) conditions.push(eq(tables.calls.status, filters.status));
    if (filters.employee) conditions.push(eq(tables.calls.employeeId, filters.employee));

    let query = this.db.select().from(tables.calls)
      .where(and(...conditions))
      .orderBy(desc(tables.calls.uploadedAt));

    // Apply SQL-level pagination when no sentiment filter (sentiment requires post-join filtering)
    if (!filters.sentiment && filters.limit && filters.limit > 0) {
      query = query.limit(filters.limit) as any;
      if (filters.offset) query = query.offset(filters.offset) as any;
    }

    const callRows = await query;

    if (callRows.length === 0) return [];

    const callIds = callRows.map((c) => c.id);

    // Collect unique employee IDs to fetch only needed employees
    const empIdsNeeded = Array.from(new Set(callRows.map((c) => c.employeeId).filter(Boolean))) as string[];

    // Batch-load related data scoped to matched call IDs (not entire org)
    const [empRows, txRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? this.db.select().from(tables.employees).where(inArray(tables.employees.id, empIdsNeeded))
        : Promise.resolve([]),
      this.db.select().from(tables.transcripts).where(inArray(tables.transcripts.callId, callIds)),
      this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, callIds)),
      this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, callIds)),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const txMap = new Map(txRows.map((t) => [t.callId, this.mapTranscript(t)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    let results: CallWithDetails[] = callRows.map((row) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        transcript: txMap.get(call.id),
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });

    // Apply sentiment filter (post-query since it's in a separate table)
    if (filters.sentiment) {
      results = results.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    }

    return results;
  }

  async getCallSummaries(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string } = {},
  ): Promise<CallSummary[]> {
    // Same as getCallsWithDetails but skips transcript table entirely
    const conditions = [eq(tables.calls.orgId, orgId)];
    if (filters.status) conditions.push(eq(tables.calls.status, filters.status));
    if (filters.employee) conditions.push(eq(tables.calls.employeeId, filters.employee));

    const callRows = await this.db.select().from(tables.calls)
      .where(and(...conditions))
      .orderBy(desc(tables.calls.uploadedAt));

    if (callRows.length === 0) return [];

    const callIds = callRows.map((c) => c.id);
    const empIdsNeeded = Array.from(new Set(callRows.map((c) => c.employeeId).filter(Boolean))) as string[];

    // Batch-load related data scoped to matched calls (NO transcripts)
    const [empRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? this.db.select().from(tables.employees).where(inArray(tables.employees.id, empIdsNeeded))
        : Promise.resolve([]),
      this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, callIds)),
      this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, callIds)),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    let results: CallSummary[] = callRows.map((row) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });

    if (filters.sentiment) {
      results = results.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    }

    return results;
  }

  // --- Transcript operations ---
  async getTranscript(orgId: string, callId: string): Promise<Transcript | undefined> {
    const rows = await this.db.select().from(tables.transcripts)
      .where(and(eq(tables.transcripts.callId, callId), eq(tables.transcripts.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapTranscript(rows[0]) : undefined;
  }

  async createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.transcripts).values({
      id,
      orgId,
      callId: transcript.callId,
      text: transcript.text,
      confidence: transcript.confidence,
      words: transcript.words || null,
    }).returning();
    return this.mapTranscript(row);
  }

  async updateTranscript(orgId: string, callId: string, updates: { text: string }): Promise<Transcript | undefined> {
    const rows = await this.db.update(tables.transcripts)
      .set({ text: updates.text })
      .where(and(eq(tables.transcripts.callId, callId), eq(tables.transcripts.orgId, orgId)))
      .returning();
    return rows[0] ? this.mapTranscript(rows[0]) : undefined;
  }

  // --- Sentiment operations ---
  async getSentimentAnalysis(orgId: string, callId: string): Promise<SentimentAnalysis | undefined> {
    const rows = await this.db.select().from(tables.sentimentAnalyses)
      .where(and(eq(tables.sentimentAnalyses.callId, callId), eq(tables.sentimentAnalyses.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapSentiment(rows[0]) : undefined;
  }

  async createSentimentAnalysis(orgId: string, sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.sentimentAnalyses).values({
      id,
      orgId,
      callId: sentiment.callId,
      overallSentiment: sentiment.overallSentiment,
      overallScore: sentiment.overallScore,
      segments: sentiment.segments || null,
    }).returning();
    return this.mapSentiment(row);
  }

  // --- Call analysis operations ---
  async getCallAnalysis(orgId: string, callId: string): Promise<CallAnalysis | undefined> {
    const rows = await this.db.select().from(tables.callAnalyses)
      .where(and(eq(tables.callAnalyses.callId, callId), eq(tables.callAnalyses.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapAnalysis(rows[0]) : undefined;
  }

  async createCallAnalysis(orgId: string, analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.callAnalyses).values({
      id,
      orgId,
      callId: analysis.callId,
      performanceScore: analysis.performanceScore,
      talkTimeRatio: analysis.talkTimeRatio,
      responseTime: analysis.responseTime,
      keywords: analysis.keywords || null,
      topics: analysis.topics || null,
      summary: analysis.summary,
      actionItems: analysis.actionItems || null,
      feedback: analysis.feedback || null,
      lemurResponse: analysis.lemurResponse || null,
      callPartyType: analysis.callPartyType,
      flags: analysis.flags || null,
      manualEdits: analysis.manualEdits || null,
      confidenceScore: analysis.confidenceScore,
      confidenceFactors: analysis.confidenceFactors || null,
      subScores: analysis.subScores || null,
      detectedAgentName: analysis.detectedAgentName,
      clinicalNote: analysis.clinicalNote || null,
    }).returning();
    return this.mapAnalysis(row);
  }

  // --- Dashboard metrics (efficient SQL queries!) ---
  async getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
    const [callCount] = await this.db.select({
      count: sql<number>`count(*)::int`,
    }).from(tables.calls).where(eq(tables.calls.orgId, orgId));

    const [sentAvg] = await this.db.select({
      avg: sql<number>`coalesce(avg(cast(${tables.sentimentAnalyses.overallScore} as float)) * 10, 0)`,
    }).from(tables.sentimentAnalyses).where(eq(tables.sentimentAnalyses.orgId, orgId));

    const [perfAvg] = await this.db.select({
      avg: sql<number>`coalesce(avg(cast(${tables.callAnalyses.performanceScore} as float)), 0)`,
    }).from(tables.callAnalyses).where(eq(tables.callAnalyses.orgId, orgId));

    return {
      totalCalls: callCount?.count || 0,
      avgSentiment: Math.round((sentAvg?.avg || 0) * 100) / 100,
      avgPerformanceScore: Math.round((perfAvg?.avg || 0) * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(orgId: string): Promise<SentimentDistribution> {
    const rows = await this.db.select({
      sentiment: tables.sentimentAnalyses.overallSentiment,
      count: sql<number>`count(*)::int`,
    }).from(tables.sentimentAnalyses)
      .where(eq(tables.sentimentAnalyses.orgId, orgId))
      .groupBy(tables.sentimentAnalyses.overallSentiment);

    const dist: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const row of rows) {
      const key = row.sentiment as keyof SentimentDistribution;
      if (key in dist) dist[key] = row.count;
    }
    return dist;
  }

  async getTopPerformers(orgId: string, limit = 3): Promise<TopPerformer[]> {
    // Single query: JOIN calls → analyses → employees, aggregate in SQL
    const rows = await this.db.select({
      employeeId: tables.calls.employeeId,
      employeeName: tables.employees.name,
      employeeRole: tables.employees.role,
      avgScore: sql<number>`avg(cast(${tables.callAnalyses.performanceScore} as float))`,
      totalCalls: sql<number>`count(*)::int`,
    }).from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .innerJoin(tables.employees, eq(tables.calls.employeeId, tables.employees.id))
      .where(and(
        eq(tables.calls.orgId, orgId),
        sql`${tables.calls.employeeId} is not null`,
      ))
      .groupBy(tables.calls.employeeId, tables.employees.id, tables.employees.name, tables.employees.role)
      .orderBy(sql`avg(cast(${tables.callAnalyses.performanceScore} as float)) desc`)
      .limit(limit);

    return rows.map((r) => ({
      id: r.employeeId!,
      name: r.employeeName,
      role: r.employeeRole || undefined,
      avgPerformanceScore: r.avgScore ? Math.round(r.avgScore * 100) / 100 : null,
      totalCalls: r.totalCalls,
    }));
  }

  /**
   * Get clinical call metrics without loading all calls into memory.
   * Queries only calls matching clinical categories with their analysis JSONB data.
   */
  async getClinicalCallMetrics(orgId: string, clinicalCategories: string[]): Promise<{
    totalEncounters: number;
    completed: number;
    notesWithData: Array<{
      clinicalNote: any;
      uploadedAt: string | null;
    }>;
  }> {
    // Count total encounters matching clinical categories
    const [totalRow] = await this.db.select({
      count: sql<number>`count(*)::int`,
    }).from(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        inArray(tables.calls.callCategory!, clinicalCategories),
      ));

    // Count completed encounters
    const [completedRow] = await this.db.select({
      count: sql<number>`count(*)::int`,
    }).from(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        eq(tables.calls.status, "completed"),
        inArray(tables.calls.callCategory!, clinicalCategories),
      ));

    // Fetch only completed clinical calls that have analyses with clinical notes
    // This is a JOIN on two tables, not loading ALL calls + ALL analyses
    const noteRows = await this.db.select({
      clinicalNote: tables.callAnalyses.clinicalNote,
      uploadedAt: tables.calls.uploadedAt,
    }).from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .where(and(
        eq(tables.calls.orgId, orgId),
        eq(tables.calls.status, "completed"),
        inArray(tables.calls.callCategory!, clinicalCategories),
        sql`${tables.callAnalyses.clinicalNote} is not null`,
      ));

    return {
      totalEncounters: totalRow?.count || 0,
      completed: completedRow?.count || 0,
      notesWithData: noteRows.map(r => ({
        clinicalNote: r.clinicalNote as any,
        uploadedAt: r.uploadedAt?.toISOString() || null,
      })),
    };
  }

  /**
   * Get attested clinical notes without loading all calls.
   * Returns only analyses with providerAttested clinical notes for matching categories.
   */
  async getAttestedClinicalNotes(orgId: string, clinicalCategories: string[]): Promise<Array<{
    clinicalNote: any;
    uploadedAt: string | null;
  }>> {
    const rows = await this.db.select({
      clinicalNote: tables.callAnalyses.clinicalNote,
      uploadedAt: tables.calls.uploadedAt,
    }).from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .where(and(
        eq(tables.calls.orgId, orgId),
        eq(tables.calls.status, "completed"),
        inArray(tables.calls.callCategory!, clinicalCategories),
        sql`${tables.callAnalyses.clinicalNote} is not null`,
        sql`(${tables.callAnalyses.clinicalNote}->>'providerAttested')::boolean = true`,
      ))
      .orderBy(desc(tables.calls.uploadedAt));

    return rows.map(r => ({
      clinicalNote: r.clinicalNote,
      uploadedAt: r.uploadedAt?.toISOString() || null,
    }));
  }

  // --- Search (PostgreSQL text search across transcripts, analysis, and topics) ---
  async searchCalls(orgId: string, query: string): Promise<CallWithDetails[]> {
    const pattern = `%${query}%`;

    // Search transcripts
    const matchingTranscripts = await this.db.select({ callId: tables.transcripts.callId })
      .from(tables.transcripts)
      .where(and(
        eq(tables.transcripts.orgId, orgId),
        ilike(tables.transcripts.text, pattern),
      ));

    // Search analysis summaries and topics
    const matchingAnalyses = await this.db.select({ callId: tables.callAnalyses.callId })
      .from(tables.callAnalyses)
      .where(and(
        eq(tables.callAnalyses.orgId, orgId),
        or(
          ilike(tables.callAnalyses.summary, pattern),
          sql`${tables.callAnalyses.topics}::text ILIKE ${pattern}`,
        ),
      ));

    const callIds = new Set([
      ...matchingTranscripts.map(t => t.callId),
      ...matchingAnalyses.map(a => a.callId),
    ]);

    if (callIds.size === 0) return [];

    // Fetch only the matching calls with their details (not all calls)
    const matchedCallIds = Array.from(callIds);
    const callRows = await this.db.select().from(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        inArray(tables.calls.id, matchedCallIds),
      ))
      .orderBy(desc(tables.calls.uploadedAt));

    if (callRows.length === 0) return [];

    const empIdsNeeded = Array.from(new Set(callRows.map((c) => c.employeeId).filter(Boolean))) as string[];

    const [empRows, txRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? this.db.select().from(tables.employees).where(inArray(tables.employees.id, empIdsNeeded))
        : Promise.resolve([]),
      this.db.select().from(tables.transcripts).where(inArray(tables.transcripts.callId, matchedCallIds)),
      this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, matchedCallIds)),
      this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, matchedCallIds)),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const txMap = new Map(txRows.map((t) => [t.callId, this.mapTranscript(t)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    return callRows.map((row) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        transcript: txMap.get(call.id),
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });
  }

  // --- Audio operations (delegates to blob storage) ---
  async uploadAudio(orgId: string, callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.blobClient) throw new Error("No blob storage client configured for audio files");
    await this.blobClient.uploadFile(`orgs/${orgId}/audio/${callId}/${fileName}`, buffer, contentType);
  }

  async getAudioFiles(orgId: string, callId: string): Promise<string[]> {
    if (!this.blobClient) return [];
    return this.blobClient.listObjects(`orgs/${orgId}/audio/${callId}/`);
  }

  async downloadAudio(orgId: string, objectName: string): Promise<Buffer | undefined> {
    if (!this.blobClient) return undefined;
    // Always enforce the org prefix for tenant isolation
    const safePath = objectName.startsWith("orgs/")
      ? objectName
      : `orgs/${orgId}/${objectName}`;
    // Validate the path belongs to this org
    if (!safePath.startsWith(`orgs/${orgId}/`)) {
      logger.warn({ orgId, objectName }, "Cross-org audio access blocked");
      return undefined;
    }
    return this.blobClient.downloadFile(safePath);
  }

  // --- Access requests ---
  async createAccessRequest(orgId: string, request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.accessRequests).values({
      id,
      orgId,
      name: request.name,
      email: request.email,
      reason: request.reason,
      requestedRole: request.requestedRole || "viewer",
    }).returning();
    return this.mapAccessRequest(row);
  }

  async getAllAccessRequests(orgId: string): Promise<AccessRequest[]> {
    const rows = await this.db.select().from(tables.accessRequests)
      .where(eq(tables.accessRequests.orgId, orgId))
      .orderBy(desc(tables.accessRequests.createdAt));
    return rows.map((r) => this.mapAccessRequest(r));
  }

  async getAccessRequest(orgId: string, id: string): Promise<AccessRequest | undefined> {
    const rows = await this.db.select().from(tables.accessRequests)
      .where(and(eq(tables.accessRequests.id, id), eq(tables.accessRequests.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapAccessRequest(rows[0]) : undefined;
  }

  async updateAccessRequest(orgId: string, id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.reviewedBy !== undefined) setClause.reviewedBy = updates.reviewedBy;
    if (updates.reviewedAt !== undefined) setClause.reviewedAt = new Date(updates.reviewedAt);

    const [row] = await this.db.update(tables.accessRequests)
      .set(setClause)
      .where(and(eq(tables.accessRequests.id, id), eq(tables.accessRequests.orgId, orgId)))
      .returning();
    return row ? this.mapAccessRequest(row) : undefined;
  }

  // --- Prompt templates ---
  async getPromptTemplate(orgId: string, id: string): Promise<PromptTemplate | undefined> {
    const rows = await this.db.select().from(tables.promptTemplates)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapPromptTemplate(rows[0]) : undefined;
  }

  async getPromptTemplateByCategory(orgId: string, callCategory: string): Promise<PromptTemplate | undefined> {
    const rows = await this.db.select().from(tables.promptTemplates)
      .where(and(
        eq(tables.promptTemplates.orgId, orgId),
        eq(tables.promptTemplates.callCategory, callCategory),
        eq(tables.promptTemplates.isActive, true),
      ))
      .limit(1);
    return rows[0] ? this.mapPromptTemplate(rows[0]) : undefined;
  }

  async getAllPromptTemplates(orgId: string): Promise<PromptTemplate[]> {
    const rows = await this.db.select().from(tables.promptTemplates)
      .where(eq(tables.promptTemplates.orgId, orgId));
    return rows.map((r) => this.mapPromptTemplate(r));
  }

  async createPromptTemplate(orgId: string, template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.promptTemplates).values({
      id,
      orgId,
      callCategory: template.callCategory,
      name: template.name,
      evaluationCriteria: template.evaluationCriteria,
      requiredPhrases: template.requiredPhrases || null,
      scoringWeights: template.scoringWeights || null,
      additionalInstructions: template.additionalInstructions,
      isActive: template.isActive ?? true,
      updatedBy: template.updatedBy,
    }).returning();
    return this.mapPromptTemplate(row);
  }

  async updatePromptTemplate(orgId: string, id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.callCategory !== undefined) setClause.callCategory = updates.callCategory;
    if (updates.evaluationCriteria !== undefined) setClause.evaluationCriteria = updates.evaluationCriteria;
    if (updates.requiredPhrases !== undefined) setClause.requiredPhrases = updates.requiredPhrases;
    if (updates.scoringWeights !== undefined) setClause.scoringWeights = updates.scoringWeights;
    if (updates.additionalInstructions !== undefined) setClause.additionalInstructions = updates.additionalInstructions;
    if (updates.isActive !== undefined) setClause.isActive = updates.isActive;
    if (updates.updatedBy !== undefined) setClause.updatedBy = updates.updatedBy;

    const [row] = await this.db.update(tables.promptTemplates)
      .set(setClause)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)))
      .returning();
    return row ? this.mapPromptTemplate(row) : undefined;
  }

  async deletePromptTemplate(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.promptTemplates)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)));
  }

  // --- Coaching sessions ---
  async createCoachingSession(orgId: string, session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.coachingSessions).values({
      id,
      orgId,
      employeeId: session.employeeId,
      callId: session.callId,
      assignedBy: session.assignedBy,
      category: session.category || "general",
      title: session.title,
      notes: session.notes,
      actionPlan: session.actionPlan || null,
      status: session.status || "pending",
      dueDate: session.dueDate ? new Date(session.dueDate) : null,
    }).returning();
    return this.mapCoachingSession(row);
  }

  async getCoachingSession(orgId: string, id: string): Promise<CoachingSession | undefined> {
    const rows = await this.db.select().from(tables.coachingSessions)
      .where(and(eq(tables.coachingSessions.id, id), eq(tables.coachingSessions.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapCoachingSession(rows[0]) : undefined;
  }

  async getAllCoachingSessions(orgId: string): Promise<CoachingSession[]> {
    const rows = await this.db.select().from(tables.coachingSessions)
      .where(eq(tables.coachingSessions.orgId, orgId));
    return rows.map((r) => this.mapCoachingSession(r));
  }

  async getCoachingSessionsByEmployee(orgId: string, employeeId: string): Promise<CoachingSession[]> {
    const rows = await this.db.select().from(tables.coachingSessions)
      .where(and(
        eq(tables.coachingSessions.orgId, orgId),
        eq(tables.coachingSessions.employeeId, employeeId),
      ));
    return rows.map((r) => this.mapCoachingSession(r));
  }

  async updateCoachingSession(orgId: string, id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    if (updates.category !== undefined) setClause.category = updates.category;
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.actionPlan !== undefined) setClause.actionPlan = updates.actionPlan;
    if (updates.dueDate !== undefined) setClause.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    if (updates.completedAt !== undefined) setClause.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;

    const [row] = await this.db.update(tables.coachingSessions)
      .set(setClause)
      .where(and(eq(tables.coachingSessions.id, id), eq(tables.coachingSessions.orgId, orgId)))
      .returning();
    return row ? this.mapCoachingSession(row) : undefined;
  }

  // --- Data retention ---
  async purgeExpiredCalls(orgId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    // Get IDs of calls to purge (for audio cleanup)
    const expiredCalls = await this.db.select({ id: tables.calls.id })
      .from(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        lt(tables.calls.uploadedAt, cutoff),
      ));

    if (expiredCalls.length === 0) return 0;

    // Delete from DB (cascading deletes handle related tables)
    await this.db.delete(tables.calls)
      .where(and(
        eq(tables.calls.orgId, orgId),
        lt(tables.calls.uploadedAt, cutoff),
      ));

    // Clean up audio blobs
    if (this.blobClient) {
      for (const call of expiredCalls) {
        try {
          await this.blobClient.deleteByPrefix(`orgs/${orgId}/audio/${call.id}/`);
        } catch (error) {
          logger.error({ err: error, callId: call.id }, "Failed to purge audio blobs");
        }
      }
    }

    return expiredCalls.length;
  }

  // --- Usage tracking ---
  async recordUsageEvent(event: { orgId: string; eventType: string; quantity: number; metadata?: Record<string, unknown> }): Promise<void> {
    const id = randomUUID();
    await this.db.insert(tables.usageEvents).values({
      id,
      orgId: event.orgId,
      eventType: event.eventType,
      quantity: event.quantity,
      metadata: event.metadata || null,
    });
  }

  async getUsageSummary(orgId: string, startDate?: Date, endDate?: Date): Promise<import("../storage").UsageSummary[]> {
    const conditions = [eq(tables.usageEvents.orgId, orgId)];
    if (startDate) {
      conditions.push(sql`${tables.usageEvents.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${tables.usageEvents.createdAt} <= ${endDate}`);
    }

    const rows = await this.db.select({
      eventType: tables.usageEvents.eventType,
      totalQuantity: sql<number>`coalesce(sum(${tables.usageEvents.quantity}), 0)`,
      eventCount: sql<number>`count(*)::int`,
    })
      .from(tables.usageEvents)
      .where(and(...conditions))
      .groupBy(tables.usageEvents.eventType);

    return rows.map(r => ({
      eventType: r.eventType,
      totalQuantity: Number(r.totalQuantity),
      eventCount: r.eventCount,
    }));
  }

  // --- API Key operations ---
  async createApiKey(orgId: string, apiKey: InsertApiKey): Promise<ApiKey> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.apiKeys).values({
      id,
      orgId,
      name: apiKey.name,
      keyHash: apiKey.keyHash,
      keyPrefix: apiKey.keyPrefix,
      permissions: apiKey.permissions || ["read"],
      createdBy: apiKey.createdBy,
      status: "active",
      expiresAt: apiKey.expiresAt ? new Date(apiKey.expiresAt) : undefined,
    }).returning();
    return this.mapApiKey(row);
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const rows = await this.db.select().from(tables.apiKeys)
      .where(and(eq(tables.apiKeys.keyHash, keyHash), eq(tables.apiKeys.status, "active")))
      .limit(1);
    return rows[0] ? this.mapApiKey(rows[0]) : undefined;
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    const rows = await this.db.select().from(tables.apiKeys)
      .where(eq(tables.apiKeys.orgId, orgId))
      .orderBy(desc(tables.apiKeys.createdAt));
    return rows.map(r => this.mapApiKey(r));
  }

  async updateApiKey(orgId: string, id: string, updates: Partial<ApiKey>): Promise<ApiKey | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.status) setValues.status = updates.status;
    if (updates.lastUsedAt) setValues.lastUsedAt = new Date(updates.lastUsedAt);
    if (updates.name) setValues.name = updates.name;

    const [row] = await this.db.update(tables.apiKeys)
      .set(setValues)
      .where(and(eq(tables.apiKeys.id, id), eq(tables.apiKeys.orgId, orgId)))
      .returning();
    return row ? this.mapApiKey(row) : undefined;
  }

  async deleteApiKey(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.apiKeys)
      .where(and(eq(tables.apiKeys.id, id), eq(tables.apiKeys.orgId, orgId)));
  }

  // --- Invitation operations ---
  async createInvitation(orgId: string, invitation: InsertInvitation): Promise<Invitation> {
    const { randomBytes } = await import("crypto");
    const id = randomUUID();
    const token = invitation.token || randomBytes(32).toString("hex");
    const expiresAt = invitation.expiresAt
      ? new Date(invitation.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [row] = await this.db.insert(tables.invitations).values({
      id,
      orgId,
      email: invitation.email,
      role: invitation.role || "viewer",
      token,
      invitedBy: invitation.invitedBy,
      status: "pending",
      expiresAt,
    }).returning();

    return this.mapInvitation(row);
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const rows = await this.db.select().from(tables.invitations)
      .where(eq(tables.invitations.token, token)).limit(1);
    return rows[0] ? this.mapInvitation(rows[0]) : undefined;
  }

  async listInvitations(orgId: string): Promise<Invitation[]> {
    const rows = await this.db.select().from(tables.invitations)
      .where(eq(tables.invitations.orgId, orgId))
      .orderBy(desc(tables.invitations.createdAt));
    return rows.map(r => this.mapInvitation(r));
  }

  async updateInvitation(orgId: string, id: string, updates: Partial<Invitation>): Promise<Invitation | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.status) setValues.status = updates.status;
    if (updates.acceptedAt) setValues.acceptedAt = new Date(updates.acceptedAt);

    const [row] = await this.db.update(tables.invitations)
      .set(setValues)
      .where(and(eq(tables.invitations.id, id), eq(tables.invitations.orgId, orgId)))
      .returning();
    return row ? this.mapInvitation(row) : undefined;
  }

  async deleteInvitation(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.invitations)
      .where(and(eq(tables.invitations.id, id), eq(tables.invitations.orgId, orgId)));
  }

  // --- Row mappers (DB row → app type) ---

  private mapOrg(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      settings: row.settings as any,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      orgId: row.orgId,
      username: row.username,
      passwordHash: row.passwordHash,
      name: row.name,
      role: row.role,
      mfaEnabled: row.mfaEnabled ?? false,
      mfaSecret: row.mfaSecret ?? undefined,
      mfaBackupCodes: row.mfaBackupCodes ?? undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapEmployee(row: any): Employee {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      email: row.email,
      role: row.role,
      initials: row.initials,
      status: row.status,
      subTeam: row.subTeam,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapCall(row: any): Call {
    return {
      id: row.id,
      orgId: row.orgId,
      employeeId: row.employeeId,
      fileName: row.fileName,
      filePath: row.filePath,
      status: row.status,
      duration: row.duration,
      assemblyAiId: row.assemblyAiId,
      callCategory: row.callCategory,
      tags: row.tags as string[],
      uploadedAt: toISOString(row.uploadedAt),
      channel: row.channel || "voice",
      emailSubject: row.emailSubject,
      emailFrom: row.emailFrom,
      emailTo: row.emailTo,
      emailCc: row.emailCc,
      emailBody: row.emailBody,
      emailBodyHtml: row.emailBodyHtml,
      emailMessageId: row.emailMessageId,
      emailThreadId: row.emailThreadId,
      emailReceivedAt: toISOString(row.emailReceivedAt),
      chatPlatform: row.chatPlatform,
      messageCount: row.messageCount,
    };
  }

  private mapTranscript(row: any): Transcript {
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      text: row.text,
      confidence: row.confidence,
      words: row.words as any,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapSentiment(row: any): SentimentAnalysis {
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      overallSentiment: row.overallSentiment,
      overallScore: row.overallScore,
      segments: row.segments as any,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapAnalysis(row: any): CallAnalysis {
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      performanceScore: row.performanceScore,
      talkTimeRatio: row.talkTimeRatio,
      responseTime: row.responseTime,
      keywords: row.keywords as string[],
      topics: row.topics as string[],
      summary: row.summary,
      actionItems: row.actionItems as string[],
      feedback: row.feedback as any,
      lemurResponse: row.lemurResponse,
      callPartyType: row.callPartyType,
      flags: row.flags as string[],
      manualEdits: row.manualEdits as any,
      confidenceScore: row.confidenceScore,
      confidenceFactors: row.confidenceFactors as any,
      subScores: row.subScores as any,
      detectedAgentName: row.detectedAgentName,
      clinicalNote: row.clinicalNote as any,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapAccessRequest(row: any): AccessRequest {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      email: row.email,
      reason: row.reason,
      requestedRole: row.requestedRole,
      status: row.status,
      reviewedBy: row.reviewedBy,
      reviewedAt: toISOString(row.reviewedAt),
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapPromptTemplate(row: any): PromptTemplate {
    return {
      id: row.id,
      orgId: row.orgId,
      callCategory: row.callCategory,
      name: row.name,
      evaluationCriteria: row.evaluationCriteria,
      requiredPhrases: row.requiredPhrases as any,
      scoringWeights: row.scoringWeights as any,
      additionalInstructions: row.additionalInstructions,
      isActive: row.isActive,
      updatedAt: toISOString(row.updatedAt),
      updatedBy: row.updatedBy,
    };
  }

  private mapCoachingSession(row: any): CoachingSession {
    return {
      id: row.id,
      orgId: row.orgId,
      employeeId: row.employeeId,
      callId: row.callId,
      assignedBy: row.assignedBy,
      category: row.category,
      title: row.title,
      notes: row.notes,
      actionPlan: row.actionPlan as any,
      status: row.status as any,
      dueDate: toISOString(row.dueDate),
      createdAt: toISOString(row.createdAt),
      completedAt: toISOString(row.completedAt),
    };
  }

  private mapApiKey(row: any): ApiKey {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      keyHash: row.keyHash,
      keyPrefix: row.keyPrefix,
      permissions: row.permissions as string[],
      createdBy: row.createdBy,
      status: row.status,
      expiresAt: toISOString(row.expiresAt),
      lastUsedAt: toISOString(row.lastUsedAt),
      createdAt: toISOString(row.createdAt),
    };
  }

  // --- Subscription operations ---
  async getSubscription(orgId: string): Promise<Subscription | undefined> {
    const rows = await this.db.select().from(tables.subscriptions)
      .where(eq(tables.subscriptions.orgId, orgId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined> {
    const rows = await this.db.select().from(tables.subscriptions)
      .where(eq(tables.subscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async getSubscriptionByStripeSubId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
    const rows = await this.db.select().from(tables.subscriptions)
      .where(eq(tables.subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async upsertSubscription(orgId: string, sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(orgId);
    const id = existing?.id || randomUUID();
    const now = new Date();

    if (existing) {
      const [row] = await this.db.update(tables.subscriptions).set({
        planTier: sub.planTier,
        status: sub.status,
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        stripePriceId: sub.stripePriceId,
        billingInterval: sub.billingInterval,
        currentPeriodStart: sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : undefined,
        currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : undefined,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        updatedAt: now,
      }).where(eq(tables.subscriptions.orgId, orgId)).returning();
      return this.mapSubscription(row);
    }

    const [row] = await this.db.insert(tables.subscriptions).values({
      id,
      orgId,
      planTier: sub.planTier,
      status: sub.status,
      stripeCustomerId: sub.stripeCustomerId || null,
      stripeSubscriptionId: sub.stripeSubscriptionId || null,
      stripePriceId: sub.stripePriceId || null,
      billingInterval: sub.billingInterval || "monthly",
      currentPeriodStart: sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : null,
      currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
    }).returning();
    return this.mapSubscription(row);
  }

  async updateSubscription(orgId: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.planTier) setValues.planTier = updates.planTier;
    if (updates.status) setValues.status = updates.status;
    if (updates.stripeCustomerId) setValues.stripeCustomerId = updates.stripeCustomerId;
    if (updates.stripeSubscriptionId) setValues.stripeSubscriptionId = updates.stripeSubscriptionId;
    if (updates.stripePriceId) setValues.stripePriceId = updates.stripePriceId;
    if (updates.billingInterval) setValues.billingInterval = updates.billingInterval;
    if (updates.currentPeriodStart) setValues.currentPeriodStart = new Date(updates.currentPeriodStart);
    if (updates.currentPeriodEnd) setValues.currentPeriodEnd = new Date(updates.currentPeriodEnd);
    if (updates.cancelAtPeriodEnd !== undefined) setValues.cancelAtPeriodEnd = updates.cancelAtPeriodEnd;

    const [row] = await this.db.update(tables.subscriptions).set(setValues)
      .where(eq(tables.subscriptions.orgId, orgId)).returning();
    return row ? this.mapSubscription(row) : undefined;
  }

  private mapSubscription(row: any): Subscription {
    return {
      id: row.id,
      orgId: row.orgId,
      planTier: row.planTier,
      status: row.status,
      stripeCustomerId: row.stripeCustomerId || undefined,
      stripeSubscriptionId: row.stripeSubscriptionId || undefined,
      stripePriceId: row.stripePriceId || undefined,
      billingInterval: row.billingInterval,
      currentPeriodStart: toISOString(row.currentPeriodStart),
      currentPeriodEnd: toISOString(row.currentPeriodEnd),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd || false,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  // --- Reference document operations ---
  async createReferenceDocument(orgId: string, doc: InsertReferenceDocument): Promise<ReferenceDocument> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.referenceDocuments).values({
      id,
      orgId,
      name: doc.name,
      category: doc.category,
      description: doc.description || null,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      extractedText: doc.extractedText || null,
      appliesTo: doc.appliesTo || null,
      isActive: doc.isActive ?? true,
      uploadedBy: doc.uploadedBy || null,
    }).returning();
    return this.mapReferenceDocument(row);
  }

  async getReferenceDocument(orgId: string, id: string): Promise<ReferenceDocument | undefined> {
    const rows = await this.db.select().from(tables.referenceDocuments)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)))
      .limit(1);
    return rows[0] ? this.mapReferenceDocument(rows[0]) : undefined;
  }

  async listReferenceDocuments(orgId: string): Promise<ReferenceDocument[]> {
    const rows = await this.db.select().from(tables.referenceDocuments)
      .where(eq(tables.referenceDocuments.orgId, orgId))
      .orderBy(desc(tables.referenceDocuments.createdAt));
    return rows.map(r => this.mapReferenceDocument(r));
  }

  async getReferenceDocumentsForCategory(orgId: string, callCategory: string): Promise<ReferenceDocument[]> {
    const rows = await this.db.select().from(tables.referenceDocuments)
      .where(and(
        eq(tables.referenceDocuments.orgId, orgId),
        eq(tables.referenceDocuments.isActive, true),
      ));
    // Filter in-memory since appliesTo is JSONB — either empty (applies to all) or includes the category
    return rows
      .filter(r => {
        const applies = r.appliesTo as string[] | null;
        return !applies || applies.length === 0 || applies.includes(callCategory);
      })
      .map(r => this.mapReferenceDocument(r));
  }

  async updateReferenceDocument(orgId: string, id: string, updates: Partial<ReferenceDocument>): Promise<ReferenceDocument | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.name) setValues.name = updates.name;
    if (updates.category) setValues.category = updates.category;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.extractedText !== undefined) setValues.extractedText = updates.extractedText;
    if (updates.appliesTo !== undefined) setValues.appliesTo = updates.appliesTo;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;

    const [row] = await this.db.update(tables.referenceDocuments).set(setValues)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)))
      .returning();
    return row ? this.mapReferenceDocument(row) : undefined;
  }

  async deleteReferenceDocument(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.referenceDocuments)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)));
  }

  private mapReferenceDocument(row: any): ReferenceDocument {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      category: row.category,
      description: row.description || undefined,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      storagePath: row.storagePath,
      extractedText: row.extractedText || undefined,
      appliesTo: (row.appliesTo as string[]) || undefined,
      isActive: row.isActive,
      uploadedBy: row.uploadedBy || undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapInvitation(row: any): Invitation {
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      role: row.role,
      token: row.token,
      invitedBy: row.invitedBy,
      status: row.status,
      expiresAt: toISOString(row.expiresAt),
      acceptedAt: toISOString(row.acceptedAt),
      createdAt: toISOString(row.createdAt),
    };
  }

  // --- A/B test operations (stored in ab_tests table) ---
  async createABTest(orgId: string, test: InsertABTest): Promise<ABTest> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.abTests).values({
      id,
      orgId,
      fileName: test.fileName,
      callCategory: test.callCategory || null,
      baselineModel: test.baselineModel,
      testModel: test.testModel,
      status: test.status || "processing",
      transcriptText: test.transcriptText || null,
      baselineAnalysis: test.baselineAnalysis || null,
      testAnalysis: test.testAnalysis || null,
      baselineLatencyMs: test.baselineLatencyMs || null,
      testLatencyMs: test.testLatencyMs || null,
      notes: test.notes || null,
      createdBy: test.createdBy,
    }).returning();
    return this.mapABTest(row);
  }

  async getABTest(orgId: string, id: string): Promise<ABTest | undefined> {
    const [row] = await this.db.select().from(tables.abTests)
      .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
    return row ? this.mapABTest(row) : undefined;
  }

  async getAllABTests(orgId: string): Promise<ABTest[]> {
    const rows = await this.db.select().from(tables.abTests)
      .where(eq(tables.abTests.orgId, orgId))
      .orderBy(desc(tables.abTests.createdAt));
    return rows.map(r => this.mapABTest(r));
  }

  async updateABTest(orgId: string, id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
    const values: Record<string, any> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.transcriptText !== undefined) values.transcriptText = updates.transcriptText;
    if (updates.baselineAnalysis !== undefined) values.baselineAnalysis = updates.baselineAnalysis;
    if (updates.testAnalysis !== undefined) values.testAnalysis = updates.testAnalysis;
    if (updates.baselineLatencyMs !== undefined) values.baselineLatencyMs = updates.baselineLatencyMs;
    if (updates.testLatencyMs !== undefined) values.testLatencyMs = updates.testLatencyMs;
    if (updates.notes !== undefined) values.notes = updates.notes;
    if (Object.keys(values).length === 0) return this.getABTest(orgId, id);

    const [row] = await this.db.update(tables.abTests)
      .set(values)
      .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)))
      .returning();
    return row ? this.mapABTest(row) : undefined;
  }

  async deleteABTest(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.abTests)
      .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
  }

  private mapABTest(row: any): ABTest {
    return {
      id: row.id,
      orgId: row.orgId,
      fileName: row.fileName,
      callCategory: row.callCategory || undefined,
      baselineModel: row.baselineModel,
      testModel: row.testModel,
      status: row.status,
      transcriptText: row.transcriptText || undefined,
      baselineAnalysis: row.baselineAnalysis || undefined,
      testAnalysis: row.testAnalysis || undefined,
      baselineLatencyMs: row.baselineLatencyMs || undefined,
      testLatencyMs: row.testLatencyMs || undefined,
      notes: row.notes || undefined,
      createdBy: row.createdBy,
      createdAt: toISOString(row.createdAt),
    };
  }

  // --- Spend tracking / usage records (stored in spend_records table) ---
  async createUsageRecord(orgId: string, record: UsageRecord): Promise<void> {
    await this.db.insert(tables.spendRecords).values({
      id: record.id,
      orgId,
      callId: record.callId,
      type: record.type,
      timestamp: new Date(record.timestamp),
      userName: record.user,
      services: record.services,
      totalEstimatedCost: record.totalEstimatedCost,
    });
  }

  async getUsageRecords(orgId: string): Promise<UsageRecord[]> {
    const rows = await this.db.select().from(tables.spendRecords)
      .where(eq(tables.spendRecords.orgId, orgId))
      .orderBy(desc(tables.spendRecords.timestamp));
    return rows.map(r => ({
      id: r.id,
      orgId: r.orgId,
      callId: r.callId,
      type: r.type as "call" | "ab-test",
      timestamp: r.timestamp ? r.timestamp.toISOString() : new Date().toISOString(),
      user: r.userName,
      services: r.services as UsageRecord["services"],
      totalEstimatedCost: r.totalEstimatedCost,
    }));
  }

  // --- Live sessions (real-time clinical recording) ---

  async createLiveSession(orgId: string, session: InsertLiveSession): Promise<LiveSession> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tables.liveSessions).values({
      id,
      orgId,
      createdBy: session.createdBy,
      specialty: session.specialty || null,
      noteFormat: session.noteFormat || "soap",
      encounterType: session.encounterType || "clinical_encounter",
      status: "active",
      transcriptText: "",
      draftClinicalNote: null,
      durationSeconds: 0,
      consentObtained: session.consentObtained || false,
      startedAt: now,
    });
    return {
      id,
      orgId,
      createdBy: session.createdBy,
      specialty: session.specialty,
      noteFormat: session.noteFormat || "soap",
      encounterType: session.encounterType || "clinical_encounter",
      status: "active",
      transcriptText: "",
      durationSeconds: 0,
      consentObtained: session.consentObtained || false,
      startedAt: now.toISOString(),
    };
  }

  async getLiveSession(orgId: string, id: string): Promise<LiveSession | undefined> {
    const rows = await this.db.select().from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.id, id)));
    if (!rows[0]) return undefined;
    return this.mapLiveSessionRow(rows[0]);
  }

  async updateLiveSession(orgId: string, id: string, updates: Partial<LiveSession>): Promise<LiveSession | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.transcriptText !== undefined) dbUpdates.transcriptText = updates.transcriptText;
    if (updates.draftClinicalNote !== undefined) dbUpdates.draftClinicalNote = updates.draftClinicalNote;
    if (updates.durationSeconds !== undefined) dbUpdates.durationSeconds = updates.durationSeconds;
    if (updates.consentObtained !== undefined) dbUpdates.consentObtained = updates.consentObtained;
    if (updates.callId !== undefined) dbUpdates.callId = updates.callId;
    if (updates.endedAt !== undefined) dbUpdates.endedAt = new Date(updates.endedAt);

    const rows = await this.db.update(tables.liveSessions)
      .set(dbUpdates)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.id, id)))
      .returning();
    if (!rows[0]) return undefined;
    return this.mapLiveSessionRow(rows[0]);
  }

  async getActiveLiveSessions(orgId: string): Promise<LiveSession[]> {
    const rows = await this.db.select().from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.status, "active")));
    return rows.map(r => this.mapLiveSessionRow(r));
  }

  async getLiveSessionsByUser(orgId: string, userId: string): Promise<LiveSession[]> {
    const rows = await this.db.select().from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.createdBy, userId)))
      .orderBy(desc(tables.liveSessions.startedAt));
    return rows.map(r => this.mapLiveSessionRow(r));
  }

  private mapLiveSessionRow(r: typeof tables.liveSessions.$inferSelect): LiveSession {
    return {
      id: r.id,
      orgId: r.orgId,
      createdBy: r.createdBy,
      specialty: r.specialty || undefined,
      noteFormat: r.noteFormat,
      encounterType: r.encounterType,
      status: r.status as LiveSession["status"],
      transcriptText: r.transcriptText || "",
      draftClinicalNote: r.draftClinicalNote as LiveSession["draftClinicalNote"],
      durationSeconds: r.durationSeconds,
      consentObtained: r.consentObtained,
      callId: r.callId || undefined,
      startedAt: toISOString(r.startedAt),
      endedAt: toISOString(r.endedAt),
    };
  }

  // ===================== FEEDBACK =====================

  async createFeedback(orgId: string, feedback: InsertFeedback): Promise<Feedback> {
    const id = randomUUID();
    await this.db.insert(tables.feedbacks).values({
      id, orgId, userId: feedback.userId, type: feedback.type,
      context: feedback.context || null, rating: feedback.rating ?? null,
      comment: feedback.comment || null, metadata: feedback.metadata || null,
      status: "new",
    });
    return { ...feedback, id, orgId, status: "new", createdAt: new Date().toISOString() };
  }

  async getFeedback(orgId: string, id: string): Promise<Feedback | undefined> {
    const rows = await this.db.select().from(tables.feedbacks)
      .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)));
    return rows[0] ? this.mapFeedbackRow(rows[0]) : undefined;
  }

  async listFeedback(orgId: string, filters?: { type?: string; status?: string }): Promise<Feedback[]> {
    const conditions = [eq(tables.feedbacks.orgId, orgId)];
    if (filters?.type) conditions.push(eq(tables.feedbacks.type, filters.type));
    if (filters?.status) conditions.push(eq(tables.feedbacks.status, filters.status));
    const rows = await this.db.select().from(tables.feedbacks)
      .where(and(...conditions))
      .orderBy(desc(tables.feedbacks.createdAt));
    return rows.map(r => this.mapFeedbackRow(r));
  }

  async updateFeedback(orgId: string, id: string, updates: Partial<Feedback>): Promise<Feedback | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.adminResponse !== undefined) dbUpdates.adminResponse = updates.adminResponse;
    const rows = await this.db.update(tables.feedbacks).set(dbUpdates)
      .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)))
      .returning();
    return rows[0] ? this.mapFeedbackRow(rows[0]) : undefined;
  }

  private mapFeedbackRow(r: typeof tables.feedbacks.$inferSelect): Feedback {
    return {
      id: r.id, orgId: r.orgId, userId: r.userId, type: r.type as Feedback["type"],
      context: r.context as Feedback["context"] ?? undefined, rating: r.rating ?? undefined,
      comment: r.comment ?? undefined, metadata: r.metadata as Record<string, unknown> ?? undefined,
      status: r.status as Feedback["status"], adminResponse: r.adminResponse ?? undefined,
      createdAt: toISOString(r.createdAt),
    };
  }

  // ===================== GAMIFICATION =====================

  async getEmployeeBadges(orgId: string, employeeId: string): Promise<EmployeeBadge[]> {
    const rows = await this.db.select().from(tables.employeeBadges)
      .where(and(eq(tables.employeeBadges.orgId, orgId), eq(tables.employeeBadges.employeeId, employeeId)));
    return rows.map(r => ({
      id: r.id, orgId: r.orgId, employeeId: r.employeeId, badgeId: r.badgeId,
      awardedAt: toISOString(r.awardedAt) || new Date().toISOString(),
      awardedFor: r.awardedFor || undefined,
    }));
  }

  async awardBadge(orgId: string, badge: Omit<EmployeeBadge, "id">): Promise<EmployeeBadge> {
    const id = randomUUID();
    try {
      await this.db.insert(tables.employeeBadges).values({
        id, orgId, employeeId: badge.employeeId, badgeId: badge.badgeId,
        awardedFor: badge.awardedFor || null,
      });
    } catch (e: unknown) {
      // Unique constraint violation — badge already awarded
      if ((e as { code?: string }).code === "23505") {
        const existing = await this.db.select().from(tables.employeeBadges)
          .where(and(
            eq(tables.employeeBadges.orgId, orgId),
            eq(tables.employeeBadges.employeeId, badge.employeeId),
            eq(tables.employeeBadges.badgeId, badge.badgeId),
          ));
        if (existing[0]) return { ...badge, id: existing[0].id, awardedAt: toISOString(existing[0].awardedAt) || badge.awardedAt };
      }
      throw e;
    }
    return { ...badge, id };
  }

  async getGamificationProfile(orgId: string, employeeId: string) {
    const rows = await this.db.select().from(tables.gamificationProfiles)
      .where(and(eq(tables.gamificationProfiles.orgId, orgId), eq(tables.gamificationProfiles.employeeId, employeeId)));
    if (!rows[0]) return { totalPoints: 0, currentStreak: 0, longestStreak: 0 };
    return { totalPoints: rows[0].totalPoints, currentStreak: rows[0].currentStreak, longestStreak: rows[0].longestStreak };
  }

  async updateGamificationProfile(orgId: string, employeeId: string, updates: { totalPoints?: number; currentStreak?: number; longestStreak?: number; lastActivityDate?: string }) {
    const existing = await this.db.select().from(tables.gamificationProfiles)
      .where(and(eq(tables.gamificationProfiles.orgId, orgId), eq(tables.gamificationProfiles.employeeId, employeeId)));
    if (existing[0]) {
      const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.totalPoints !== undefined) dbUpdates.totalPoints = updates.totalPoints;
      if (updates.currentStreak !== undefined) dbUpdates.currentStreak = updates.currentStreak;
      if (updates.longestStreak !== undefined) dbUpdates.longestStreak = updates.longestStreak;
      if (updates.lastActivityDate !== undefined) dbUpdates.lastActivityDate = updates.lastActivityDate;
      await this.db.update(tables.gamificationProfiles).set(dbUpdates)
        .where(and(eq(tables.gamificationProfiles.orgId, orgId), eq(tables.gamificationProfiles.employeeId, employeeId)));
    } else {
      await this.db.insert(tables.gamificationProfiles).values({
        orgId, employeeId,
        totalPoints: updates.totalPoints || 0,
        currentStreak: updates.currentStreak || 0,
        longestStreak: updates.longestStreak || 0,
        lastActivityDate: updates.lastActivityDate || null,
      });
    }
  }

  async getLeaderboard(orgId: string, limit = 20) {
    const rows = await this.db.select().from(tables.gamificationProfiles)
      .where(eq(tables.gamificationProfiles.orgId, orgId))
      .orderBy(desc(tables.gamificationProfiles.totalPoints))
      .limit(limit);
    const result = [];
    for (const r of rows) {
      const badgeCount = await this.db.select({ count: sql<number>`count(*)` }).from(tables.employeeBadges)
        .where(and(eq(tables.employeeBadges.orgId, orgId), eq(tables.employeeBadges.employeeId, r.employeeId)));
      result.push({
        employeeId: r.employeeId,
        totalPoints: r.totalPoints,
        currentStreak: r.currentStreak,
        badgeCount: Number(badgeCount[0]?.count || 0),
      });
    }
    return result;
  }

  // ===================== INSURANCE NARRATIVES =====================

  async createInsuranceNarrative(orgId: string, narrative: InsertInsuranceNarrative): Promise<InsuranceNarrative> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tables.insuranceNarratives).values({
      id, orgId, callId: narrative.callId || null,
      patientName: narrative.patientName, patientDob: narrative.patientDob || null,
      memberId: narrative.memberId || null, insurerName: narrative.insurerName,
      insurerAddress: narrative.insurerAddress || null, letterType: narrative.letterType,
      diagnosisCodes: narrative.diagnosisCodes || null, procedureCodes: narrative.procedureCodes || null,
      clinicalJustification: narrative.clinicalJustification || null,
      priorDenialReference: narrative.priorDenialReference || null,
      generatedNarrative: narrative.generatedNarrative || null,
      status: narrative.status || "draft", createdBy: narrative.createdBy,
      createdAt: now, updatedAt: now,
    });
    return { ...narrative, id, orgId, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async getInsuranceNarrative(orgId: string, id: string): Promise<InsuranceNarrative | undefined> {
    const rows = await this.db.select().from(tables.insuranceNarratives)
      .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
    return rows[0] ? this.mapInsuranceNarrativeRow(rows[0]) : undefined;
  }

  async listInsuranceNarratives(orgId: string, filters?: { callId?: string; status?: string }): Promise<InsuranceNarrative[]> {
    const conditions = [eq(tables.insuranceNarratives.orgId, orgId)];
    if (filters?.callId) conditions.push(eq(tables.insuranceNarratives.callId, filters.callId));
    if (filters?.status) conditions.push(eq(tables.insuranceNarratives.status, filters.status));
    const rows = await this.db.select().from(tables.insuranceNarratives)
      .where(and(...conditions)).orderBy(desc(tables.insuranceNarratives.createdAt));
    return rows.map(r => this.mapInsuranceNarrativeRow(r));
  }

  async updateInsuranceNarrative(orgId: string, id: string, updates: Partial<InsuranceNarrative>): Promise<InsuranceNarrative | undefined> {
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.generatedNarrative !== undefined) dbUpdates.generatedNarrative = updates.generatedNarrative;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.clinicalJustification !== undefined) dbUpdates.clinicalJustification = updates.clinicalJustification;
    if (updates.priorDenialReference !== undefined) dbUpdates.priorDenialReference = updates.priorDenialReference;
    if (updates.diagnosisCodes !== undefined) dbUpdates.diagnosisCodes = updates.diagnosisCodes;
    if (updates.procedureCodes !== undefined) dbUpdates.procedureCodes = updates.procedureCodes;
    const rows = await this.db.update(tables.insuranceNarratives).set(dbUpdates)
      .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)))
      .returning();
    return rows[0] ? this.mapInsuranceNarrativeRow(rows[0]) : undefined;
  }

  async deleteInsuranceNarrative(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.insuranceNarratives)
      .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
  }

  private mapInsuranceNarrativeRow(r: typeof tables.insuranceNarratives.$inferSelect): InsuranceNarrative {
    return {
      id: r.id, orgId: r.orgId, callId: r.callId || undefined,
      patientName: r.patientName, patientDob: r.patientDob || undefined,
      memberId: r.memberId || undefined, insurerName: r.insurerName,
      insurerAddress: r.insurerAddress || undefined, letterType: r.letterType,
      diagnosisCodes: r.diagnosisCodes as InsuranceNarrative["diagnosisCodes"],
      procedureCodes: r.procedureCodes as InsuranceNarrative["procedureCodes"],
      clinicalJustification: r.clinicalJustification || undefined,
      priorDenialReference: r.priorDenialReference || undefined,
      generatedNarrative: r.generatedNarrative || undefined,
      status: r.status as InsuranceNarrative["status"], createdBy: r.createdBy,
      createdAt: toISOString(r.createdAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  // ===================== CALL REVENUE =====================

  async createCallRevenue(orgId: string, revenue: InsertCallRevenue): Promise<CallRevenue> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tables.callRevenues).values({
      id, orgId, callId: revenue.callId,
      estimatedRevenue: revenue.estimatedRevenue ?? null,
      actualRevenue: revenue.actualRevenue ?? null,
      revenueType: revenue.revenueType || null,
      treatmentValue: revenue.treatmentValue ?? null,
      scheduledProcedures: revenue.scheduledProcedures || null,
      conversionStatus: revenue.conversionStatus || "unknown",
      notes: revenue.notes || null,
      updatedBy: revenue.updatedBy || null,
      createdAt: now, updatedAt: now,
    });
    return { ...revenue, id, orgId, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async getCallRevenue(orgId: string, callId: string): Promise<CallRevenue | undefined> {
    const rows = await this.db.select().from(tables.callRevenues)
      .where(and(eq(tables.callRevenues.orgId, orgId), eq(tables.callRevenues.callId, callId)));
    return rows[0] ? this.mapCallRevenueRow(rows[0]) : undefined;
  }

  async listCallRevenues(orgId: string, filters?: { conversionStatus?: string }): Promise<CallRevenue[]> {
    const conditions = [eq(tables.callRevenues.orgId, orgId)];
    if (filters?.conversionStatus) conditions.push(eq(tables.callRevenues.conversionStatus, filters.conversionStatus));
    const rows = await this.db.select().from(tables.callRevenues)
      .where(and(...conditions)).orderBy(desc(tables.callRevenues.createdAt));
    return rows.map(r => this.mapCallRevenueRow(r));
  }

  async updateCallRevenue(orgId: string, callId: string, updates: Partial<CallRevenue>): Promise<CallRevenue | undefined> {
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.estimatedRevenue !== undefined) dbUpdates.estimatedRevenue = updates.estimatedRevenue;
    if (updates.actualRevenue !== undefined) dbUpdates.actualRevenue = updates.actualRevenue;
    if (updates.revenueType !== undefined) dbUpdates.revenueType = updates.revenueType;
    if (updates.treatmentValue !== undefined) dbUpdates.treatmentValue = updates.treatmentValue;
    if (updates.scheduledProcedures !== undefined) dbUpdates.scheduledProcedures = updates.scheduledProcedures;
    if (updates.conversionStatus !== undefined) dbUpdates.conversionStatus = updates.conversionStatus;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.updatedBy !== undefined) dbUpdates.updatedBy = updates.updatedBy;
    const rows = await this.db.update(tables.callRevenues).set(dbUpdates)
      .where(and(eq(tables.callRevenues.orgId, orgId), eq(tables.callRevenues.callId, callId)))
      .returning();
    return rows[0] ? this.mapCallRevenueRow(rows[0]) : undefined;
  }

  async getRevenueMetrics(orgId: string) {
    const rows = await this.db.select().from(tables.callRevenues)
      .where(eq(tables.callRevenues.orgId, orgId));
    const totalEstimated = rows.reduce((sum, r) => sum + (r.estimatedRevenue || 0), 0);
    const totalActual = rows.reduce((sum, r) => sum + (r.actualRevenue || 0), 0);
    const tracked = rows.filter(r => r.conversionStatus !== "unknown");
    const converted = tracked.filter(r => r.conversionStatus === "converted");
    const conversionRate = tracked.length > 0 ? converted.length / tracked.length : 0;
    const avgDealValue = converted.length > 0 ? totalActual / converted.length : 0;
    return { totalEstimated, totalActual, conversionRate, avgDealValue };
  }

  private mapCallRevenueRow(r: typeof tables.callRevenues.$inferSelect): CallRevenue {
    return {
      id: r.id, orgId: r.orgId, callId: r.callId,
      estimatedRevenue: r.estimatedRevenue ?? undefined,
      actualRevenue: r.actualRevenue ?? undefined,
      revenueType: r.revenueType as CallRevenue["revenueType"],
      treatmentValue: r.treatmentValue ?? undefined,
      scheduledProcedures: r.scheduledProcedures as CallRevenue["scheduledProcedures"],
      conversionStatus: r.conversionStatus as CallRevenue["conversionStatus"],
      notes: r.notes || undefined, updatedBy: r.updatedBy || undefined,
      createdAt: toISOString(r.createdAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  // ===================== CALIBRATION SESSIONS =====================

  async createCalibrationSession(orgId: string, session: InsertCalibrationSession): Promise<CalibrationSession> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tables.calibrationSessions).values({
      id, orgId, title: session.title, callId: session.callId,
      facilitatorId: session.facilitatorId, evaluatorIds: session.evaluatorIds,
      scheduledAt: session.scheduledAt ? new Date(session.scheduledAt) : null,
      status: session.status || "scheduled",
      targetScore: session.targetScore ?? null,
      consensusNotes: session.consensusNotes || null,
      createdAt: now,
    });
    return { ...session, id, orgId, createdAt: now.toISOString() };
  }

  async getCalibrationSession(orgId: string, id: string): Promise<CalibrationSession | undefined> {
    const rows = await this.db.select().from(tables.calibrationSessions)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
    return rows[0] ? this.mapCalibrationSessionRow(rows[0]) : undefined;
  }

  async listCalibrationSessions(orgId: string, filters?: { status?: string }): Promise<CalibrationSession[]> {
    const conditions = [eq(tables.calibrationSessions.orgId, orgId)];
    if (filters?.status) conditions.push(eq(tables.calibrationSessions.status, filters.status));
    const rows = await this.db.select().from(tables.calibrationSessions)
      .where(and(...conditions)).orderBy(desc(tables.calibrationSessions.createdAt));
    return rows.map(r => this.mapCalibrationSessionRow(r));
  }

  async updateCalibrationSession(orgId: string, id: string, updates: Partial<CalibrationSession>): Promise<CalibrationSession | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.targetScore !== undefined) dbUpdates.targetScore = updates.targetScore;
    if (updates.consensusNotes !== undefined) dbUpdates.consensusNotes = updates.consensusNotes;
    if (updates.completedAt !== undefined) dbUpdates.completedAt = new Date(updates.completedAt);
    const rows = await this.db.update(tables.calibrationSessions).set(dbUpdates)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)))
      .returning();
    return rows[0] ? this.mapCalibrationSessionRow(rows[0]) : undefined;
  }

  async deleteCalibrationSession(orgId: string, id: string): Promise<void> {
    // Cascade delete evaluations first
    await this.db.delete(tables.calibrationEvaluations).where(eq(tables.calibrationEvaluations.sessionId, id));
    await this.db.delete(tables.calibrationSessions)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
  }

  async createCalibrationEvaluation(orgId: string, evaluation: InsertCalibrationEvaluation): Promise<CalibrationEvaluation> {
    const id = randomUUID();
    await this.db.insert(tables.calibrationEvaluations).values({
      id, orgId, sessionId: evaluation.sessionId, evaluatorId: evaluation.evaluatorId,
      performanceScore: evaluation.performanceScore, subScores: evaluation.subScores || null,
      notes: evaluation.notes || null,
    });
    return { ...evaluation, id, orgId, createdAt: new Date().toISOString() };
  }

  async getCalibrationEvaluations(orgId: string, sessionId: string): Promise<CalibrationEvaluation[]> {
    const rows = await this.db.select().from(tables.calibrationEvaluations)
      .where(and(eq(tables.calibrationEvaluations.orgId, orgId), eq(tables.calibrationEvaluations.sessionId, sessionId)));
    return rows.map(r => ({
      id: r.id, orgId: r.orgId, sessionId: r.sessionId, evaluatorId: r.evaluatorId,
      performanceScore: r.performanceScore, subScores: r.subScores as CalibrationEvaluation["subScores"],
      notes: r.notes || undefined, createdAt: toISOString(r.createdAt),
    }));
  }

  async updateCalibrationEvaluation(orgId: string, id: string, updates: Partial<CalibrationEvaluation>): Promise<CalibrationEvaluation | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.performanceScore !== undefined) dbUpdates.performanceScore = updates.performanceScore;
    if (updates.subScores !== undefined) dbUpdates.subScores = updates.subScores;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    const rows = await this.db.update(tables.calibrationEvaluations).set(dbUpdates)
      .where(and(eq(tables.calibrationEvaluations.orgId, orgId), eq(tables.calibrationEvaluations.id, id)))
      .returning();
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      id: r.id, orgId: r.orgId, sessionId: r.sessionId, evaluatorId: r.evaluatorId,
      performanceScore: r.performanceScore, subScores: r.subScores as CalibrationEvaluation["subScores"],
      notes: r.notes || undefined, createdAt: toISOString(r.createdAt),
    };
  }

  private mapCalibrationSessionRow(r: typeof tables.calibrationSessions.$inferSelect): CalibrationSession {
    return {
      id: r.id, orgId: r.orgId, title: r.title, callId: r.callId,
      facilitatorId: r.facilitatorId, evaluatorIds: r.evaluatorIds,
      scheduledAt: toISOString(r.scheduledAt),
      status: r.status as CalibrationSession["status"],
      targetScore: r.targetScore ?? undefined,
      consensusNotes: r.consensusNotes || undefined,
      createdAt: toISOString(r.createdAt), completedAt: toISOString(r.completedAt),
    };
  }

  // --- LMS: Learning Modules ---
  async createLearningModule(orgId: string, module: InsertLearningModule): Promise<LearningModule> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.learningModules).values({
      id, orgId,
      title: module.title, description: module.description || null,
      contentType: module.contentType, category: module.category || null,
      content: module.content || null, quizQuestions: module.quizQuestions || null,
      estimatedMinutes: module.estimatedMinutes || null, difficulty: module.difficulty || null,
      tags: module.tags || null, sourceDocumentId: module.sourceDocumentId || null,
      isPublished: module.isPublished ?? false, isPlatformContent: module.isPlatformContent ?? false,
      createdBy: module.createdBy, sortOrder: module.sortOrder || null,
    }).returning();
    return this.mapLearningModule(row);
  }

  async getLearningModule(orgId: string, id: string): Promise<LearningModule | undefined> {
    const rows = await this.db.select().from(tables.learningModules)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
    return rows[0] ? this.mapLearningModule(rows[0]) : undefined;
  }

  async listLearningModules(orgId: string, filters?: { category?: string; contentType?: string; isPublished?: boolean }): Promise<LearningModule[]> {
    const conditions = [eq(tables.learningModules.orgId, orgId)];
    if (filters?.category) conditions.push(eq(tables.learningModules.category, filters.category));
    if (filters?.contentType) conditions.push(eq(tables.learningModules.contentType, filters.contentType));
    if (filters?.isPublished !== undefined) conditions.push(eq(tables.learningModules.isPublished, filters.isPublished));
    const rows = await this.db.select().from(tables.learningModules).where(and(...conditions));
    return rows.map(r => this.mapLearningModule(r));
  }

  async updateLearningModule(orgId: string, id: string, updates: Partial<LearningModule>): Promise<LearningModule | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.description !== undefined) setClause.description = updates.description;
    if (updates.content !== undefined) setClause.content = updates.content;
    if (updates.category !== undefined) setClause.category = updates.category;
    if (updates.quizQuestions !== undefined) setClause.quizQuestions = updates.quizQuestions;
    if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
    if (updates.difficulty !== undefined) setClause.difficulty = updates.difficulty;
    if (updates.tags !== undefined) setClause.tags = updates.tags;
    if (updates.isPublished !== undefined) setClause.isPublished = updates.isPublished;
    if (updates.sortOrder !== undefined) setClause.sortOrder = updates.sortOrder;
    const rows = await this.db.update(tables.learningModules).set(setClause)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id))).returning();
    return rows[0] ? this.mapLearningModule(rows[0]) : undefined;
  }

  async deleteLearningModule(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.learningModules)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
  }

  // --- LMS: Learning Paths ---
  async createLearningPath(orgId: string, path: InsertLearningPath): Promise<LearningPath> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.learningPaths).values({
      id, orgId,
      title: path.title, description: path.description || null,
      category: path.category || null, moduleIds: path.moduleIds,
      isRequired: path.isRequired ?? false, assignedTo: path.assignedTo || null,
      estimatedMinutes: path.estimatedMinutes || null, createdBy: path.createdBy,
    }).returning();
    return this.mapLearningPath(row);
  }

  async getLearningPath(orgId: string, id: string): Promise<LearningPath | undefined> {
    const rows = await this.db.select().from(tables.learningPaths)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
    return rows[0] ? this.mapLearningPath(rows[0]) : undefined;
  }

  async listLearningPaths(orgId: string): Promise<LearningPath[]> {
    const rows = await this.db.select().from(tables.learningPaths)
      .where(eq(tables.learningPaths.orgId, orgId));
    return rows.map(r => this.mapLearningPath(r));
  }

  async updateLearningPath(orgId: string, id: string, updates: Partial<LearningPath>): Promise<LearningPath | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.description !== undefined) setClause.description = updates.description;
    if (updates.moduleIds !== undefined) setClause.moduleIds = updates.moduleIds;
    if (updates.isRequired !== undefined) setClause.isRequired = updates.isRequired;
    if (updates.assignedTo !== undefined) setClause.assignedTo = updates.assignedTo;
    if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
    const rows = await this.db.update(tables.learningPaths).set(setClause)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id))).returning();
    return rows[0] ? this.mapLearningPath(rows[0]) : undefined;
  }

  async deleteLearningPath(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.learningPaths)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
  }

  // --- LMS: Learning Progress ---
  async upsertLearningProgress(orgId: string, progress: InsertLearningProgress): Promise<LearningProgress> {
    // Check if progress exists
    const existing = await this.db.select().from(tables.learningProgress)
      .where(and(
        eq(tables.learningProgress.orgId, orgId),
        eq(tables.learningProgress.employeeId, progress.employeeId),
        eq(tables.learningProgress.moduleId, progress.moduleId),
      ));
    if (existing[0]) {
      const setClause: Record<string, unknown> = { updatedAt: new Date() };
      if (progress.status) setClause.status = progress.status;
      if (progress.quizScore !== undefined) setClause.quizScore = progress.quizScore;
      if (progress.quizAttempts !== undefined) setClause.quizAttempts = progress.quizAttempts;
      if (progress.timeSpentMinutes !== undefined) setClause.timeSpentMinutes = progress.timeSpentMinutes;
      if (progress.completedAt) setClause.completedAt = new Date(progress.completedAt);
      if (progress.notes !== undefined) setClause.notes = progress.notes;
      const [row] = await this.db.update(tables.learningProgress).set(setClause)
        .where(eq(tables.learningProgress.id, existing[0].id)).returning();
      return this.mapLearningProgress(row);
    }
    const id = randomUUID();
    const [row] = await this.db.insert(tables.learningProgress).values({
      id, orgId,
      employeeId: progress.employeeId, moduleId: progress.moduleId,
      pathId: progress.pathId || null, status: progress.status || "not_started",
      quizScore: progress.quizScore || null, quizAttempts: progress.quizAttempts || null,
      timeSpentMinutes: progress.timeSpentMinutes || null, notes: progress.notes || null,
    }).returning();
    return this.mapLearningProgress(row);
  }

  async getLearningProgress(orgId: string, employeeId: string, moduleId: string): Promise<LearningProgress | undefined> {
    const rows = await this.db.select().from(tables.learningProgress)
      .where(and(
        eq(tables.learningProgress.orgId, orgId),
        eq(tables.learningProgress.employeeId, employeeId),
        eq(tables.learningProgress.moduleId, moduleId),
      ));
    return rows[0] ? this.mapLearningProgress(rows[0]) : undefined;
  }

  async getEmployeeLearningProgress(orgId: string, employeeId: string): Promise<LearningProgress[]> {
    const rows = await this.db.select().from(tables.learningProgress)
      .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.employeeId, employeeId)));
    return rows.map(r => this.mapLearningProgress(r));
  }

  async getModuleCompletionStats(orgId: string, moduleId: string): Promise<{ total: number; completed: number; inProgress: number; avgScore: number }> {
    const rows = await this.db.select().from(tables.learningProgress)
      .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.moduleId, moduleId)));
    const completed = rows.filter(r => r.status === "completed");
    const scores = completed.filter(r => r.quizScore != null).map(r => r.quizScore!);
    return {
      total: rows.length,
      completed: completed.length,
      inProgress: rows.filter(r => r.status === "in_progress").length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    };
  }

  private mapLearningModule(r: any): LearningModule {
    return {
      id: r.id, orgId: r.orgId, title: r.title, description: r.description || undefined,
      contentType: r.contentType, category: r.category || undefined,
      content: r.content || undefined, quizQuestions: r.quizQuestions as LearningModule["quizQuestions"],
      estimatedMinutes: r.estimatedMinutes || undefined, difficulty: r.difficulty || undefined,
      tags: r.tags as string[] || undefined, sourceDocumentId: r.sourceDocumentId || undefined,
      isPublished: r.isPublished, isPlatformContent: r.isPlatformContent,
      createdBy: r.createdBy, sortOrder: r.sortOrder || undefined,
      createdAt: toISOString(r.createdAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  private mapLearningPath(r: any): LearningPath {
    return {
      id: r.id, orgId: r.orgId, title: r.title, description: r.description || undefined,
      category: r.category || undefined, moduleIds: r.moduleIds as string[],
      isRequired: r.isRequired, assignedTo: r.assignedTo as string[] || undefined,
      estimatedMinutes: r.estimatedMinutes || undefined, createdBy: r.createdBy,
      createdAt: toISOString(r.createdAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  private mapLearningProgress(r: any): LearningProgress {
    return {
      id: r.id, orgId: r.orgId, employeeId: r.employeeId, moduleId: r.moduleId,
      pathId: r.pathId || undefined, status: r.status,
      quizScore: r.quizScore || undefined, quizAttempts: r.quizAttempts || undefined,
      timeSpentMinutes: r.timeSpentMinutes || undefined,
      completedAt: toISOString(r.completedAt), notes: r.notes || undefined,
      startedAt: toISOString(r.startedAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  // --- Marketing Campaigns ---
  async createMarketingCampaign(orgId: string, campaign: InsertMarketingCampaign): Promise<MarketingCampaign> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.marketingCampaigns).values({
      id, orgId, name: campaign.name, source: campaign.source,
      medium: campaign.medium || null, startDate: campaign.startDate ? new Date(campaign.startDate) : null,
      endDate: campaign.endDate ? new Date(campaign.endDate) : null, budget: campaign.budget || null,
      trackingCode: campaign.trackingCode || null, isActive: campaign.isActive ?? true,
      notes: campaign.notes || null, createdBy: campaign.createdBy,
    }).returning();
    return this.mapCampaign(row);
  }

  async getMarketingCampaign(orgId: string, id: string): Promise<MarketingCampaign | undefined> {
    const rows = await this.db.select().from(tables.marketingCampaigns)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
    return rows[0] ? this.mapCampaign(rows[0]) : undefined;
  }

  async listMarketingCampaigns(orgId: string, filters?: { source?: string; isActive?: boolean }): Promise<MarketingCampaign[]> {
    const conditions = [eq(tables.marketingCampaigns.orgId, orgId)];
    if (filters?.source) conditions.push(eq(tables.marketingCampaigns.source, filters.source));
    if (filters?.isActive !== undefined) conditions.push(eq(tables.marketingCampaigns.isActive, filters.isActive));
    const rows = await this.db.select().from(tables.marketingCampaigns).where(and(...conditions));
    return rows.map(r => this.mapCampaign(r));
  }

  async updateMarketingCampaign(orgId: string, id: string, updates: Partial<MarketingCampaign>): Promise<MarketingCampaign | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.source !== undefined) setClause.source = updates.source;
    if (updates.medium !== undefined) setClause.medium = updates.medium;
    if (updates.budget !== undefined) setClause.budget = updates.budget;
    if (updates.isActive !== undefined) setClause.isActive = updates.isActive;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    if (updates.trackingCode !== undefined) setClause.trackingCode = updates.trackingCode;
    const rows = await this.db.update(tables.marketingCampaigns).set(setClause)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id))).returning();
    return rows[0] ? this.mapCampaign(rows[0]) : undefined;
  }

  async deleteMarketingCampaign(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.marketingCampaigns)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
  }

  // --- Call Attribution ---
  async createCallAttribution(orgId: string, attr: InsertCallAttribution): Promise<CallAttribution> {
    const id = randomUUID();
    const [row] = await this.db.insert(tables.callAttributions).values({
      id, orgId, callId: attr.callId, source: attr.source,
      campaignId: attr.campaignId || null, medium: attr.medium || null,
      isNewPatient: attr.isNewPatient || null, referrerName: attr.referrerName || null,
      detectionMethod: attr.detectionMethod || null, confidence: attr.confidence || null,
      notes: attr.notes || null, attributedBy: attr.attributedBy || null,
    }).returning();
    return this.mapAttribution(row);
  }

  async getCallAttribution(orgId: string, callId: string): Promise<CallAttribution | undefined> {
    const rows = await this.db.select().from(tables.callAttributions)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
    return rows[0] ? this.mapAttribution(rows[0]) : undefined;
  }

  async listCallAttributions(orgId: string, filters?: { source?: string; campaignId?: string }): Promise<CallAttribution[]> {
    const conditions = [eq(tables.callAttributions.orgId, orgId)];
    if (filters?.source) conditions.push(eq(tables.callAttributions.source, filters.source));
    if (filters?.campaignId) conditions.push(eq(tables.callAttributions.campaignId, filters.campaignId));
    const rows = await this.db.select().from(tables.callAttributions).where(and(...conditions));
    return rows.map(r => this.mapAttribution(r));
  }

  async updateCallAttribution(orgId: string, callId: string, updates: Partial<CallAttribution>): Promise<CallAttribution | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.source !== undefined) setClause.source = updates.source;
    if (updates.campaignId !== undefined) setClause.campaignId = updates.campaignId;
    if (updates.isNewPatient !== undefined) setClause.isNewPatient = updates.isNewPatient;
    if (updates.referrerName !== undefined) setClause.referrerName = updates.referrerName;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    const rows = await this.db.update(tables.callAttributions).set(setClause)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId))).returning();
    return rows[0] ? this.mapAttribution(rows[0]) : undefined;
  }

  async deleteCallAttribution(orgId: string, callId: string): Promise<void> {
    await this.db.delete(tables.callAttributions)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
  }

  private mapCampaign(r: any): MarketingCampaign {
    return {
      id: r.id, orgId: r.orgId, name: r.name, source: r.source,
      medium: r.medium || undefined, startDate: toISOString(r.startDate),
      endDate: toISOString(r.endDate), budget: r.budget || undefined,
      trackingCode: r.trackingCode || undefined, isActive: r.isActive,
      notes: r.notes || undefined, createdBy: r.createdBy,
      createdAt: toISOString(r.createdAt), updatedAt: toISOString(r.updatedAt),
    };
  }

  private mapAttribution(r: any): CallAttribution {
    return {
      id: r.id, orgId: r.orgId, callId: r.callId, source: r.source,
      campaignId: r.campaignId || undefined, medium: r.medium || undefined,
      isNewPatient: r.isNewPatient || undefined, referrerName: r.referrerName || undefined,
      detectionMethod: r.detectionMethod || undefined, confidence: r.confidence || undefined,
      notes: r.notes || undefined, attributedBy: r.attributedBy || undefined,
      createdAt: toISOString(r.createdAt),
    };
  }
}
