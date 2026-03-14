import type { Express } from "express";
import { createHash } from "crypto";
import path from "path";
import fs from "fs";
import { storage, normalizeAnalysis } from "../storage";
import { assemblyAIService } from "../services/assemblyai";
import { aiProvider } from "../services/ai-factory";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { broadcastCallUpdate } from "../services/websocket";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { notifyFlaggedCall } from "../services/notifications";
import { trackUsage } from "../services/queue";
import { upload, safeFloat, withRetry } from "./helpers";
import { enforceQuota } from "./billing";

// Delete uploaded file after processing
async function cleanupFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Failed to cleanup file:', (error as Error).message);
  }
}

// Process audio file with AssemblyAI and archive to cloud storage
async function processAudioFile(orgId: string, callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string) {
  console.log(`[${callId}] Starting audio processing...`);
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." }, orgId);
  try {
    // Step 1a: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload to AssemblyAI successful.`);

    // Step 1b: Archive audio to cloud storage
    console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
    try {
      await storage.uploadAudio(orgId, callId, originalName, audioBuffer, mimeType);
      console.log(`[${callId}] Step 1b/7: Audio archived.`);
    } catch (archiveError) {
      console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, archiveError);
    }

    // Step 2: Start transcription
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." }, orgId);
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(orgId, callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion (with progress updates)
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." }, orgId);
    console.log(`[${callId}] Step 3/7: Polling for transcript results...`);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId, 60, (attempt, max, status) => {
      const pct = Math.round((attempt / max) * 100);
      broadcastCallUpdate(callId, "transcribing", {
        step: 3, totalSteps: 6, label: `Transcribing... (${status})`, progress: pct,
      }, orgId);
    });

    // --- CRITICAL SAFETY CHECK ---
    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Step 4: AI analysis (Gemini or Bedrock/Claude — or fall back to defaults)
    broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." }, orgId);
    let aiAnalysis = null;

    // Load custom prompt template for this call category (if configured)
    let promptTemplate = undefined;
    if (callCategory) {
      try {
        const tmpl = await storage.getPromptTemplateByCategory(orgId, callCategory);
        if (tmpl) {
          promptTemplate = {
            evaluationCriteria: tmpl.evaluationCriteria,
            requiredPhrases: tmpl.requiredPhrases,
            scoringWeights: tmpl.scoringWeights,
            additionalInstructions: tmpl.additionalInstructions,
          };
          console.log(`[${callId}] Using custom prompt template: ${tmpl.name}`);
        }
      } catch (tmplError) {
        console.warn(`[${callId}] Failed to load prompt template (using defaults):`, (tmplError as Error).message);
      }
    }

    if (aiProvider.isAvailable && transcriptResponse.text) {
      try {
        const transcriptText = transcriptResponse.text;
        const transcriptCharCount = transcriptText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name}). Transcript: ${transcriptCharCount} chars (~${estimatedTokens} tokens)`);

        if (estimatedTokens > 100000) {
          console.warn(`[${callId}] Very long transcript (${estimatedTokens} estimated tokens). Analysis quality may be reduced for the longest calls.`);
        }

        aiAnalysis = await withRetry(
          () => aiProvider.analyzeCallTranscript(transcriptText, callId, callCategory, promptTemplate),
          { retries: 2, baseDelay: 2000, label: `AI analysis for ${callId}` }
        );
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        console.warn(`[${callId}] AI analysis failed after retries (continuing with defaults):`, (aiError as Error).message);
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." }, orgId);
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);

    // Compute confidence score based on transcript quality and analysis completeness
    const transcriptConfidence = transcriptResponse.confidence || 0;
    const wordCount = transcriptResponse.words?.length || 0;
    const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
    const hasAiAnalysis = aiAnalysis !== null;

    const wordConfidence = Math.min(wordCount / 50, 1);
    const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
    const aiConfidence = hasAiAnalysis ? 1 : 0.3;

    const confidenceScore = (
      transcriptConfidence * 0.4 +
      wordConfidence * 0.2 +
      durationConfidence * 0.15 +
      aiConfidence * 0.25
    );

    const transcriptCharCount = (transcriptResponse.text || "").length;
    const confidenceFactors = {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: transcriptCharCount,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(confidenceScore * 100) / 100,
    };

    analysis.confidenceScore = confidenceScore.toFixed(3);
    analysis.confidenceFactors = confidenceFactors;

    if (aiAnalysis?.sub_scores) {
      analysis.subScores = {
        compliance: aiAnalysis.sub_scores.compliance ?? 0,
        customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
        communication: aiAnalysis.sub_scores.communication ?? 0,
        resolution: aiAnalysis.sub_scores.resolution ?? 0,
      };
    }

    if (aiAnalysis?.detected_agent_name) {
      analysis.detectedAgentName = aiAnalysis.detected_agent_name;
    }

    if (confidenceScore < 0.7) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push("low_confidence");
      analysis.flags = existingFlags;
    }

    console.log(`[${callId}] Step 5/6: Data processing complete. Confidence: ${(confidenceScore * 100).toFixed(0)}%`);

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." }, orgId);
    console.log(`[${callId}] Step 6/6: Saving analysis results...`);
    await Promise.all([
      storage.createTranscript(orgId, transcript),
      storage.createSentimentAnalysis(orgId, sentiment),
      storage.createCallAnalysis(orgId, analysis),
    ]);

    // Auto-assign to employee based on detected agent name (if call is unassigned)
    const currentCall = await storage.getCall(orgId, callId);
    let assignedEmployeeId: string | undefined;
    if (!currentCall?.employeeId && aiAnalysis?.detected_agent_name) {
      const detectedName = aiAnalysis.detected_agent_name.toLowerCase().trim();
      const allEmployees = await storage.getAllEmployees(orgId);
      const matchedEmployee = allEmployees.find(emp => {
        const empName = emp.name.toLowerCase();
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });
      if (matchedEmployee) {
        assignedEmployeeId = matchedEmployee.id;
        console.log(`[${callId}] Auto-assigned to employee: ${matchedEmployee.id}`);
      } else {
        console.log(`[${callId}] Detected agent name but no matching employee found.`);
      }
    }

    await storage.updateCall(orgId, callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
      ...(assignedEmployeeId ? { employeeId: assignedEmployeeId } : {}),
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${assignedEmployeeId ? " (auto-assigned)" : ""}`);

    await cleanupFile(filePath);
    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" }, orgId);

    // Send webhook notification for flagged calls (non-blocking)
    const finalFlags = (analysis.flags as string[]) || [];
    if (finalFlags.length > 0) {
      notifyFlaggedCall({
        event: "call_flagged",
        callId,
        orgId,
        flags: finalFlags,
        performanceScore: analysis.performanceScore ? safeFloat(analysis.performanceScore) : undefined,
        agentName: analysis.detectedAgentName || undefined,
        fileName: originalName,
        summary: typeof analysis.summary === "string" ? analysis.summary : undefined,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }

    console.log(`[${callId}] Processing finished successfully.`);

    trackUsage({ orgId, eventType: "transcription", quantity: 1, metadata: { callId } });
    if (aiAnalysis) {
      trackUsage({ orgId, eventType: "ai_analysis", quantity: 1, metadata: { callId, model: aiProvider.name } });
    }

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, (error as Error).message);
    await storage.updateCall(orgId, callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" }, orgId);
    await cleanupFile(filePath);
  }
}

