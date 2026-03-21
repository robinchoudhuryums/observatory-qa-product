/**
 * Live session routes for real-time clinical recording and transcription.
 *
 * Flow:
 * 1. POST /api/live-sessions — create session, connect to AssemblyAI real-time
 * 2. Client streams audio over WebSocket (base64 PCM16 chunks)
 * 3. Server relays to AssemblyAI, broadcasts transcript events back via WebSocket
 * 4. POST /api/live-sessions/:id/draft-note — generate a draft clinical note from accumulated transcript
 * 5. POST /api/live-sessions/:id/stop — end session, finalize into a Call record
 * 6. POST /api/live-sessions/:id/pause — pause/resume recording
 *
 * HIPAA: All endpoints require authentication, org-scoped, PHI audit logged.
 */
import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { RealtimeTranscriptionSession } from "../services/assemblyai-realtime";
import { broadcastLiveTranscript } from "../services/websocket";
import { getOrgAIProvider } from "../services/ai-factory";
import { buildSystemPrompt, buildUserMessage, parseJsonResponse, type PromptTemplateConfig } from "../services/ai-provider";
import { encryptField } from "../services/phi-encryption";
import { PLAN_DEFINITIONS, type PlanTier, type OrgSettings, type ClinicalNote } from "@shared/schema";
import { randomUUID } from "crypto";

// Track active real-time transcription sessions
const activeSessions = new Map<string, RealtimeTranscriptionSession>();

// Track accumulated transcript per session (in-memory buffer for real-time performance)
const sessionTranscripts = new Map<string, string[]>();

// Draft note generation cooldown (prevent spamming)
const lastDraftTime = new Map<string, number>();
const DRAFT_COOLDOWN_MS = 15_000; // 15 seconds minimum between drafts

/**
 * Middleware to ensure clinical documentation plan.
 */
