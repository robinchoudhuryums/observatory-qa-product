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
import { GcsClient } from "./services/gcs";
import { S3Client } from "./services/s3";
import { randomUUID } from "crypto";

/**
 * Run async tasks with bounded concurrency.
 * Avoids overwhelming S3/GCS with hundreds of simultaneous requests.
 */
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
  return {
    ...analysis,
    topics: Array.isArray(analysis.topics) ? analysis.topics : [],
    actionItems: Array.isArray(analysis.actionItems) ? analysis.actionItems : [],
    flags: Array.isArray(analysis.flags) ? analysis.flags : [],
    feedback: (analysis.feedback && typeof analysis.feedback === "object" && !Array.isArray(analysis.feedback))
      ? analysis.feedback
      : { strengths: [], suggestions: [] },
    summary: typeof analysis.summary === "string" ? analysis.summary : "",
  };
}

/** Apply standard call filters (status, sentiment, employee) */
function applyCallFilters(
  calls: CallWithDetails[],
  filters: { status?: string; sentiment?: string; employee?: string }
): CallWithDetails[] {
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

  // User operations (env-var-based)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

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
  getAllCalls(orgId: string): Promise<Call[]>;
  getCallsWithDetails(orgId: string, filters?: { status?: string; sentiment?: string; employee?: string }): Promise<CallWithDetails[]>;

  // Transcript operations (org-scoped)
  getTranscript(orgId: string, callId: string): Promise<Transcript | undefined>;
  createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript>;

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
}

/**
 * In-memory storage fallback for when cloud credentials are not configured.
 * Data lives only for the lifetime of the process.
 */
export class MemStorage implements IStorage {
  private organizations = new Map<string, Organization>();
  private employees = new Map<string, Employee>();
  private calls = new Map<string, Call>();
  private transcripts = new Map<string, Transcript>();
  private sentiments = new Map<string, SentimentAnalysis>();
  private analyses = new Map<string, CallAnalysis>();
  private audioFiles = new Map<string, Buffer>(); // objectName -> buffer
  private accessRequests = new Map<string, AccessRequest>();
  private promptTemplates = new Map<string, PromptTemplate>();
  private coachingSessions = new Map<string, CoachingSession>();

