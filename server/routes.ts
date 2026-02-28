import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import passport from "passport";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { aiProvider } from "./services/ai-factory";
import { requireAuth } from "./auth";
import { insertEmployeeSchema } from "@shared/schema";
import { z } from "zod";
import csv from "csv-parser";

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (reasonable for audio files)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {

  // ==================== AUTH ROUTES (unauthenticated) ====================
  // Users are managed via AUTH_USERS environment variable (no registration)

  // Login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
      });
    })(req, res, next);
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      res.json({ message: "Logged out" });
    });
  });

  // Get current session user
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  // ==================== PROTECTED ROUTES ====================

  // Dashboard metrics
  app.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  app.get("/api/dashboard/sentiment", requireAuth, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  app.get("/api/dashboard/performers", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 3;
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });

  // Get all employees
  app.get("/api/employees", requireAuth, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });

  // Create employee
  app.post("/api/employees", requireAuth, async (req, res) => {
    try {
      const validatedData = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(validatedData);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create employee" });
      }
    }
  });

  // Update employee (edit email, department, sub-team, status, etc.)
  app.patch("/api/employees/:id", requireAuth, async (req, res) => {
    try {
      const employee = await storage.getEmployee(req.params.id);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }
      const allowedFields = ["name", "email", "role", "status", "initials", "subTeam"];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      const updated = await storage.updateEmployee(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  // Assign/reassign employee to a call
  app.patch("/api/calls/:id/assign", requireAuth, async (req, res) => {
    try {
      const { employeeId } = req.body;
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }
      const updated = await storage.updateCall(req.params.id, { employeeId: employeeId || undefined });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign employee to call" });
    }
  });

  // Bulk import employees from the bundled CSV file
  app.post("/api/employees/import-csv", requireAuth, async (req, res) => {
    try {
      const csvFilePath = path.resolve("employees.csv");
      if (!fs.existsSync(csvFilePath)) {
        res.status(404).json({ message: "employees.csv not found on server" });
        return;
      }

      const results: Array<{ name: string; action: string }> = [];
      const rows: any[] = [];

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(csv())
          .on("data", (row: any) => rows.push(row))
          .on("end", resolve)
          .on("error", reject);
      });

      for (const row of rows) {
        const name = (row["Agent Name"] || "").trim();
        const department = (row["Department"] || "").trim();
        const extension = (row["Extension"] || "").trim();
        const status = (row["Status"] || "Active").trim();

        if (!name) continue;

        const email = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
          ? `${extension}@company.com`
          : `${name.toLowerCase().replace(/\s+/g, ".")}@company.com`;

        const nameParts = name.split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase();

        try {
          const existing = await storage.getEmployeeByEmail(email);
          if (existing) {
            results.push({ name, action: "skipped (exists)" });
          } else {
            await storage.createEmployee({ name, email, role: department, initials, status });
            results.push({ name, action: "created" });
          }
        } catch (err) {
          results.push({ name, action: `error: ${(err as Error).message}` });
        }
      }

      const created = results.filter(r => r.action === "created").length;
      const skipped = results.filter(r => r.action.startsWith("skipped")).length;
      res.json({ message: `Import complete: ${created} created, ${skipped} skipped`, details: results });
    } catch (error) {
      console.error("CSV import failed:", error);
      res.status(500).json({ message: "Failed to import employees from CSV" });
    }
  });

  // Get all calls with details
