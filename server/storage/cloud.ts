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
} from "@shared/schema";
import { randomUUID } from "crypto";
import { type IStorage, type ObjectStorageClient, mapConcurrent, normalizeAnalysis, applyCallFilters } from "./types";
import { logger } from "../services/logger";

export class CloudStorage implements IStorage {
  private client: ObjectStorageClient;

  constructor(client: ObjectStorageClient) {
    this.client = client;
  }

  /** Build org-scoped storage path prefix */
  private orgPrefix(orgId: string): string {
    return `orgs/${orgId}`;
  }

  // --- Organization Methods ---
  async getOrganization(orgId: string): Promise<Organization | undefined> {
    return this.client.downloadJson<Organization>(`${this.orgPrefix(orgId)}/org.json`);
  }
  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const orgs = await this.listOrganizations();
    return orgs.find(o => o.slug === slug);
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const newOrg: Organization = { ...org, id, createdAt: new Date().toISOString() };
    await this.client.uploadJson(`${this.orgPrefix(id)}/org.json`, newOrg);
    return newOrg;
  }
  async updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const org = await this.getOrganization(orgId);
    if (!org) return undefined;
    const updated = { ...org, ...updates };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/org.json`, updated);
    return updated;
  }
  async listOrganizations(): Promise<Organization[]> {
    // List all org directories and download their org.json files
    const orgDirs = await this.client.listObjects("orgs/");
    const orgJsonPaths = orgDirs.filter(p => p.endsWith("/org.json"));
    const orgs: Organization[] = [];
    for (const path of orgJsonPaths) {
      const org = await this.client.downloadJson<Organization>(path);
      if (org) orgs.push(org);
    }
    return orgs;
  }

  // --- User Methods (env-var-based, users are managed in auth.ts) ---
  async getUser(_id: string): Promise<User | undefined> {
    return undefined; // Users come from env vars
  }
  async getUserByUsername(_username: string): Promise<User | undefined> {
    return undefined; // Users come from env vars
  }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }
  async listUsersByOrg(_orgId: string): Promise<User[]> {
    return []; // Cloud storage doesn't support DB-backed users
  }
  async updateUser(_orgId: string, _id: string, _updates: Partial<User>): Promise<User | undefined> {
    return undefined;
  }
  async deleteUser(_orgId: string, _id: string): Promise<void> {
    // No-op for cloud storage
  }

  // --- Employee Methods (org-scoped) ---
  async getEmployee(orgId: string, id: string): Promise<Employee | undefined> {
    return this.client.downloadJson<Employee>(`${this.orgPrefix(orgId)}/employees/${id}.json`);
  }

  async getEmployeeByEmail(orgId: string, email: string): Promise<Employee | undefined> {
    const employees = await this.getAllEmployees(orgId);
    return employees.find((e) => e.email === email);
  }

  async createEmployee(orgId: string, employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const newEmployee: Employee = {
      ...employee,
      id,
      orgId,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/employees/${id}.json`, newEmployee);
    return newEmployee;
  }

  async updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const employee = await this.getEmployee(orgId, id);
    if (!employee) return undefined;
    const updated = { ...employee, ...updates, orgId };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/employees/${id}.json`, updated);
    return updated;
  }

  async getAllEmployees(orgId: string): Promise<Employee[]> {
    logger.info({ orgId }, "Fetching employees");
    try {
      const employees = await this.client.listAndDownloadJson<Employee>(`${this.orgPrefix(orgId)}/employees/`);
      logger.info({ orgId, count: employees.length }, "Fetched employees");
      return employees;
    } catch (error) {
      logger.error({ err: error, orgId }, "Failed to fetch employees");
      return [];
    }
  }

  // --- Call Methods (org-scoped) ---
  async getCall(orgId: string, id: string): Promise<Call | undefined> {
    return this.client.downloadJson<Call>(`${this.orgPrefix(orgId)}/calls/${id}.json`);
  }

  async createCall(orgId: string, call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const newCall: Call = {
      ...call,
      id,
      orgId,
      uploadedAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/calls/${id}.json`, newCall);
    return newCall;
  }

  async updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = await this.getCall(orgId, id);
    if (!call) return undefined;
    const updated = { ...call, ...updates, orgId };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/calls/${id}.json`, updated);
    return updated;
  }

  async deleteCall(orgId: string, id: string): Promise<void> {
    const prefix = this.orgPrefix(orgId);
    await Promise.all([
      this.client.deleteObject(`${prefix}/calls/${id}.json`),
      this.client.deleteObject(`${prefix}/transcripts/${id}.json`),
      this.client.deleteObject(`${prefix}/sentiments/${id}.json`),
      this.client.deleteObject(`${prefix}/analyses/${id}.json`),
      this.client.deleteByPrefix(`${prefix}/audio/${id}/`),
    ]);
  }

  async getCallByFileHash(orgId: string, fileHash: string): Promise<Call | undefined> {
    const calls = await this.client.listAndDownloadJson<Call>(`${this.orgPrefix(orgId)}/calls/`);
    return calls.find(c => c.fileHash === fileHash && c.status !== "failed");
  }

  async getAllCalls(orgId: string): Promise<Call[]> {
    const calls = await this.client.listAndDownloadJson<Call>(`${this.orgPrefix(orgId)}/calls/`);
    return calls.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );
  }

  async getCallsWithDetails(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    logger.info({ orgId, filters }, "Fetching calls with details");

    const calls = await this.getAllCalls(orgId);

    // Use bounded concurrency to avoid overwhelming S3 with hundreds of parallel requests
    const results = await mapConcurrent(calls, 10, async (call) => {
      const [employee, transcript, sentiment, analysis] = await Promise.all([
        call.employeeId ? this.getEmployee(orgId, call.employeeId) : Promise.resolve(undefined),
        this.getTranscript(orgId, call.id),
        this.getSentimentAnalysis(orgId, call.id),
        this.getCallAnalysis(orgId, call.id),
      ]);

      return {
        ...call,
        employee,
        transcript: transcript || undefined,
        sentiment: sentiment || undefined,
        analysis: normalizeAnalysis(analysis),
      } as CallWithDetails;
    });

    results.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );

    const filtered = applyCallFilters(results, filters);

    logger.info({ orgId, count: filtered.length }, "Returning filtered calls");
    return filtered;
  }

  async getCallSummaries(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallSummary[]> {
    const calls = await this.getAllCalls(orgId);

    // Skip transcript loading — only fetch employee, sentiment, analysis
    const results = await mapConcurrent(calls, 10, async (call) => {
      const [employee, sentiment, analysis] = await Promise.all([
        call.employeeId ? this.getEmployee(orgId, call.employeeId) : Promise.resolve(undefined),
        this.getSentimentAnalysis(orgId, call.id),
        this.getCallAnalysis(orgId, call.id),
      ]);

      return {
        ...call,
        employee,
        sentiment: sentiment || undefined,
        analysis: normalizeAnalysis(analysis),
      } as CallSummary;
    });

    results.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );

    return applyCallFilters(results, filters);
  }

  // --- Transcript Methods (org-scoped) ---
  async getTranscript(orgId: string, callId: string): Promise<Transcript | undefined> {
    return this.client.downloadJson<Transcript>(`${this.orgPrefix(orgId)}/transcripts/${callId}.json`);
  }

  async createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const newTranscript: Transcript = {
      ...transcript,
      id,
      orgId,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/transcripts/${transcript.callId}.json`, newTranscript);
    return newTranscript;
  }

  // --- Sentiment Analysis Methods (org-scoped) ---
  async getSentimentAnalysis(orgId: string, callId: string): Promise<SentimentAnalysis | undefined> {
    return this.client.downloadJson<SentimentAnalysis>(`${this.orgPrefix(orgId)}/sentiments/${callId}.json`);
  }

  async createSentimentAnalysis(orgId: string, sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const newSentiment: SentimentAnalysis = {
      ...sentiment,
      id,
      orgId,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/sentiments/${sentiment.callId}.json`, newSentiment);
    return newSentiment;
  }

  // --- Call Analysis Methods (org-scoped) ---
  async getCallAnalysis(orgId: string, callId: string): Promise<CallAnalysis | undefined> {
    return this.client.downloadJson<CallAnalysis>(`${this.orgPrefix(orgId)}/analyses/${callId}.json`);
  }

  async createCallAnalysis(orgId: string, analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = {
      ...analysis,
      id,
      orgId,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/analyses/${analysis.callId}.json`, newAnalysis);
    return newAnalysis;
  }

  // --- Audio File Methods (org-scoped) ---
  async uploadAudio(
    orgId: string,
    callId: string,
    fileName: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    await this.client.uploadFile(`${this.orgPrefix(orgId)}/audio/${callId}/${fileName}`, buffer, contentType);
  }

  async getAudioFiles(orgId: string, callId: string): Promise<string[]> {
    return this.client.listObjects(`${this.orgPrefix(orgId)}/audio/${callId}/`);
  }

  async downloadAudio(orgId: string, objectName: string): Promise<Buffer | undefined> {
    // Resolve the full S3 path, then validate it belongs to this org
    const prefixed = objectName.startsWith("orgs/") ? objectName : `${this.orgPrefix(orgId)}/${objectName}`;
    // SECURITY: Prevent cross-org data access via path manipulation
    if (!prefixed.startsWith(`${this.orgPrefix(orgId)}/`)) {
      logger.warn({ orgId, path: objectName }, "Cross-org audio access blocked");
      return undefined;
    }
    return this.client.downloadFile(prefixed);
  }

  // --- Dashboard and Reporting Methods (org-scoped) ---
  async getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
    const prefix = this.orgPrefix(orgId);
    const [calls, sentiments, analyses] = await Promise.all([
      this.client.listObjects(`${prefix}/calls/`),
      this.client.listAndDownloadJson<SentimentAnalysis>(`${prefix}/sentiments/`),
      this.client.listAndDownloadJson<CallAnalysis>(`${prefix}/analyses/`),
    ]);

    const totalCalls = calls.length;
    const avgSentiment =
      sentiments.length > 0
        ? (sentiments.reduce((sum, s) => sum + parseFloat(s.overallScore || "0"), 0) / sentiments.length) * 10
        : 0;
    const avgPerformanceScore =
      analyses.length > 0
        ? analyses.reduce((sum, a) => sum + parseFloat(a.performanceScore || "0"), 0) / analyses.length
        : 0;

    return {
      totalCalls,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(orgId: string): Promise<SentimentDistribution> {
    const sentiments = await this.client.listAndDownloadJson<SentimentAnalysis>(`${this.orgPrefix(orgId)}/sentiments/`);
    const distribution: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const s of sentiments) {
      const key = s.overallSentiment as keyof SentimentDistribution;
      if (key in distribution) distribution[key]++;
    }
    return distribution;
  }

  async getTopPerformers(orgId: string, limit = 3): Promise<TopPerformer[]> {
    const prefix = this.orgPrefix(orgId);
    const [employees, calls, analyses] = await Promise.all([
      this.getAllEmployees(orgId),
      this.client.listAndDownloadJson<Call>(`${prefix}/calls/`),
      this.client.listAndDownloadJson<CallAnalysis>(`${prefix}/analyses/`),
    ]);

    const analysisMap = new Map<string, CallAnalysis>();
    for (const a of analyses) analysisMap.set(a.callId, a);

    const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
    for (const call of calls) {
      const analysis = analysisMap.get(call.id);
      if (!call.employeeId) continue;
      const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
      stats.callCount++;
      if (analysis?.performanceScore) stats.totalScore += parseFloat(analysis.performanceScore);
      employeeStats.set(call.employeeId, stats);
    }

    return employees
      .map((emp) => {
        const stats = employeeStats.get(emp.id) || { totalScore: 0, callCount: 0 };
        return {
          id: emp.id, name: emp.name, role: emp.role,
          avgPerformanceScore: stats.callCount > 0 ? Math.round((stats.totalScore / stats.callCount) * 100) / 100 : null,
          totalCalls: stats.callCount,
        };
      })
      .filter((p) => p.totalCalls > 0)
      .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0))
      .slice(0, limit);
  }

  async searchCalls(orgId: string, query: string): Promise<CallWithDetails[]> {
    const allCalls = await this.getCallsWithDetails(orgId);
    const lowerQuery = query.toLowerCase();
    return allCalls.filter((call) => call.transcript?.text?.toLowerCase().includes(lowerQuery));
  }

  // --- Access Request Methods (org-scoped) ---
  async createAccessRequest(orgId: string, request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const newReq: AccessRequest = { ...request, id, orgId, status: "pending", createdAt: new Date().toISOString() };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/access-requests/${id}.json`, newReq);
    return newReq;
  }

  async getAllAccessRequests(orgId: string): Promise<AccessRequest[]> {
    const requests = await this.client.listAndDownloadJson<AccessRequest>(`${this.orgPrefix(orgId)}/access-requests/`);
    return requests.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }

  async getAccessRequest(orgId: string, id: string): Promise<AccessRequest | undefined> {
    return this.client.downloadJson<AccessRequest>(`${this.orgPrefix(orgId)}/access-requests/${id}.json`);
  }

  async updateAccessRequest(orgId: string, id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const req = await this.getAccessRequest(orgId, id);
    if (!req) return undefined;
    const updated = { ...req, ...updates, orgId };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/access-requests/${id}.json`, updated);
    return updated;
  }

  // --- Prompt Template Methods (org-scoped) ---
  async getPromptTemplate(orgId: string, id: string): Promise<PromptTemplate | undefined> {
    return this.client.downloadJson<PromptTemplate>(`${this.orgPrefix(orgId)}/prompt-templates/${id}.json`);
  }
  async getPromptTemplateByCategory(orgId: string, callCategory: string): Promise<PromptTemplate | undefined> {
    const all = await this.getAllPromptTemplates(orgId);
    return all.find(t => t.callCategory === callCategory && t.isActive);
  }
  async getAllPromptTemplates(orgId: string): Promise<PromptTemplate[]> {
    return this.client.listAndDownloadJson<PromptTemplate>(`${this.orgPrefix(orgId)}/prompt-templates/`);
  }
  async createPromptTemplate(orgId: string, template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const newTemplate: PromptTemplate = { ...template, id, orgId, updatedAt: new Date().toISOString() };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/prompt-templates/${id}.json`, newTemplate);
    return newTemplate;
  }
  async updatePromptTemplate(orgId: string, id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const tmpl = await this.getPromptTemplate(orgId, id);
    if (!tmpl) return undefined;
    const updated = { ...tmpl, ...updates, orgId, updatedAt: new Date().toISOString() };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/prompt-templates/${id}.json`, updated);
    return updated;
  }
  async deletePromptTemplate(orgId: string, id: string): Promise<void> {
    await this.client.deleteObject(`${this.orgPrefix(orgId)}/prompt-templates/${id}.json`);
  }

  // --- Coaching Session Methods (org-scoped) ---
  async createCoachingSession(orgId: string, session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const newSession: CoachingSession = { ...session, id, orgId, createdAt: new Date().toISOString() };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/coaching/${id}.json`, newSession);
    return newSession;
  }
  async getCoachingSession(orgId: string, id: string): Promise<CoachingSession | undefined> {
    return this.client.downloadJson<CoachingSession>(`${this.orgPrefix(orgId)}/coaching/${id}.json`);
  }
  async getAllCoachingSessions(orgId: string): Promise<CoachingSession[]> {
    return this.client.listAndDownloadJson<CoachingSession>(`${this.orgPrefix(orgId)}/coaching/`);
  }
  async getCoachingSessionsByEmployee(orgId: string, employeeId: string): Promise<CoachingSession[]> {
    const all = await this.getAllCoachingSessions(orgId);
    return all.filter(s => s.employeeId === employeeId);
  }
  async updateCoachingSession(orgId: string, id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const session = await this.getCoachingSession(orgId, id);
    if (!session) return undefined;
    const updated = { ...session, ...updates, orgId };
    await this.client.uploadJson(`${this.orgPrefix(orgId)}/coaching/${id}.json`, updated);
    return updated;
  }

  // --- Data Retention (org-scoped) ---
  async purgeExpiredCalls(orgId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const calls = await this.getAllCalls(orgId);
    let purged = 0;

    for (const call of calls) {
      const uploadDate = new Date(call.uploadedAt || 0);
      if (uploadDate < cutoff) {
        logger.info({ callId: call.id, orgId, uploadedAt: uploadDate.toISOString(), retentionDays }, "Purging expired call");
        await this.deleteCall(orgId, call.id);
        purged++;
      }
    }

    return purged;
  }

  // --- Usage Tracking (not supported in cloud storage) ---
  async recordUsageEvent(_event: { orgId: string; eventType: string; quantity: number; metadata?: Record<string, unknown> }): Promise<void> {
    // No-op for cloud storage — usage tracking requires PostgreSQL
  }
  async getUsageSummary(_orgId: string, _startDate?: Date, _endDate?: Date): Promise<import("./types").UsageSummary[]> {
    return [];
  }

  // --- Subscription operations (not supported in cloud storage) ---
  async getSubscription(_orgId: string): Promise<any> { return undefined; }
  async getSubscriptionByStripeCustomerId(_id: string): Promise<any> { return undefined; }
  async getSubscriptionByStripeSubId(_id: string): Promise<any> { return undefined; }
  async upsertSubscription(_orgId: string, sub: any): Promise<any> { return { id: "mock", ...sub }; }
  async updateSubscription(_orgId: string, _updates: any): Promise<any> { return undefined; }

  // --- Reference document operations (not supported in cloud storage) ---
  async createReferenceDocument(_orgId: string, doc: any): Promise<any> { return { id: "mock", ...doc }; }
  async getReferenceDocument(_orgId: string, _id: string): Promise<any> { return undefined; }
  async listReferenceDocuments(_orgId: string): Promise<any[]> { return []; }
  async getReferenceDocumentsForCategory(_orgId: string, _cat: string): Promise<any[]> { return []; }
  async updateReferenceDocument(_orgId: string, _id: string, _updates: any): Promise<any> { return undefined; }
  async deleteReferenceDocument(_orgId: string, _id: string): Promise<void> {}

  // --- API Key operations (not supported in cloud storage) ---
  async createApiKey(_orgId: string, _apiKey: any): Promise<any> {
    throw new Error("API keys require PostgreSQL or in-memory storage");
  }
  async getApiKeyByHash(_keyHash: string): Promise<any> { return undefined; }
  async listApiKeys(_orgId: string): Promise<any[]> { return []; }
  async updateApiKey(_orgId: string, _id: string, _updates: any): Promise<any> { return undefined; }
  async deleteApiKey(_orgId: string, _id: string): Promise<void> {}

  // --- Invitation operations (not supported in cloud storage) ---
  async createInvitation(_orgId: string, _invitation: any): Promise<any> {
    throw new Error("Invitations require PostgreSQL or in-memory storage");
  }
  async getInvitationByToken(_token: string): Promise<any> {
    return undefined;
  }
  async listInvitations(_orgId: string): Promise<any[]> {
    return [];
  }
  async updateInvitation(_orgId: string, _id: string, _updates: any): Promise<any> {
    return undefined;
  }
  async deleteInvitation(_orgId: string, _id: string): Promise<void> {}

  // --- A/B test operations (not supported in cloud storage) ---
  async createABTest(_orgId: string, _test: any): Promise<any> {
    throw new Error("A/B testing requires PostgreSQL or in-memory storage");
  }
  async getABTest(_orgId: string, _id: string): Promise<any> { return undefined; }
  async getAllABTests(_orgId: string): Promise<any[]> { return []; }
  async updateABTest(_orgId: string, _id: string, _updates: any): Promise<any> { return undefined; }
  async deleteABTest(_orgId: string, _id: string): Promise<void> {}

  // --- Spend tracking (not supported in cloud storage) ---
  async createUsageRecord(_orgId: string, _record: any): Promise<void> {}
  async getUsageRecords(_orgId: string): Promise<any[]> { return []; }
}