  // --- Organization operations ---
  async getOrganization(orgId: string): Promise<Organization | undefined> {
    return this.organizations.get(orgId);
  }
  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    return Array.from(this.organizations.values()).find(o => o.slug === slug);
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const newOrg: Organization = { ...org, id, createdAt: new Date().toISOString() };
    this.organizations.set(id, newOrg);
    return newOrg;
  }
  async updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const org = this.organizations.get(orgId);
    if (!org) return undefined;
    const updated = { ...org, ...updates };
    this.organizations.set(orgId, updated);
    return updated;
  }
  async listOrganizations(): Promise<Organization[]> {
    return Array.from(this.organizations.values());
  }

  // --- User operations (env-var-based) ---
  async getUser(_id: string): Promise<User | undefined> { return undefined; }
  async getUserByUsername(_username: string): Promise<User | undefined> { return undefined; }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }

  // --- Employee operations (org-scoped) ---
  async getEmployee(orgId: string, id: string): Promise<Employee | undefined> {
    const emp = this.employees.get(id);
    return emp?.orgId === orgId ? emp : undefined;
  }
  async getEmployeeByEmail(orgId: string, email: string): Promise<Employee | undefined> {
    return Array.from(this.employees.values()).find(e => e.orgId === orgId && e.email === email);
  }
  async createEmployee(orgId: string, employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const newEmployee: Employee = { ...employee, id, orgId, createdAt: new Date().toISOString() };
    this.employees.set(id, newEmployee);
    return newEmployee;
  }
  async updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const employee = await this.getEmployee(orgId, id);
    if (!employee) return undefined;
    const updated = { ...employee, ...updates, orgId }; // prevent orgId override
    this.employees.set(id, updated);
    return updated;
  }
  async getAllEmployees(orgId: string): Promise<Employee[]> {
    return Array.from(this.employees.values()).filter(e => e.orgId === orgId);
  }

  // --- Call operations (org-scoped) ---
  async getCall(orgId: string, id: string): Promise<Call | undefined> {
    const call = this.calls.get(id);
    return call?.orgId === orgId ? call : undefined;
  }
  async createCall(orgId: string, call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const newCall: Call = { ...call, id, orgId, uploadedAt: new Date().toISOString() };
    this.calls.set(id, newCall);
    return newCall;
  }
  async updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = await this.getCall(orgId, id);
    if (!call) return undefined;
    const updated = { ...call, ...updates, orgId };
    this.calls.set(id, updated);
    return updated;
  }
  async deleteCall(orgId: string, id: string): Promise<void> {
    const call = await this.getCall(orgId, id);
    if (!call) return;
    this.calls.delete(id);
    this.transcripts.delete(id);
    this.sentiments.delete(id);
    this.analyses.delete(id);
    for (const key of Array.from(this.audioFiles.keys())) {
      if (key.startsWith(`${orgId}/audio/${id}/`)) this.audioFiles.delete(key);
    }
  }
  async getAllCalls(orgId: string): Promise<Call[]> {
    return Array.from(this.calls.values())
      .filter(c => c.orgId === orgId)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
  }
  async getCallsWithDetails(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    const calls = await this.getAllCalls(orgId);
    let results: CallWithDetails[] = await Promise.all(
      calls.map(async (call) => {
        const [employee, transcript, sentiment, analysis] = await Promise.all([
          call.employeeId ? this.getEmployee(orgId, call.employeeId) : Promise.resolve(undefined),
          this.getTranscript(orgId, call.id),
          this.getSentimentAnalysis(orgId, call.id),
          this.getCallAnalysis(orgId, call.id),
        ]);
        return { ...call, employee, transcript, sentiment, analysis } as CallWithDetails;
      })
    );
    return applyCallFilters(results, filters);
  }

  // --- Transcript operations (org-scoped) ---
  async getTranscript(orgId: string, callId: string): Promise<Transcript | undefined> {
    const t = this.transcripts.get(callId);
    return t?.orgId === orgId ? t : undefined;
  }
  async createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const newTranscript: Transcript = { ...transcript, id, orgId, createdAt: new Date().toISOString() };
    this.transcripts.set(transcript.callId, newTranscript);
    return newTranscript;
  }

  // --- Sentiment operations (org-scoped) ---
  async getSentimentAnalysis(orgId: string, callId: string): Promise<SentimentAnalysis | undefined> {
    const s = this.sentiments.get(callId);
    return s?.orgId === orgId ? s : undefined;
  }
  async createSentimentAnalysis(orgId: string, sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const newSentiment: SentimentAnalysis = { ...sentiment, id, orgId, createdAt: new Date().toISOString() };
    this.sentiments.set(sentiment.callId, newSentiment);
    return newSentiment;
  }

  // --- Call analysis operations (org-scoped) ---
  async getCallAnalysis(orgId: string, callId: string): Promise<CallAnalysis | undefined> {
    const a = this.analyses.get(callId);
    return a?.orgId === orgId ? a : undefined;
  }
  async createCallAnalysis(orgId: string, analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = { ...analysis, id, orgId, createdAt: new Date().toISOString() };
    this.analyses.set(analysis.callId, newAnalysis);
    return newAnalysis;
  }

  // --- Audio operations (org-scoped) ---
  async uploadAudio(orgId: string, callId: string, fileName: string, buffer: Buffer, _contentType: string): Promise<void> {
    this.audioFiles.set(`${orgId}/audio/${callId}/${fileName}`, buffer);
  }
  async getAudioFiles(orgId: string, callId: string): Promise<string[]> {
    return Array.from(this.audioFiles.keys()).filter(k => k.startsWith(`${orgId}/audio/${callId}/`));
  }
  async downloadAudio(orgId: string, objectName: string): Promise<Buffer | undefined> {
    // objectName may already include the org prefix or be a relative path
    return this.audioFiles.get(objectName) || this.audioFiles.get(`${orgId}/${objectName}`);
  }

  // --- Dashboard metrics (org-scoped) ---
  async getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
    const orgCalls = Array.from(this.calls.values()).filter(c => c.orgId === orgId);
    const orgCallIds = new Set(orgCalls.map(c => c.id));
    const sentiments = Array.from(this.sentiments.values()).filter(s => orgCallIds.has(s.callId));
    const analyses = Array.from(this.analyses.values()).filter(a => orgCallIds.has(a.callId));
    const avgSentiment = sentiments.length > 0
      ? (sentiments.reduce((sum, s) => sum + parseFloat(s.overallScore || "0"), 0) / sentiments.length) * 10
      : 0;
    const avgPerformanceScore = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + parseFloat(a.performanceScore || "0"), 0) / analyses.length
      : 0;
    return {
      totalCalls: orgCalls.length,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(orgId: string): Promise<SentimentDistribution> {
    const distribution: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    const orgCallIds = new Set(Array.from(this.calls.values()).filter(c => c.orgId === orgId).map(c => c.id));
    for (const s of Array.from(this.sentiments.values())) {
      if (!orgCallIds.has(s.callId)) continue;
      const key = s.overallSentiment as keyof SentimentDistribution;
      if (key in distribution) distribution[key]++;
    }
    return distribution;
  }

  async getTopPerformers(orgId: string, limit = 3): Promise<TopPerformer[]> {
    const orgCalls = Array.from(this.calls.values()).filter(c => c.orgId === orgId);
    const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
    for (const call of orgCalls) {
      if (!call.employeeId) continue;
      const analysis = this.analyses.get(call.id);
      const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
      stats.callCount++;
      if (analysis?.performanceScore) stats.totalScore += parseFloat(analysis.performanceScore);
      employeeStats.set(call.employeeId, stats);
    }
    const orgEmployees = Array.from(this.employees.values()).filter(e => e.orgId === orgId);
    return orgEmployees
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

  // --- Access request operations (org-scoped) ---
  async createAccessRequest(orgId: string, request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const newReq: AccessRequest = { ...request, id, orgId, status: "pending", createdAt: new Date().toISOString() };
    this.accessRequests.set(id, newReq);
    return newReq;
  }
  async getAllAccessRequests(orgId: string): Promise<AccessRequest[]> {
    return Array.from(this.accessRequests.values())
      .filter(r => r.orgId === orgId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }
  async getAccessRequest(orgId: string, id: string): Promise<AccessRequest | undefined> {
    const req = this.accessRequests.get(id);
    return req?.orgId === orgId ? req : undefined;
  }
  async updateAccessRequest(orgId: string, id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const req = await this.getAccessRequest(orgId, id);
    if (!req) return undefined;
    const updated = { ...req, ...updates, orgId };
    this.accessRequests.set(id, updated);
    return updated;
  }

  // --- Prompt template operations (org-scoped) ---
  async getPromptTemplate(orgId: string, id: string): Promise<PromptTemplate | undefined> {
    const tmpl = this.promptTemplates.get(id);
    return tmpl?.orgId === orgId ? tmpl : undefined;
  }
  async getPromptTemplateByCategory(orgId: string, callCategory: string): Promise<PromptTemplate | undefined> {
    return Array.from(this.promptTemplates.values()).find(
      t => t.orgId === orgId && t.callCategory === callCategory && t.isActive
    );
  }
  async getAllPromptTemplates(orgId: string): Promise<PromptTemplate[]> {
    return Array.from(this.promptTemplates.values()).filter(t => t.orgId === orgId);
  }
  async createPromptTemplate(orgId: string, template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const newTemplate: PromptTemplate = { ...template, id, orgId, updatedAt: new Date().toISOString() };
    this.promptTemplates.set(id, newTemplate);
    return newTemplate;
  }
  async updatePromptTemplate(orgId: string, id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const tmpl = await this.getPromptTemplate(orgId, id);
    if (!tmpl) return undefined;
    const updated = { ...tmpl, ...updates, orgId, updatedAt: new Date().toISOString() };
    this.promptTemplates.set(id, updated);
    return updated;
  }
  async deletePromptTemplate(orgId: string, id: string): Promise<void> {
    const tmpl = await this.getPromptTemplate(orgId, id);
    if (tmpl) this.promptTemplates.delete(id);
  }

  // --- Coaching session operations (org-scoped) ---
  async createCoachingSession(orgId: string, session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const newSession: CoachingSession = { ...session, id, orgId, createdAt: new Date().toISOString() };
    this.coachingSessions.set(id, newSession);
    return newSession;
  }
  async getCoachingSession(orgId: string, id: string): Promise<CoachingSession | undefined> {
    const s = this.coachingSessions.get(id);
    return s?.orgId === orgId ? s : undefined;
  }
  async getAllCoachingSessions(orgId: string): Promise<CoachingSession[]> {
    return Array.from(this.coachingSessions.values()).filter(s => s.orgId === orgId);
  }
  async getCoachingSessionsByEmployee(orgId: string, employeeId: string): Promise<CoachingSession[]> {
    return Array.from(this.coachingSessions.values()).filter(
      s => s.orgId === orgId && s.employeeId === employeeId
    );
  }
  async updateCoachingSession(orgId: string, id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const session = await this.getCoachingSession(orgId, id);
    if (!session) return undefined;
    const updated = { ...session, ...updates, orgId };
    this.coachingSessions.set(id, updated);
    return updated;
  }

  // --- Data retention (org-scoped) ---
  async purgeExpiredCalls(orgId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    let purged = 0;
    const orgCalls = Array.from(this.calls.values()).filter(c => c.orgId === orgId);
    for (const call of orgCalls) {
      if (new Date(call.uploadedAt || 0) < cutoff) {
        await this.deleteCall(orgId, call.id);
        purged++;
      }
    }
    return purged;
  }
}

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
    console.log(`Fetching employees for org ${orgId}...`);
    try {
      const employees = await this.client.listAndDownloadJson<Employee>(`${this.orgPrefix(orgId)}/employees/`);
      console.log(`Found ${employees.length} employees.`);
      return employees;
    } catch (error) {
      console.error("Error fetching employees:", error);
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
    console.log(`Fetching calls with details for org ${orgId}, filters:`, filters);

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

    console.log(`Returning ${filtered.length} filtered calls.`);
    return filtered;
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
      console.warn(`[SECURITY] Cross-org audio access blocked: org=${orgId}, path=${objectName}`);
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
        console.log(`[RETENTION] Purging call ${call.id} in org ${orgId} (uploaded ${uploadDate.toISOString()}, older than ${retentionDays} days)`);
        await this.deleteCall(orgId, call.id);
        purged++;
      }
    }

    return purged;
  }
}