app.get("/api/calls", requireAuth, async (req, res) => {
  try {
    const { status, sentiment, employee } = req.query;
    // Pass the filters directly to the storage function
    const calls = await storage.getCallsWithDetails({ 
      status: status as string, 
      sentiment: sentiment as string, 
      employee: employee as string 
    });
    res.json(calls);
  } catch (error) {
    res.status(500).json({ message: "Failed to get calls" });
  }
});

  // Get single call with details
  app.get("/api/calls/:id", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      const employee = call.employeeId ? await storage.getEmployee(call.employeeId) : undefined;
      const transcript = await storage.getTranscript(call.id);
      const sentiment = await storage.getSentimentAnalysis(call.id);
      const analysis = await storage.getCallAnalysis(call.id);

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

  // Upload call recording
  app.post("/api/calls/upload", requireAuth, upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId, callCategory } = req.body;

      // If employeeId provided, verify employee exists
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      // Create call record (employeeId is optional — can be assigned later)
      const call = await storage.createCall({
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: "processing",
        callCategory: callCategory || undefined,
      });

      // Read file buffer for API upload, then start async processing
      const audioBuffer = fs.readFileSync(req.file.path);
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      processAudioFile(call.id, req.file.path, audioBuffer, originalName, mimeType, callCategory)
        .catch(error => {
          console.error(`Failed to process call ${call.id}:`, error);
          storage.updateCall(call.id, { status: "failed" });
        });

      res.status(201).json(call);
    } catch (error) {
      console.error("Error during file upload:", error);
      // HIPAA: Ensure file is cleaned up on any error
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  // Delete uploaded file after processing
  async function cleanupFile(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Failed to cleanup file:', error);
    }
  }

// Process audio file with AssemblyAI and archive to cloud storage
async function processAudioFile(callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string) {
  console.log(`[${callId}] Starting audio processing...`);
  try {
    // Step 1a: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload to AssemblyAI successful.`);

    // Step 1b: Archive audio to cloud storage
    console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
    try {
      await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
      console.log(`[${callId}] Step 1b/7: Audio archived.`);
    } catch (archiveError) {
      console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, archiveError);
    }

    // Step 2: Start transcription
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion
    console.log(`[${callId}] Step 3/7: Polling for transcript results...`);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    // --- CRITICAL SAFETY CHECK ---
    // This prevents the crash if polling fails to return a valid result.
    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Step 4: AI analysis (Gemini or Bedrock/Claude — or fall back to defaults)
    let aiAnalysis = null;
    if (aiProvider.isAvailable && transcriptResponse.text) {
      try {
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name})...`);
        aiAnalysis = await aiProvider.analyzeCallTranscript(transcriptResponse.text, callId, callCategory);
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, (aiError as Error).message);
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);
    console.log(`[${callId}] Step 5/6: Data processing complete.`);

    // Step 6: Store results
    console.log(`[${callId}] Step 6/6: Saving analysis results...`);
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.`);

    await cleanupFile(filePath);
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, error);
    await storage.updateCall(callId, { status: "failed" });
    await cleanupFile(filePath);
  }
}

  // Stream audio file from cloud storage for playback or download
  app.get("/api/calls/:id/audio", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // List audio files for this call (stored under audio/{callId}/)
      const audioFiles = await storage.getAudioFiles(req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      // Download the first audio file
      const audioBuffer = await storage.downloadAudio(audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json({ message: "Audio file could not be retrieved" });
        return;
      }

      // Determine content type from file extension
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

      // If ?download=true, set Content-Disposition to force download
      if (req.query.download === 'true') {
        const fileName = call.fileName || `call-${req.params.id}${ext}`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.send(audioBuffer);
    } catch (error) {
      console.error("Failed to stream audio:", error);
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  // Get transcript for a call
  app.get("/api/calls/:id/transcript", requireAuth, async (req, res) => {
    try {
      const transcript = await storage.getTranscript(req.params.id);
      if (!transcript) {
        res.status(404).json({ message: "Transcript not found" });
        return;
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json({ message: "Failed to get transcript" });
    }
  });

  // Get sentiment analysis for a call
  app.get("/api/calls/:id/sentiment", requireAuth, async (req, res) => {
    try {
      const sentiment = await storage.getSentimentAnalysis(req.params.id);
      if (!sentiment) {
        res.status(404).json({ message: "Sentiment analysis not found" });
        return;
      }
      res.json(sentiment);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment analysis" });
    }
  });

  // Get analysis for a call
  app.get("/api/calls/:id/analysis", requireAuth, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.params.id);
      if (!analysis) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ message: "Failed to get call analysis" });
    }
  });

  // Search calls
  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ message: "Search query is required" });
        return;
      }
      
      const results = await storage.searchCalls(query);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls" });
    }
  });

  // This new route will handle requests for the Performance page
