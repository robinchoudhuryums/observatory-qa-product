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
  type Invitation,
  type InsertInvitation,
  type ApiKey,
  type InsertApiKey,
  type Subscription,
  type InsertSubscription,
  type ReferenceDocument,
  type InsertReferenceDocument,
} from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";
import { type IStorage, applyCallFilters } from "./types";

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

  private users = new Map<string, User>();

  // --- User operations ---
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }
  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const newUser: User = { ...user, id, orgId: user.orgId || "", createdAt: new Date().toISOString() };
    this.users.set(id, newUser);
    return newUser;
  }
  async listUsersByOrg(orgId: string): Promise<User[]> {
    return Array.from(this.users.values()).filter(u => u.orgId === orgId);
  }
  async updateUser(orgId: string, id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user || user.orgId !== orgId) return undefined;
    const updated = { ...user, ...updates, orgId }; // prevent orgId override
    this.users.set(id, updated);
    return updated;
  }
  async deleteUser(orgId: string, id: string): Promise<void> {
    const user = this.users.get(id);
    if (user?.orgId === orgId) this.users.delete(id);
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

  private usageEvents: Array<{ orgId: string; eventType: string; quantity: number; metadata?: Record<string, unknown>; createdAt: Date }> = [];

  // --- Usage tracking ---
  async recordUsageEvent(event: { orgId: string; eventType: string; quantity: number; metadata?: Record<string, unknown> }): Promise<void> {
    this.usageEvents.push({ ...event, createdAt: new Date() });
  }

  async getUsageSummary(orgId: string, startDate?: Date, endDate?: Date): Promise<import("./types").UsageSummary[]> {
    let filtered = this.usageEvents.filter(e => e.orgId === orgId);
    if (startDate) filtered = filtered.filter(e => e.createdAt >= startDate);
    if (endDate) filtered = filtered.filter(e => e.createdAt <= endDate);

    const byType = new Map<string, { totalQuantity: number; eventCount: number }>();
    for (const event of filtered) {
      const existing = byType.get(event.eventType) || { totalQuantity: 0, eventCount: 0 };
      existing.totalQuantity += event.quantity;
      existing.eventCount++;
      byType.set(event.eventType, existing);
    }

    return Array.from(byType.entries()).map(([eventType, stats]) => ({
      eventType,
      totalQuantity: stats.totalQuantity,
      eventCount: stats.eventCount,
    }));
  }

  // --- Invitation operations ---
  private invitations = new Map<string, Invitation>();

  async createInvitation(orgId: string, invitation: InsertInvitation): Promise<Invitation> {
    const id = randomUUID();
    const token = invitation.token || randomBytes(32).toString("hex");
    const expiresAt = invitation.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days default
    const newInvitation: Invitation = {
      ...invitation,
      id,
      orgId,
      token,
      status: "pending",
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.invitations.set(id, newInvitation);
    return newInvitation;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    return Array.from(this.invitations.values()).find(i => i.token === token);
  }

  async listInvitations(orgId: string): Promise<Invitation[]> {
    return Array.from(this.invitations.values())
      .filter(i => i.orgId === orgId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateInvitation(orgId: string, id: string, updates: Partial<Invitation>): Promise<Invitation | undefined> {
    const inv = this.invitations.get(id);
    if (!inv || inv.orgId !== orgId) return undefined;
    const updated = { ...inv, ...updates, orgId };
    this.invitations.set(id, updated);
    return updated;
  }

  async deleteInvitation(orgId: string, id: string): Promise<void> {
    const inv = this.invitations.get(id);
    if (inv?.orgId === orgId) this.invitations.delete(id);
  }

  // --- API Key operations ---
  private apiKeys = new Map<string, ApiKey>();

  async createApiKey(orgId: string, apiKey: InsertApiKey): Promise<ApiKey> {
    const id = randomUUID();
    const newKey: ApiKey = {
      ...apiKey,
      id,
      orgId,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.apiKeys.set(id, newKey);
    return newKey;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    return Array.from(this.apiKeys.values()).find(k => k.keyHash === keyHash && k.status === "active");
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    return Array.from(this.apiKeys.values())
      .filter(k => k.orgId === orgId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateApiKey(orgId: string, id: string, updates: Partial<ApiKey>): Promise<ApiKey | undefined> {
    const key = this.apiKeys.get(id);
    if (!key || key.orgId !== orgId) return undefined;
    const updated = { ...key, ...updates, orgId };
    this.apiKeys.set(id, updated);
    return updated;
  }

  async deleteApiKey(orgId: string, id: string): Promise<void> {
    const key = this.apiKeys.get(id);
    if (key?.orgId === orgId) this.apiKeys.delete(id);
  }

  // --- Subscription operations ---
  private subscriptions = new Map<string, Subscription>();

  async getSubscription(orgId: string): Promise<Subscription | undefined> {
    return Array.from(this.subscriptions.values()).find(s => s.orgId === orgId);
  }

  async getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined> {
    return Array.from(this.subscriptions.values()).find(s => s.stripeCustomerId === stripeCustomerId);
  }

  async getSubscriptionByStripeSubId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
    return Array.from(this.subscriptions.values()).find(s => s.stripeSubscriptionId === stripeSubscriptionId);
  }

  async upsertSubscription(orgId: string, sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(orgId);
    const id = existing?.id || randomUUID();
    const now = new Date().toISOString();
    const record: Subscription = {
      ...sub,
      id,
      orgId,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.subscriptions.set(id, record);
    return record;
  }

  async updateSubscription(orgId: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    const existing = await this.getSubscription(orgId);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, orgId, updatedAt: new Date().toISOString() };
    this.subscriptions.set(existing.id, updated);
    return updated;
  }

  // --- Reference document operations ---
  private referenceDocuments = new Map<string, ReferenceDocument>();

  async createReferenceDocument(orgId: string, doc: InsertReferenceDocument): Promise<ReferenceDocument> {
    const id = randomUUID();
    const record: ReferenceDocument = { ...doc, id, orgId, isActive: doc.isActive ?? true, createdAt: new Date().toISOString() };
    this.referenceDocuments.set(id, record);
    return record;
  }

  async getReferenceDocument(orgId: string, id: string): Promise<ReferenceDocument | undefined> {
    const doc = this.referenceDocuments.get(id);
    return doc?.orgId === orgId ? doc : undefined;
  }

  async listReferenceDocuments(orgId: string): Promise<ReferenceDocument[]> {
    return Array.from(this.referenceDocuments.values()).filter(d => d.orgId === orgId);
  }

  async getReferenceDocumentsForCategory(orgId: string, callCategory: string): Promise<ReferenceDocument[]> {
    return Array.from(this.referenceDocuments.values()).filter(d =>
      d.orgId === orgId && d.isActive &&
      (!d.appliesTo || d.appliesTo.length === 0 || d.appliesTo.includes(callCategory))
    );
  }

  async updateReferenceDocument(orgId: string, id: string, updates: Partial<ReferenceDocument>): Promise<ReferenceDocument | undefined> {
    const existing = await this.getReferenceDocument(orgId, id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, id, orgId };
    this.referenceDocuments.set(id, updated);
    return updated;
  }

  async deleteReferenceDocument(orgId: string, id: string): Promise<void> {
    const doc = this.referenceDocuments.get(id);
    if (doc?.orgId === orgId) this.referenceDocuments.delete(id);
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