/**
 * Create the storage backend based on environment configuration.
 *
 * Priority:
 *   1. STORAGE_BACKEND=postgres + DATABASE_URL → PostgresStorage (recommended for SaaS)
 *   2. STORAGE_BACKEND=s3 or S3_BUCKET → CloudStorage (S3)
 *   3. STORAGE_BACKEND=gcs or GCS_CREDENTIALS → CloudStorage (GCS)
 *   4. No config → MemStorage (development only)
 *
 * When using PostgresStorage, an optional S3/GCS client can be provided
 * for audio blob storage. Set S3_BUCKET alongside DATABASE_URL for this.
 */
function createStorage(): IStorage {
  const storageBackend = process.env.STORAGE_BACKEND?.toLowerCase();

  // PostgreSQL backend (recommended for multi-tenant SaaS)
  // Note: Requires initDatabase() to be called first — see initPostgresStorage()
  if (storageBackend === "postgres") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when STORAGE_BACKEND=postgres");
    }
    // PostgresStorage is initialized asynchronously in initPostgresStorage()
    // For now, return MemStorage as placeholder (will be replaced on startup)
    console.log("[STORAGE] PostgreSQL backend selected — will initialize after DB connection");
    return new MemStorage();
  }

  // Explicit S3 or auto-detect via AWS credentials + S3_BUCKET
  if (storageBackend === "s3" || (!storageBackend && process.env.S3_BUCKET)) {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error("S3_BUCKET environment variable is required when using S3 storage backend");
    }
    console.log(`[STORAGE] Using S3 (bucket: ${bucket})`);
    return new CloudStorage(new S3Client(bucket));
  }

  // Explicit GCS or auto-detect via GCS credentials
  if (storageBackend === "gcs" || process.env.GCS_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      throw new Error("GCS_BUCKET environment variable is required when using GCS storage backend");
    }
    console.log(`[STORAGE] Using GCS (bucket: ${bucket})`);
    return new CloudStorage(new GcsClient(bucket));
  }

  // PRODUCTION SAFETY: Warn loudly if no persistent backend is configured
  if (process.env.NODE_ENV === "production") {
    console.error("[STORAGE] WARNING: No persistent storage backend configured in production!");
    console.error("[STORAGE] Set STORAGE_BACKEND=postgres with DATABASE_URL, or configure S3/GCS.");
    console.error("[STORAGE] Data WILL BE LOST on restart with in-memory storage.");
  }

  console.log("[STORAGE] No cloud credentials — using in-memory storage (data will not persist across restarts)");
  return new MemStorage();
}

export let storage: IStorage = createStorage();

/**
 * Initialize PostgreSQL storage backend (called during server startup).
 * Replaces the placeholder MemStorage with a real PostgresStorage instance.
 */
export async function initPostgresStorage(): Promise<boolean> {
  if (process.env.STORAGE_BACKEND?.toLowerCase() !== "postgres") {
    return false;
  }

  try {
    const { initDatabase } = await import("./db/index");
    const { PostgresStorage } = await import("./db/pg-storage");

    const db = await initDatabase();
    if (!db) {
      console.error("[STORAGE] Failed to connect to PostgreSQL — falling back to in-memory");
      return false;
    }

    // Optional: create blob client for audio files stored in S3
    let blobClient: ObjectStorageClient | null = null;
    if (process.env.S3_BUCKET) {
      blobClient = new S3Client(process.env.S3_BUCKET);
      console.log(`[STORAGE] Audio blob storage: S3 (bucket: ${process.env.S3_BUCKET})`);
    }

    storage = new PostgresStorage(db, blobClient);
    console.log("[STORAGE] PostgreSQL storage backend initialized");
    return true;
  } catch (error) {
    console.error("[STORAGE] PostgreSQL initialization failed:", error);
    return false;
  }
}
