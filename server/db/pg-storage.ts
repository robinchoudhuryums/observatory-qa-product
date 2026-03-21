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
}