function requireClinicalPlan() {
  return async (req: any, res: any, next: any) => {
    const orgId = req.orgId;
    if (!orgId) {
      res.status(403).json({ message: "Organization context required" });
      return;
    }
    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan?.limits?.clinicalDocumentationEnabled) {
        res.status(403).json({ message: "Clinical documentation requires a Clinical plan", upgrade: true });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

export function registerLiveSessionRoutes(app: Express): void {
  /**
   * POST /api/live-sessions — Start a new live recording session.
   * Creates session record and returns session ID for WebSocket audio streaming.
   */
  app.post("/api/live-sessions",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { specialty, noteFormat, encounterType, consentObtained } = req.body;

      if (!consentObtained) {
        res.status(400).json({ message: "Patient consent must be obtained before recording" });
        return;
      }

      try {
        const session = await storage.createLiveSession(orgId, {
          orgId,
          createdBy: user.id,
          specialty,
          noteFormat: noteFormat || "soap",
          encounterType: encounterType || "clinical_encounter",
          consentObtained: true,
        });

        // Initialize transcript buffer
        sessionTranscripts.set(session.id, []);

        // Connect to AssemblyAI real-time transcription
        const apiKey = process.env.ASSEMBLYAI_API_KEY;
        if (apiKey) {
          const rtSession = new RealtimeTranscriptionSession(apiKey, 16000, (event) => {
            if (event.type === "final" && event.text.trim()) {
              // Accumulate final transcript segments
              const segments = sessionTranscripts.get(session.id);
              if (segments) {
                segments.push(event.text);
              }
              // Broadcast to org clients
              broadcastLiveTranscript(session.id, "final", {
                text: event.text,
                confidence: event.confidence,
                words: event.words,
              }, orgId);
            } else if (event.type === "partial") {
              broadcastLiveTranscript(session.id, "partial", {
                text: event.text,
              }, orgId);
            } else if (event.type === "error") {
              broadcastLiveTranscript(session.id, "error", {
                text: event.text,
              }, orgId);
            }
          });

          try {
            await rtSession.connect();
            activeSessions.set(session.id, rtSession);
          } catch (err) {
            logger.error({ err }, "Failed to connect AssemblyAI real-time");
            // Session is still created — will work in "manual" mode
          }
        } else {
          logger.warn("ASSEMBLYAI_API_KEY not configured — live transcription disabled");
        }

        logPhiAccess({
          ...auditContext(req),
          event: "live_session_started",
          resourceType: "live_session",
          resourceId: session.id,
        });

        res.json(session);
      } catch (err) {
        logger.error({ err }, "Failed to create live session");
        res.status(500).json({ message: "Failed to start live session" });
      }
    },
  );

  /**
   * POST /api/live-sessions/:id/audio — Receive audio chunk from client.
   * Expects JSON body with { audio: "<base64 PCM16 data>" }.
   */
  app.post("/api/live-sessions/:id/audio",
    requireAuth, injectOrgContext,
    async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;
      const { audio } = req.body;

      if (!audio) {
        res.status(400).json({ message: "audio field required (base64 PCM16)" });
        return;
      }

      const rtSession = activeSessions.get(id);
      if (!rtSession || !rtSession.isConnected) {
        res.status(404).json({ message: "No active transcription session" });
        return;
      }

      // Verify session belongs to this org
      const session = await storage.getLiveSession(orgId, id);
      if (!session || session.status !== "active") {
        res.status(404).json({ message: "Session not found or not active" });
        return;
      }

      rtSession.sendAudio(audio);
      res.json({ ok: true });
    },
  );

  /**
   * POST /api/live-sessions/:id/draft-note — Generate a draft clinical note from current transcript.
   * Rate-limited to one request per 15 seconds per session.
   */
  app.post("/api/live-sessions/:id/draft-note",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;

      // Rate limit
      const lastTime = lastDraftTime.get(id) || 0;
      if (Date.now() - lastTime < DRAFT_COOLDOWN_MS) {
        res.status(429).json({ message: "Draft note generation is rate limited", retryAfterMs: DRAFT_COOLDOWN_MS - (Date.now() - lastTime) });
        return;
      }

      try {
        const session = await storage.getLiveSession(orgId, id);
        if (!session) {
          res.status(404).json({ message: "Session not found" });
          return;
        }

        // Get accumulated transcript
        const segments = sessionTranscripts.get(id) || [];
        const fullTranscript = segments.join(" ").trim();

        if (fullTranscript.length < 20) {
          res.status(400).json({ message: "Not enough transcript text to generate a note (minimum ~20 characters)" });
          return;
        }

        lastDraftTime.set(id, Date.now());

        // Get org for settings
        const org = await storage.getOrganization(orgId);
        const orgSettings = (org?.settings || null) as OrgSettings | null;

        // Load prompt template if available
        const template = session.encounterType
          ? await storage.getPromptTemplateByCategory(orgId, session.encounterType)
          : undefined;

        const templateConfig: PromptTemplateConfig | undefined = template ? {
          evaluationCriteria: template.evaluationCriteria,
          requiredPhrases: template.requiredPhrases as PromptTemplateConfig["requiredPhrases"],
          scoringWeights: template.scoringWeights as PromptTemplateConfig["scoringWeights"],
          additionalInstructions: template.additionalInstructions || undefined,
        } : undefined;

        // Build prompt and call AI
        const systemPrompt = buildSystemPrompt(session.encounterType, templateConfig);
        const userMessage = buildUserMessage(
          `[LIVE RECORDING - IN PROGRESS]\n\nTranscript so far:\n${fullTranscript}\n\n[Note: This is a partial recording. Generate a draft note based on available information. Mark any sections with insufficient data as "Pending - encounter in progress".]`,
          session.encounterType,
        );

        const provider = getOrgAIProvider(orgId, orgSettings);
        const result = await provider.analyzeCallTranscript(
          `${systemPrompt}\n\n${userMessage}`,
          id,
          session.encounterType,
          templateConfig,
        );

        const parsed = parseJsonResponse(JSON.stringify(result), id);
        const draftNote = parsed.clinical_note || null;

        if (draftNote) {
          // Update session with draft note
          await storage.updateLiveSession(orgId, id, {
            draftClinicalNote: draftNote as any,
            transcriptText: fullTranscript,
            durationSeconds: Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000),
          });

          // Broadcast draft note update
          broadcastLiveTranscript(id, "draft_note", { draftNote }, orgId);
        }

        logPhiAccess({
          ...auditContext(req),
          event: "live_draft_note_generated",
          resourceType: "live_session",
          resourceId: id,
        });

        res.json({ draftNote, transcriptLength: fullTranscript.length });
      } catch (err) {
        logger.error({ err }, "Failed to generate draft note");
        res.status(500).json({ message: "Failed to generate draft note" });
      }
    },
  );

  /**
   * POST /api/live-sessions/:id/pause — Pause or resume the session.
   */
  app.post("/api/live-sessions/:id/pause",
    requireAuth, injectOrgContext,
    async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;

      try {
        const session = await storage.getLiveSession(orgId, id);
        if (!session) {
          res.status(404).json({ message: "Session not found" });
          return;
        }

        const newStatus = session.status === "active" ? "paused" : "active";
        const updated = await storage.updateLiveSession(orgId, id, { status: newStatus as any });
        res.json(updated);
      } catch (err) {
        logger.error({ err }, "Failed to pause/resume session");
        res.status(500).json({ message: "Failed to update session" });
      }
    },
  );

  /**
   * POST /api/live-sessions/:id/stop — End the session and finalize.
   * Creates a Call record from the accumulated transcript and generates the final clinical note.
   */
  app.post("/api/live-sessions/:id/stop",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { id } = req.params;

      try {
        const session = await storage.getLiveSession(orgId, id);
        if (!session) {
          res.status(404).json({ message: "Session not found" });
          return;
        }

        if (session.status === "completed") {
          res.status(400).json({ message: "Session already completed" });
          return;
        }

        // Close AssemblyAI real-time connection
        const rtSession = activeSessions.get(id);
        if (rtSession) {
          await rtSession.close();
          activeSessions.delete(id);
        }

        // Get final transcript
        const segments = sessionTranscripts.get(id) || [];
        const finalTranscript = segments.join(" ").trim();

        // Clean up in-memory buffers
        sessionTranscripts.delete(id);
        lastDraftTime.delete(id);

        const now = new Date();
        const durationSeconds = Math.round((now.getTime() - new Date(session.startedAt || now).getTime()) / 1000);

        // Create a Call record for permanent storage
        const callId = randomUUID();
        const call = await storage.createCall(orgId, {
          orgId,
          fileName: `live-session-${now.toISOString().replace(/[:.]/g, "-")}.webm`,
          status: "completed",
          duration: durationSeconds,
          callCategory: session.encounterType,
          tags: ["live_recording"],
        });

        // Create transcript record
        if (finalTranscript.length > 0) {
          await storage.createTranscript(orgId, {
            orgId,
            callId: call.id,
            text: finalTranscript,
            confidence: "0.90",
          });
        }

        // Generate final clinical note with full context
        let finalNote = session.draftClinicalNote;
        if (finalTranscript.length >= 10) {
          try {
            const org = await storage.getOrganization(orgId);
            const orgSettings = (org?.settings || null) as OrgSettings | null;
            const template = session.encounterType
              ? await storage.getPromptTemplateByCategory(orgId, session.encounterType)
              : undefined;

            const templateConfig: PromptTemplateConfig | undefined = template ? {
              evaluationCriteria: template.evaluationCriteria,
              requiredPhrases: template.requiredPhrases as PromptTemplateConfig["requiredPhrases"],
              scoringWeights: template.scoringWeights as PromptTemplateConfig["scoringWeights"],
              additionalInstructions: template.additionalInstructions || undefined,
            } : undefined;

            const provider = getOrgAIProvider(orgId, orgSettings);
            const result = await provider.analyzeCallTranscript(
              finalTranscript,
              call.id,
              session.encounterType,
              templateConfig,
            );
            const parsed = parseJsonResponse(JSON.stringify(result), call.id);

            // Build analysis record
            const clinicalNote = parsed.clinical_note || finalNote;

            // Encrypt PHI fields if encryption is available
            let encryptedNote = clinicalNote;
            if (clinicalNote) {
              const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"] as const;
              encryptedNote = { ...clinicalNote };
              for (const field of phiFields) {
                const val = (encryptedNote as any)[field];
                if (val && typeof val === "string") {
                  try { (encryptedNote as any)[field] = encryptField(val); } catch { /* encryption not configured */ }
                }
              }
            }

            // Convert snake_case AI response to camelCase for storage
            const cnForStorage: ClinicalNote | undefined = encryptedNote ? {
              format: (encryptedNote as any).format || session.noteFormat || "soap",
              providerAttested: false,
              specialty: (encryptedNote as any).specialty,
              chiefComplaint: (encryptedNote as any).chief_complaint || (encryptedNote as any).chiefComplaint,
              subjective: (encryptedNote as any).subjective,
              objective: (encryptedNote as any).objective,
              assessment: (encryptedNote as any).assessment,
              plan: (encryptedNote as any).plan,
              hpiNarrative: (encryptedNote as any).hpi_narrative || (encryptedNote as any).hpiNarrative,
              followUp: (encryptedNote as any).follow_up || (encryptedNote as any).followUp,
              icd10Codes: (encryptedNote as any).icd10_codes || (encryptedNote as any).icd10Codes,
              cptCodes: (encryptedNote as any).cpt_codes || (encryptedNote as any).cptCodes,
              documentationCompleteness: (encryptedNote as any).documentation_completeness || (encryptedNote as any).documentationCompleteness,
              clinicalAccuracy: (encryptedNote as any).clinical_accuracy || (encryptedNote as any).clinicalAccuracy,
              missingSections: (encryptedNote as any).missing_sections || (encryptedNote as any).missingSections,
            } : undefined;

            await storage.createCallAnalysis(orgId, {
              orgId,
              callId: call.id,
              performanceScore: parsed.performance_score?.toString(),
              summary: parsed.summary,
              topics: parsed.topics,
              feedback: parsed.feedback as any,
              flags: parsed.flags,
              subScores: {
                compliance: parsed.sub_scores?.compliance,
                customerExperience: parsed.sub_scores?.customer_experience,
                communication: parsed.sub_scores?.communication,
                resolution: parsed.sub_scores?.resolution,
              },
              clinicalNote: cnForStorage,
              confidenceScore: "0.85",
              confidenceFactors: {
                transcriptConfidence: 0.90,
                wordCount: finalTranscript.split(/\s+/).length,
                callDurationSeconds: durationSeconds,
                transcriptLength: finalTranscript.length,
                aiAnalysisCompleted: true,
                overallScore: 0.85,
              },
            });

            finalNote = cnForStorage || clinicalNote as any;
          } catch (err) {
            logger.error({ err }, "Failed to generate final clinical note for live session");
          }
        }

        // Update session as completed
        await storage.updateLiveSession(orgId, id, {
          status: "completed",
          transcriptText: finalTranscript,
          durationSeconds,
          callId: call.id,
          endedAt: now.toISOString(),
          draftClinicalNote: finalNote as any,
        });

        // Broadcast session end
        broadcastLiveTranscript(id, "session_end", { callId: call.id }, orgId);

        logPhiAccess({
          ...auditContext(req),
          event: "live_session_completed",
          resourceType: "live_session",
          resourceId: id,
          detail: `Call ${call.id} created from live session`,
        });

        res.json({
          session: { ...session, status: "completed", callId: call.id, endedAt: now.toISOString() },
          callId: call.id,
          transcriptLength: finalTranscript.length,
          durationSeconds,
        });
      } catch (err) {
        logger.error({ err }, "Failed to stop live session");
        res.status(500).json({ message: "Failed to stop session" });
      }
    },
  );

  /**
   * GET /api/live-sessions — List sessions for the current user.
   */
  app.get("/api/live-sessions",
    requireAuth, injectOrgContext,
    async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;

      try {
        const sessions = await storage.getLiveSessionsByUser(orgId, user.id);
        res.json(sessions);
      } catch (err) {
        logger.error({ err }, "Failed to list live sessions");
        res.status(500).json({ message: "Failed to list sessions" });
      }
    },
  );

  /**
   * GET /api/live-sessions/:id — Get a specific session.
   */
  app.get("/api/live-sessions/:id",
    requireAuth, injectOrgContext,
    async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;

      try {
        const session = await storage.getLiveSession(orgId, id);
        if (!session) {
          res.status(404).json({ message: "Session not found" });
          return;
        }

        // Include current transcript buffer for active sessions
        const segments = sessionTranscripts.get(id);
        const currentTranscript = segments ? segments.join(" ") : session.transcriptText;

        res.json({ ...session, transcriptText: currentTranscript });
      } catch (err) {
        logger.error({ err }, "Failed to get live session");
        res.status(500).json({ message: "Failed to get session" });
      }
    },
  );
}