app.get("/api/performance", requireAuth, async (req, res) => {
  try {
    // We can reuse the existing function to get top performers
    const performers = await storage.getTopPerformers(10); // Get top 10
    res.json(performers);
  } catch (error) {
    console.error("Failed to get performance data:", error);
    res.status(500).json({ message: "Failed to get performance data" });
  }
});

  app.get("/api/reports/summary", requireAuth, async (req, res) => {
  try {
    const metrics = await storage.getDashboardMetrics();
    const sentiment = await storage.getSentimentDistribution();
    const performers = await storage.getTopPerformers(5);

    const reportData = {
      metrics,
      sentiment,
      performers,
    };

    res.json(reportData);
  } catch (error) {
    console.error("Failed to generate report data:", error);
    res.status(500).json({ message: "Failed to generate report data" });
  }
});

  // Filtered reports: accepts date range, employee, department filters
  app.get("/api/reports/filtered", requireAuth, async (req, res) => {
    try {
      const { from, to, employeeId, department } = req.query;

      const allCalls = await storage.getCallsWithDetails({ status: "completed" });
      const employees = await storage.getAllEmployees();

      // Build employee lookup maps
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      // Filter by date range
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Filter by employee
      if (employeeId) {
        filtered = filtered.filter(c => c.employeeId === employeeId);
      }

      // Filter by department
      if (department) {
        filtered = filtered.filter(c => {
          if (!c.employeeId) return false;
          const emp = employeeMap.get(c.employeeId);
          return emp?.role === department;
        });
      }

      // Compute metrics from filtered set
      const totalCalls = filtered.length;
      const sentiments = filtered.map(c => c.sentiment).filter(Boolean);
      const analyses = filtered.map(c => c.analysis).filter(Boolean);

      const avgSentiment = sentiments.length > 0
        ? (sentiments.reduce((sum, s) => sum + parseFloat(s!.overallScore || "0"), 0) / sentiments.length) * 10
        : 0;
      const avgPerformanceScore = analyses.length > 0
        ? analyses.reduce((sum, a) => sum + parseFloat(a!.performanceScore || "0"), 0) / analyses.length
        : 0;

      const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
      for (const s of sentiments) {
        const key = s!.overallSentiment as keyof typeof sentimentDist;
        if (key in sentimentDist) sentimentDist[key]++;
      }

      // Per-employee stats for performers list
      const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
      for (const call of filtered) {
        if (!call.employeeId) continue;
        const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
        stats.callCount++;
        if (call.analysis?.performanceScore) {
          stats.totalScore += parseFloat(call.analysis.performanceScore);
        }
        employeeStats.set(call.employeeId, stats);
      }

      const performers = Array.from(employeeStats.entries())
        .map(([empId, stats]) => {
          const emp = employeeMap.get(empId);
          return {
            id: empId,
            name: emp?.name || "Unknown",
            role: emp?.role || "",
            avgPerformanceScore: stats.callCount > 0
              ? Math.round((stats.totalScore / stats.callCount) * 100) / 100
              : null,
            totalCalls: stats.callCount,
          };
        })
        .filter(p => p.totalCalls > 0)
        .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0));

      // Trend data: group by month
      const trendMap = new Map<string, { calls: number; totalScore: number; scored: number; positive: number; neutral: number; negative: number }>();
      for (const call of filtered) {
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const entry = trendMap.get(monthKey) || { calls: 0, totalScore: 0, scored: 0, positive: 0, neutral: 0, negative: 0 };
        entry.calls++;
        if (call.analysis?.performanceScore) {
          entry.totalScore += parseFloat(call.analysis.performanceScore);
          entry.scored++;
        }
        if (call.sentiment?.overallSentiment) {
          const sent = call.sentiment.overallSentiment as "positive" | "neutral" | "negative";
          if (sent in entry) entry[sent]++;
        }
        trendMap.set(monthKey, entry);
      }

      const trends = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          calls: data.calls,
          avgScore: data.scored > 0 ? Math.round((data.totalScore / data.scored) * 100) / 100 : null,
          positive: data.positive,
          neutral: data.neutral,
          negative: data.negative,
        }));

      res.json({
        metrics: {
          totalCalls,
          avgSentiment: Math.round(avgSentiment * 100) / 100,
          avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
        },
        sentiment: sentimentDist,
        performers,
        trends,
      });
    } catch (error) {
      console.error("Failed to generate filtered report:", error);
      res.status(500).json({ message: "Failed to generate filtered report" });
    }
  });

  // Agent profile: aggregated feedback across all calls for an employee
  app.get("/api/reports/agent-profile/:employeeId", requireAuth, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.query;

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });

      // Apply optional date filters
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Aggregate all analysis feedback
      const allStrengths: string[] = [];
      const allSuggestions: string[] = [];
      const allTopics: string[] = [];
      const scores: number[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

      // Trend over time for this agent
      const monthlyScores = new Map<string, { total: number; count: number }>();

      for (const call of filtered) {
        if (call.analysis) {
          if (call.analysis.performanceScore) {
            scores.push(parseFloat(call.analysis.performanceScore));
          }
          if (call.analysis.feedback) {
            const fb = typeof call.analysis.feedback === "string"
              ? JSON.parse(call.analysis.feedback)
              : call.analysis.feedback;
            if (fb.strengths) allStrengths.push(...fb.strengths);
            if (fb.suggestions) allSuggestions.push(...fb.suggestions);
          }
          if (call.analysis.topics) {
            const topics = typeof call.analysis.topics === "string"
              ? JSON.parse(call.analysis.topics)
              : call.analysis.topics;
            if (Array.isArray(topics)) allTopics.push(...topics);
          }
        }
        if (call.sentiment?.overallSentiment) {
          const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
          if (s in sentimentCounts) sentimentCounts[s]++;
        }

        // Monthly trend
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (call.analysis?.performanceScore) {
          const entry = monthlyScores.get(monthKey) || { total: 0, count: 0 };
          entry.total += parseFloat(call.analysis.performanceScore);
          entry.count++;
          monthlyScores.set(monthKey, entry);
        }
      }

      // Count frequency of strengths, suggestions, topics
      const countFrequency = (arr: string[]) => {
        const freq = new Map<string, number>();
        for (const item of arr) {
          const normalized = item.trim().toLowerCase();
          freq.set(normalized, (freq.get(normalized) || 0) + 1);
        }
        return Array.from(freq.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([text, count]) => ({ text, count }));
      };

      const avgScore = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : null;
      const highScore = scores.length > 0 ? Math.max(...scores) : null;
      const lowScore = scores.length > 0 ? Math.min(...scores) : null;

      const scoreTrend = Array.from(monthlyScores.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          avgScore: Math.round((data.total / data.count) * 100) / 100,
          calls: data.count,
        }));

      res.json({
        employee: { id: employee.id, name: employee.name, role: employee.role, status: employee.status },
        totalCalls: filtered.length,
        avgPerformanceScore: avgScore,
        highScore,
        lowScore,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFrequency(allStrengths),
        topSuggestions: countFrequency(allSuggestions),
        commonTopics: countFrequency(allTopics),
        scoreTrend,
      });
    } catch (error) {
      console.error("Failed to generate agent profile:", error);
      res.status(500).json({ message: "Failed to generate agent profile" });
    }
  });

  app.delete("/api/calls/:id", requireAuth, async (req, res) => {
  try {
    const callId = req.params.id;
    
    // You'll need to implement deleteCall in your storage/db logic
    await storage.deleteCall(callId); 
    
    console.log(`Successfully deleted call ID: ${callId}`);
    // Send a 204 No Content response for a successful deletion
    res.status(204).send(); 
  } catch (error) {
    console.error("Failed to delete call:", error);
    res.status(500).json({ message: "Failed to delete call" });
  }
});

  const httpServer = createServer(app);
  return httpServer;
}
