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
  async getUserByUsername(username: string, orgId?: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u =>
      u.username === username && (!orgId || u.orgId === orgId)
    );
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
  async getCallByFileHash(orgId: string, fileHash: string): Promise<Call | undefined> {
    return Array.from(this.calls.values()).find(c => c.orgId === orgId && c.fileHash === fileHash && c.status !== "failed");
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

  async getCallSummaries(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallSummary[]> {
    const calls = await this.getAllCalls(orgId);
    let results: CallSummary[] = await Promise.all(
      calls.map(async (call) => {
        const [employee, sentiment, analysis] = await Promise.all([
          call.employeeId ? this.getEmployee(orgId, call.employeeId) : Promise.resolve(undefined),
          this.getSentimentAnalysis(orgId, call.id),
          this.getCallAnalysis(orgId, call.id),
        ]);
        return { ...call, employee, sentiment, analysis } as CallSummary;
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
  async updateTranscript(orgId: string, callId: string, updates: { text: string }): Promise<Transcript | undefined> {
    const t = this.transcripts.get(callId);
    if (!t || t.orgId !== orgId) return undefined;
    const updated = { ...t, text: updates.text };
    this.transcripts.set(callId, updated);
    return updated;
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

  // --- A/B test operations ---
  private abTests = new Map<string, ABTest>();

  async createABTest(orgId: string, test: InsertABTest): Promise<ABTest> {
    const id = randomUUID();
    const record: ABTest = { ...test, id, orgId, createdAt: new Date().toISOString() };
    this.abTests.set(id, record);
    return record;
  }

  async getABTest(orgId: string, id: string): Promise<ABTest | undefined> {
    const test = this.abTests.get(id);
    return test?.orgId === orgId ? test : undefined;
  }

  async getAllABTests(orgId: string): Promise<ABTest[]> {
    return Array.from(this.abTests.values())
      .filter(t => t.orgId === orgId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateABTest(orgId: string, id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
    const test = await this.getABTest(orgId, id);
    if (!test) return undefined;
    const updated = { ...test, ...updates, id, orgId };
    this.abTests.set(id, updated);
    return updated;
  }

  async deleteABTest(orgId: string, id: string): Promise<void> {
    const test = this.abTests.get(id);
    if (test?.orgId === orgId) this.abTests.delete(id);
  }

  // --- Spend tracking / usage records ---
  private usageRecords: UsageRecord[] = [];

  async createUsageRecord(orgId: string, record: UsageRecord): Promise<void> {
    this.usageRecords.push(record);
  }

  async getUsageRecords(orgId: string): Promise<UsageRecord[]> {
    return this.usageRecords
      .filter(r => r.orgId === orgId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  // --- Live sessions (real-time clinical recording) ---
  private liveSessions = new Map<string, LiveSession>();

  async createLiveSession(orgId: string, session: InsertLiveSession): Promise<LiveSession> {
    const id = randomUUID();
    const liveSession: LiveSession = { ...session, id, orgId, startedAt: new Date().toISOString() };
    this.liveSessions.set(id, liveSession);
    return liveSession;
  }

  async getLiveSession(orgId: string, id: string): Promise<LiveSession | undefined> {
    const session = this.liveSessions.get(id);
    return session?.orgId === orgId ? session : undefined;
  }

  async updateLiveSession(orgId: string, id: string, updates: Partial<LiveSession>): Promise<LiveSession | undefined> {
    const session = this.liveSessions.get(id);
    if (!session || session.orgId !== orgId) return undefined;
    const updated = { ...session, ...updates };
    this.liveSessions.set(id, updated);
    return updated;
  }

  async getActiveLiveSessions(orgId: string): Promise<LiveSession[]> {
    return Array.from(this.liveSessions.values()).filter(s => s.orgId === orgId && s.status === "active");
  }

  async getLiveSessionsByUser(orgId: string, userId: string): Promise<LiveSession[]> {
    return Array.from(this.liveSessions.values())
      .filter(s => s.orgId === orgId && s.createdBy === userId)
      .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  }

  // --- Feedback operations ---
  private feedbacks = new Map<string, Feedback>();

  async createFeedback(orgId: string, feedback: InsertFeedback): Promise<Feedback> {
    const id = randomUUID();
    const f: Feedback = { ...feedback, id, orgId, status: "new", createdAt: new Date().toISOString() };
    this.feedbacks.set(id, f);
    return f;
  }

  async getFeedback(orgId: string, id: string): Promise<Feedback | undefined> {
    const f = this.feedbacks.get(id);
    return f?.orgId === orgId ? f : undefined;
  }

  async listFeedback(orgId: string, filters?: { type?: string; status?: string }): Promise<Feedback[]> {
    let results = Array.from(this.feedbacks.values()).filter(f => f.orgId === orgId);
    if (filters?.type) results = results.filter(f => f.type === filters.type);
    if (filters?.status) results = results.filter(f => f.status === filters.status);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateFeedback(orgId: string, id: string, updates: Partial<Feedback>): Promise<Feedback | undefined> {
    const f = this.feedbacks.get(id);
    if (!f || f.orgId !== orgId) return undefined;
    const updated = { ...f, ...updates };
    this.feedbacks.set(id, updated);
    return updated;
  }

  // --- Gamification operations ---
  private employeeBadgesStore = new Map<string, EmployeeBadge>();
  private gamificationProfilesStore = new Map<string, { totalPoints: number; currentStreak: number; longestStreak: number; lastActivityDate?: string }>();

  async getEmployeeBadges(orgId: string, employeeId: string): Promise<EmployeeBadge[]> {
    return Array.from(this.employeeBadgesStore.values()).filter(b => b.orgId === orgId && b.employeeId === employeeId);
  }

  async awardBadge(orgId: string, badge: Omit<EmployeeBadge, "id">): Promise<EmployeeBadge> {
    const existing = Array.from(this.employeeBadgesStore.values()).find(
      b => b.orgId === orgId && b.employeeId === badge.employeeId && b.badgeId === badge.badgeId
    );
    if (existing) return existing;
    const id = randomUUID();
    const b: EmployeeBadge = { ...badge, id, orgId };
    this.employeeBadgesStore.set(id, b);
    return b;
  }

  async getGamificationProfile(orgId: string, employeeId: string) {
    const key = `${orgId}:${employeeId}`;
    return this.gamificationProfilesStore.get(key) || { totalPoints: 0, currentStreak: 0, longestStreak: 0 };
  }

  async updateGamificationProfile(orgId: string, employeeId: string, updates: { totalPoints?: number; currentStreak?: number; longestStreak?: number; lastActivityDate?: string }) {
    const key = `${orgId}:${employeeId}`;
    const existing = this.gamificationProfilesStore.get(key) || { totalPoints: 0, currentStreak: 0, longestStreak: 0 };
    this.gamificationProfilesStore.set(key, { ...existing, ...updates });
  }

  async getLeaderboard(orgId: string, limit = 20) {
    const profiles = Array.from(this.gamificationProfilesStore.entries())
      .filter(([key]) => key.startsWith(`${orgId}:`))
      .map(([key, profile]) => ({
        employeeId: key.split(":")[1],
        totalPoints: profile.totalPoints,
        currentStreak: profile.currentStreak,
        badgeCount: Array.from(this.employeeBadgesStore.values()).filter(b => b.orgId === orgId && b.employeeId === key.split(":")[1]).length,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, limit);
    return profiles;
  }

  // --- Insurance narrative operations ---
  private insuranceNarrativesStore = new Map<string, InsuranceNarrative>();

  async createInsuranceNarrative(orgId: string, narrative: InsertInsuranceNarrative): Promise<InsuranceNarrative> {
    const id = randomUUID();
    const n: InsuranceNarrative = { ...narrative, id, orgId, createdAt: new Date().toISOString() };
    this.insuranceNarrativesStore.set(id, n);
    return n;
  }

  async getInsuranceNarrative(orgId: string, id: string): Promise<InsuranceNarrative | undefined> {
    const n = this.insuranceNarrativesStore.get(id);
    return n?.orgId === orgId ? n : undefined;
  }

  async listInsuranceNarratives(orgId: string, filters?: { callId?: string; status?: string }): Promise<InsuranceNarrative[]> {
    let results = Array.from(this.insuranceNarrativesStore.values()).filter(n => n.orgId === orgId);
    if (filters?.callId) results = results.filter(n => n.callId === filters.callId);
    if (filters?.status) results = results.filter(n => n.status === filters.status);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateInsuranceNarrative(orgId: string, id: string, updates: Partial<InsuranceNarrative>): Promise<InsuranceNarrative | undefined> {
    const n = this.insuranceNarrativesStore.get(id);
    if (!n || n.orgId !== orgId) return undefined;
    const updated = { ...n, ...updates, updatedAt: new Date().toISOString() };
    this.insuranceNarrativesStore.set(id, updated);
    return updated;
  }

  async deleteInsuranceNarrative(orgId: string, id: string): Promise<void> {
    const n = this.insuranceNarrativesStore.get(id);
    if (n?.orgId === orgId) this.insuranceNarrativesStore.delete(id);
  }

  // --- Call revenue operations ---
  private callRevenuesStore = new Map<string, CallRevenue>();

  async createCallRevenue(orgId: string, revenue: InsertCallRevenue): Promise<CallRevenue> {
    const id = randomUUID();
    const r: CallRevenue = { ...revenue, id, orgId, createdAt: new Date().toISOString() };
    this.callRevenuesStore.set(`${orgId}:${revenue.callId}`, r);
    return r;
  }

  async getCallRevenue(orgId: string, callId: string): Promise<CallRevenue | undefined> {
    return this.callRevenuesStore.get(`${orgId}:${callId}`);
  }

  async listCallRevenues(orgId: string, filters?: { conversionStatus?: string }): Promise<CallRevenue[]> {
    let results = Array.from(this.callRevenuesStore.values()).filter(r => r.orgId === orgId);
    if (filters?.conversionStatus) results = results.filter(r => r.conversionStatus === filters.conversionStatus);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateCallRevenue(orgId: string, callId: string, updates: Partial<CallRevenue>): Promise<CallRevenue | undefined> {
    const key = `${orgId}:${callId}`;
    const r = this.callRevenuesStore.get(key);
    if (!r) return undefined;
    const updated = { ...r, ...updates, updatedAt: new Date().toISOString() };
    this.callRevenuesStore.set(key, updated);
    return updated;
  }

  async getRevenueMetrics(orgId: string) {
    const revenues = Array.from(this.callRevenuesStore.values()).filter(r => r.orgId === orgId);
    const totalEstimated = revenues.reduce((sum, r) => sum + (r.estimatedRevenue || 0), 0);
    const totalActual = revenues.reduce((sum, r) => sum + (r.actualRevenue || 0), 0);
    const converted = revenues.filter(r => r.conversionStatus === "converted").length;
    const total = revenues.filter(r => r.conversionStatus !== "unknown").length;
    const conversionRate = total > 0 ? converted / total : 0;
    const avgDealValue = converted > 0 ? totalActual / converted : 0;
    return { totalEstimated, totalActual, conversionRate, avgDealValue };
  }

  // --- Calibration session operations ---
  private calibrationSessionsStore = new Map<string, CalibrationSession>();
  private calibrationEvaluationsStore = new Map<string, CalibrationEvaluation>();

  async createCalibrationSession(orgId: string, session: InsertCalibrationSession): Promise<CalibrationSession> {
    const id = randomUUID();
    const s: CalibrationSession = { ...session, id, orgId, createdAt: new Date().toISOString() };
    this.calibrationSessionsStore.set(id, s);
    return s;
  }

  async getCalibrationSession(orgId: string, id: string): Promise<CalibrationSession | undefined> {
    const s = this.calibrationSessionsStore.get(id);
    return s?.orgId === orgId ? s : undefined;
  }

  async listCalibrationSessions(orgId: string, filters?: { status?: string }): Promise<CalibrationSession[]> {
    let results = Array.from(this.calibrationSessionsStore.values()).filter(s => s.orgId === orgId);
    if (filters?.status) results = results.filter(s => s.status === filters.status);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async updateCalibrationSession(orgId: string, id: string, updates: Partial<CalibrationSession>): Promise<CalibrationSession | undefined> {
    const s = this.calibrationSessionsStore.get(id);
    if (!s || s.orgId !== orgId) return undefined;
    const updated = { ...s, ...updates };
    this.calibrationSessionsStore.set(id, updated);
    return updated;
  }

  async deleteCalibrationSession(orgId: string, id: string): Promise<void> {
    const s = this.calibrationSessionsStore.get(id);
    if (s?.orgId === orgId) {
      this.calibrationSessionsStore.delete(id);
      // Cascade delete evaluations
      Array.from(this.calibrationEvaluationsStore.entries()).forEach(([eid, e]) => {
        if (e.sessionId === id) this.calibrationEvaluationsStore.delete(eid);
      });
    }
  }

  async createCalibrationEvaluation(orgId: string, evaluation: InsertCalibrationEvaluation): Promise<CalibrationEvaluation> {
    const id = randomUUID();
    const e: CalibrationEvaluation = { ...evaluation, id, orgId, createdAt: new Date().toISOString() };
    this.calibrationEvaluationsStore.set(id, e);
    return e;
  }

  async getCalibrationEvaluations(orgId: string, sessionId: string): Promise<CalibrationEvaluation[]> {
    return Array.from(this.calibrationEvaluationsStore.values())
      .filter(e => e.orgId === orgId && e.sessionId === sessionId);
  }

  async updateCalibrationEvaluation(orgId: string, id: string, updates: Partial<CalibrationEvaluation>): Promise<CalibrationEvaluation | undefined> {
    const e = this.calibrationEvaluationsStore.get(id);
    if (!e || e.orgId !== orgId) return undefined;
    const updated = { ...e, ...updates };
    this.calibrationEvaluationsStore.set(id, updated);
    return updated;
  }

  // --- Marketing Attribution ---
  private marketingCampaignsStore = new Map<string, MarketingCampaign>();
  private callAttributionsStore = new Map<string, CallAttribution>();

  async createMarketingCampaign(orgId: string, campaign: InsertMarketingCampaign): Promise<MarketingCampaign> {
    const id = randomUUID();
    const c: MarketingCampaign = { ...campaign, id, orgId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.marketingCampaignsStore.set(id, c);
    return c;
  }
  async getMarketingCampaign(orgId: string, id: string): Promise<MarketingCampaign | undefined> {
    const c = this.marketingCampaignsStore.get(id);
    return c?.orgId === orgId ? c : undefined;
  }
  async listMarketingCampaigns(orgId: string, filters?: { source?: string; isActive?: boolean }): Promise<MarketingCampaign[]> {
    let results = Array.from(this.marketingCampaignsStore.values()).filter(c => c.orgId === orgId);
    if (filters?.source) results = results.filter(c => c.source === filters.source);
    if (filters?.isActive !== undefined) results = results.filter(c => c.isActive === filters.isActive);
    return results;
  }
  async updateMarketingCampaign(orgId: string, id: string, updates: Partial<MarketingCampaign>): Promise<MarketingCampaign | undefined> {
    const c = this.marketingCampaignsStore.get(id);
    if (!c || c.orgId !== orgId) return undefined;
    const updated = { ...c, ...updates, updatedAt: new Date().toISOString() };
    this.marketingCampaignsStore.set(id, updated);
    return updated;
  }
  async deleteMarketingCampaign(orgId: string, id: string): Promise<void> {
    const c = this.marketingCampaignsStore.get(id);
    if (c?.orgId === orgId) this.marketingCampaignsStore.delete(id);
  }

  async createCallAttribution(orgId: string, attribution: InsertCallAttribution): Promise<CallAttribution> {
    const id = randomUUID();
    const a: CallAttribution = { ...attribution, id, orgId, createdAt: new Date().toISOString() };
    this.callAttributionsStore.set(attribution.callId, a);
    return a;
  }
  async getCallAttribution(orgId: string, callId: string): Promise<CallAttribution | undefined> {
    const a = this.callAttributionsStore.get(callId);
    return a?.orgId === orgId ? a : undefined;
  }
  async listCallAttributions(orgId: string, filters?: { source?: string; campaignId?: string }): Promise<CallAttribution[]> {
    let results = Array.from(this.callAttributionsStore.values()).filter(a => a.orgId === orgId);
    if (filters?.source) results = results.filter(a => a.source === filters.source);
    if (filters?.campaignId) results = results.filter(a => a.campaignId === filters.campaignId);
    return results;
  }
  async updateCallAttribution(orgId: string, callId: string, updates: Partial<CallAttribution>): Promise<CallAttribution | undefined> {
    const a = this.callAttributionsStore.get(callId);
    if (!a || a.orgId !== orgId) return undefined;
    const updated = { ...a, ...updates };
    this.callAttributionsStore.set(callId, updated);
    return updated;
  }
  async deleteCallAttribution(orgId: string, callId: string): Promise<void> {
    const a = this.callAttributionsStore.get(callId);
    if (a?.orgId === orgId) this.callAttributionsStore.delete(callId);
  }

  // --- LMS: Learning Modules ---
  private learningModulesStore = new Map<string, LearningModule>();
  private learningPathsStore = new Map<string, LearningPath>();
  private learningProgressStore = new Map<string, LearningProgress>();

  async createLearningModule(orgId: string, module: InsertLearningModule): Promise<LearningModule> {
    const id = randomUUID();
    const m: LearningModule = { ...module, id, orgId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.learningModulesStore.set(id, m);
    return m;
  }
  async getLearningModule(orgId: string, id: string): Promise<LearningModule | undefined> {
    const m = this.learningModulesStore.get(id);
    return m?.orgId === orgId ? m : undefined;
  }
  async listLearningModules(orgId: string, filters?: { category?: string; contentType?: string; isPublished?: boolean }): Promise<LearningModule[]> {
    let results = Array.from(this.learningModulesStore.values()).filter(m => m.orgId === orgId);
    if (filters?.category) results = results.filter(m => m.category === filters.category);
    if (filters?.contentType) results = results.filter(m => m.contentType === filters.contentType);
    if (filters?.isPublished !== undefined) results = results.filter(m => m.isPublished === filters.isPublished);
    return results.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }
  async updateLearningModule(orgId: string, id: string, updates: Partial<LearningModule>): Promise<LearningModule | undefined> {
    const m = this.learningModulesStore.get(id);
    if (!m || m.orgId !== orgId) return undefined;
    const updated = { ...m, ...updates, updatedAt: new Date().toISOString() };
    this.learningModulesStore.set(id, updated);
    return updated;
  }
  async deleteLearningModule(orgId: string, id: string): Promise<void> {
    const m = this.learningModulesStore.get(id);
    if (m?.orgId === orgId) this.learningModulesStore.delete(id);
  }

  async createLearningPath(orgId: string, path: InsertLearningPath): Promise<LearningPath> {
    const id = randomUUID();
    const p: LearningPath = { ...path, id, orgId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.learningPathsStore.set(id, p);
    return p;
  }
  async getLearningPath(orgId: string, id: string): Promise<LearningPath | undefined> {
    const p = this.learningPathsStore.get(id);
    return p?.orgId === orgId ? p : undefined;
  }
  async listLearningPaths(orgId: string): Promise<LearningPath[]> {
    return Array.from(this.learningPathsStore.values()).filter(p => p.orgId === orgId);
  }
  async updateLearningPath(orgId: string, id: string, updates: Partial<LearningPath>): Promise<LearningPath | undefined> {
    const p = this.learningPathsStore.get(id);
    if (!p || p.orgId !== orgId) return undefined;
    const updated = { ...p, ...updates, updatedAt: new Date().toISOString() };
    this.learningPathsStore.set(id, updated);
    return updated;
  }
  async deleteLearningPath(orgId: string, id: string): Promise<void> {
    const p = this.learningPathsStore.get(id);
    if (p?.orgId === orgId) this.learningPathsStore.delete(id);
  }

  async upsertLearningProgress(orgId: string, progress: InsertLearningProgress): Promise<LearningProgress> {
    const key = `${orgId}:${progress.employeeId}:${progress.moduleId}`;
    const existing = Array.from(this.learningProgressStore.values()).find(
      p => p.orgId === orgId && p.employeeId === progress.employeeId && p.moduleId === progress.moduleId
    );
    if (existing) {
      const updated: LearningProgress = { ...existing, ...progress, updatedAt: new Date().toISOString() };
      this.learningProgressStore.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const p: LearningProgress = { ...progress, id, orgId, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.learningProgressStore.set(id, p);
    return p;
  }
  async getLearningProgress(orgId: string, employeeId: string, moduleId: string): Promise<LearningProgress | undefined> {
    return Array.from(this.learningProgressStore.values()).find(
      p => p.orgId === orgId && p.employeeId === employeeId && p.moduleId === moduleId
    );
  }
  async getEmployeeLearningProgress(orgId: string, employeeId: string): Promise<LearningProgress[]> {
    return Array.from(this.learningProgressStore.values()).filter(
      p => p.orgId === orgId && p.employeeId === employeeId
    );
  }
  async getModuleCompletionStats(orgId: string, moduleId: string): Promise<{ total: number; completed: number; inProgress: number; avgScore: number }> {
    const progress = Array.from(this.learningProgressStore.values()).filter(
      p => p.orgId === orgId && p.moduleId === moduleId
    );
    const completed = progress.filter(p => p.status === "completed");
    const scores = completed.filter(p => p.quizScore !== undefined && p.quizScore !== null).map(p => p.quizScore!);
    return {
      total: progress.length,
      completed: completed.length,
      inProgress: progress.filter(p => p.status === "in_progress").length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    };
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