export function registerCallRoutes(app: Express): void {

  app.get("/api/calls", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { status, sentiment, employee } = req.query;
      const calls = await storage.getCallsWithDetails(req.orgId!, {
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string
      });
      res.json(calls);
    } catch (error) {
      res.status(500).json({ message: "Failed to get calls" });
    }
  });

  app.get("/api/calls/:id", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_call_details",
        resourceType: "call",
        resourceId: req.params.id,
      });

      const [employee, transcript, sentiment, rawAnalysis] = await Promise.all([
        call.employeeId ? storage.getEmployee(req.orgId!, call.employeeId) : undefined,
        storage.getTranscript(req.orgId!, call.id),
        storage.getSentimentAnalysis(req.orgId!, call.id),
        storage.getCallAnalysis(req.orgId!, call.id),
      ]);

      const analysis = normalizeAnalysis(rawAnalysis);

      res.json({
        ...call,
        employee,
        transcript,
        sentiment,
        analysis
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get call" });
    }
  });

  app.post("/api/calls/upload", requireAuth, injectOrgContext, enforceQuota("transcription"), upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId, callCategory } = req.body;

      if (employeeId) {
        const employee = await storage.getEmployee(req.orgId!, employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      const audioBuffer = fs.readFileSync(req.file.path);
      const fileHash = createHash("sha256").update(audioBuffer).digest("hex");
      const existingCalls = await storage.getCallsWithDetails(req.orgId!, {});
      const duplicate = existingCalls.find(c => c.fileHash === fileHash && c.status !== "failed");
      if (duplicate) {
        await cleanupFile(req.file.path);
        res.status(200).json(duplicate);
        return;
      }

      const call = await storage.createCall(req.orgId!, {
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileHash,
        status: "processing",
        callCategory: callCategory || undefined,
      });
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const orgId = req.orgId!;
      processAudioFile(orgId, call.id, req.file.path, audioBuffer, originalName, mimeType, callCategory)
        .catch(async (error) => {
          console.error(`Failed to process call ${call.id}:`, (error as Error).message);
          try {
            await storage.updateCall(orgId, call.id, { status: "failed" });
          } catch (updateErr) {
            console.error(`Failed to mark call ${call.id} as failed:`, (updateErr as Error).message);
          }
        });

      res.status(201).json(call);
    } catch (error) {
      console.error("Error during file upload:", (error as Error).message);
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  app.get("/api/calls/:id/audio", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: req.query.download === "true" ? "download_audio" : "stream_audio",
        resourceType: "audio",
        resourceId: req.params.id,
      });

      const audioFiles = await storage.getAudioFiles(req.orgId!, req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      const audioBuffer = await storage.downloadAudio(req.orgId!, audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json({ message: "Audio file could not be retrieved" });
        return;
      }

      const ext = path.extname(audioFiles[0]).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
      };
      const contentType = mimeTypes[ext] || 'audio/mpeg';

      if (req.query.download === 'true') {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_");
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.send(audioBuffer);
    } catch (error) {
      console.error("Failed to stream audio:", (error as Error).message);
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  app.get("/api/calls/:id/transcript", requireAuth, injectOrgContext, async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });

      const transcript = await storage.getTranscript(req.orgId!, req.params.id);
      if (!transcript) {
        res.status(404).json({ message: "Transcript not found" });
        return;
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json({ message: "Failed to get transcript" });
    }
  });

  app.get("/api/calls/:id/sentiment", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sentiment = await storage.getSentimentAnalysis(req.orgId!, req.params.id);
      if (!sentiment) {
        res.status(404).json({ message: "Sentiment analysis not found" });
        return;
      }
      res.json(sentiment);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment analysis" });
    }
  });

  app.get("/api/calls/:id/analysis", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ message: "Failed to get call analysis" });
    }
  });

  app.patch("/api/calls/:id/analysis", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;
      const { updates, reason } = req.body;

      logPhiAccess({
        ...auditContext(req),
        event: "edit_call_analysis",
        resourceType: "analysis",
        resourceId: callId,
        detail: `reason: ${reason}; fields: ${updates ? Object.keys(updates).join(",") : "none"}`,
      });

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ message: "A reason for the manual edit is required." });
        return;
      }

      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        res.status(400).json({ message: "Updates must be a non-empty object." });
        return;
      }

      const ALLOWED_FIELDS = new Set([
        "summary", "performanceScore", "topics", "actionItems",
        "feedback", "flags", "sentiment", "sentimentScore",
      ]);
      const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
      if (disallowed.length > 0) {
        res.status(400).json({ message: `Cannot edit fields: ${disallowed.join(", ")}` });
        return;
      }

      const existing = await storage.getCallAnalysis(req.orgId!, callId);
      if (!existing) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      const user = (req as any).user;
      const editedBy = user?.name || user?.username || "Unknown User";

      const previousEdits = Array.isArray(existing.manualEdits) ? existing.manualEdits : [];
      const editRecord = {
        editedBy,
        editedAt: new Date().toISOString(),
        reason: reason.trim(),
        fieldsChanged: Object.keys(updates),
        previousValues: {} as Record<string, any>,
      };

      for (const key of Object.keys(updates)) {
        editRecord.previousValues[key] = (existing as any)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      await storage.createCallAnalysis(req.orgId!, updatedAnalysis);

      console.log(`[${callId}] Manual edit by ${editedBy}: ${reason} (fields: ${editRecord.fieldsChanged.join(", ")})`);
      res.json(updatedAnalysis);
    } catch (error) {
      console.error("Failed to update call analysis:", (error as Error).message);
      res.status(500).json({ message: "Failed to update call analysis" });
    }
  });

  app.patch("/api/calls/:id/assign", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "employeeId is required" });
        return;
      }

      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      const employee = await storage.getEmployee(req.orgId!, employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const updated = await storage.updateCall(req.orgId!, req.params.id, { employeeId });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign call" });
    }
  });

  app.patch("/api/calls/:id/tags", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        res.status(400).json({ message: "tags must be an array" });
        return;
      }
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      const updated = await storage.updateCall(req.orgId!, req.params.id, { tags });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update tags" });
    }
  });

  app.delete("/api/calls/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;

      logPhiAccess({
        ...auditContext(req),
        event: "delete_call",
        resourceType: "call",
        resourceId: callId,
      });

      await storage.deleteCall(req.orgId!, callId);

      console.log(`Successfully deleted call ID: ${callId}`);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete call:", (error as Error).message);
      res.status(500).json({ message: "Failed to delete call" });
    }
  });
}
