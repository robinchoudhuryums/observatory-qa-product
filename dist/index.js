// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";

// server/storage.ts
import { randomUUID } from "crypto";
var MemStorage = class {
  employees = /* @__PURE__ */ new Map();
  calls = /* @__PURE__ */ new Map();
  transcripts = /* @__PURE__ */ new Map();
  sentimentAnalysis = /* @__PURE__ */ new Map();
  callAnalysis = /* @__PURE__ */ new Map();
  constructor() {
    this.seedData();
  }
  seedData() {
    const employees2 = [
      {
        id: "emp-1",
        name: "Sarah Martinez",
        role: "Senior Agent",
        email: "sarah@company.com",
        initials: "SM",
        createdAt: /* @__PURE__ */ new Date()
      },
      {
        id: "emp-2",
        name: "James Davis",
        role: "Agent",
        email: "james@company.com",
        initials: "JD",
        createdAt: /* @__PURE__ */ new Date()
      },
      {
        id: "emp-3",
        name: "Anna Lopez",
        role: "Agent",
        email: "anna@company.com",
        initials: "AL",
        createdAt: /* @__PURE__ */ new Date()
      }
    ];
    employees2.forEach((emp) => this.employees.set(emp.id, emp));
  }
  async getEmployee(id) {
    return this.employees.get(id);
  }
  async getEmployeeByEmail(email) {
    return Array.from(this.employees.values()).find((emp) => emp.email === email);
  }
  async createEmployee(insertEmployee) {
    const id = randomUUID();
    const employee = {
      ...insertEmployee,
      id,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.employees.set(id, employee);
    return employee;
  }
  async getAllEmployees() {
    return Array.from(this.employees.values());
  }
  async getCall(id) {
    return this.calls.get(id);
  }
  async createCall(insertCall) {
    const id = randomUUID();
    const call = {
      ...insertCall,
      id,
      uploadedAt: /* @__PURE__ */ new Date()
    };
    this.calls.set(id, call);
    return call;
  }
  async updateCall(id, updates) {
    const call = this.calls.get(id);
    if (!call) return void 0;
    const updatedCall = { ...call, ...updates };
    this.calls.set(id, updatedCall);
    return updatedCall;
  }
  async deleteCall(id) {
    this.calls.delete(id);
    this.transcripts.delete(id);
    this.sentimentAnalysis.delete(id);
    this.callAnalysis.delete(id);
  }
  async getCallsByEmployee(employeeId) {
    return Array.from(this.calls.values()).filter((call) => call.employeeId === employeeId);
  }
  async getAllCalls() {
    return Array.from(this.calls.values());
  }
  async getCallsWithDetails() {
    const calls2 = Array.from(this.calls.values());
    const callsWithDetails = [];
    for (const call of calls2) {
      const employee = await this.getEmployee(call.employeeId);
      const transcript = this.transcripts.get(call.id);
      const sentiment = this.sentimentAnalysis.get(call.id);
      const analysis = this.callAnalysis.get(call.id);
      if (employee) {
        callsWithDetails.push({
          ...call,
          employee,
          transcript,
          sentiment,
          analysis
        });
      }
    }
    return callsWithDetails.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }
  async getTranscript(callId) {
    return this.transcripts.get(callId);
  }
  async createTranscript(insertTranscript) {
    const id = randomUUID();
    const transcript = {
      ...insertTranscript,
      id,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.transcripts.set(transcript.callId, transcript);
    return transcript;
  }
  async getSentimentAnalysis(callId) {
    return this.sentimentAnalysis.get(callId);
  }
  async createSentimentAnalysis(insertSentiment) {
    const id = randomUUID();
    const sentiment = {
      ...insertSentiment,
      id,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.sentimentAnalysis.set(sentiment.callId, sentiment);
    return sentiment;
  }
  async getCallAnalysis(callId) {
    return this.callAnalysis.get(callId);
  }
  async createCallAnalysis(insertAnalysis) {
    const id = randomUUID();
    const analysis = {
      ...insertAnalysis,
      id,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.callAnalysis.set(analysis.callId, analysis);
    return analysis;
  }
  async getDashboardMetrics() {
    const calls2 = Array.from(this.calls.values());
    const sentiments = Array.from(this.sentimentAnalysis.values());
    const analyses = Array.from(this.callAnalysis.values());
    const avgSentiment = sentiments.length > 0 ? sentiments.reduce((sum, s) => sum + s.overallScore, 0) / sentiments.length * 10 : 0;
    const avgTranscriptionTime = 2.3;
    const teamScore = analyses.length > 0 ? analyses.reduce((sum, a) => sum + a.performanceScore, 0) / analyses.length : 0;
    return {
      totalCalls: calls2.length,
      avgSentiment: Number(avgSentiment.toFixed(1)),
      avgTranscriptionTime,
      teamScore: Number(teamScore.toFixed(1))
    };
  }
  async getSentimentDistribution() {
    const sentiments = Array.from(this.sentimentAnalysis.values());
    const total = sentiments.length || 1;
    const positive = sentiments.filter((s) => s.overallSentiment === "positive").length;
    const neutral = sentiments.filter((s) => s.overallSentiment === "neutral").length;
    const negative = sentiments.filter((s) => s.overallSentiment === "negative").length;
    return {
      positive: Math.round(positive / total * 100),
      neutral: Math.round(neutral / total * 100),
      negative: Math.round(negative / total * 100)
    };
  }
  async getTopPerformers(limit = 3) {
    const analyses = Array.from(this.callAnalysis.values());
    const employeeScores = /* @__PURE__ */ new Map();
    for (const analysis of analyses) {
      const call = this.calls.get(analysis.callId);
      if (call) {
        if (!employeeScores.has(call.employeeId)) {
          employeeScores.set(call.employeeId, []);
        }
        employeeScores.get(call.employeeId).push(analysis.performanceScore);
      }
    }
    const performers = [];
    for (const [employeeId, scores] of employeeScores.entries()) {
      const employee = this.employees.get(employeeId);
      if (employee && scores.length > 0) {
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        performers.push({
          ...employee,
          score: Number(avgScore.toFixed(1))
        });
      }
    }
    return performers.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  async searchCalls(query) {
    const callsWithDetails = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();
    return callsWithDetails.filter(
      (call) => call.employee.name.toLowerCase().includes(lowerQuery) || call.fileName.toLowerCase().includes(lowerQuery) || call.transcript?.text.toLowerCase().includes(lowerQuery) || call.analysis?.keywords?.some((keyword) => keyword.toLowerCase().includes(lowerQuery))
    );
  }
  async getCallsByStatus(status) {
    const callsWithDetails = await this.getCallsWithDetails();
    return callsWithDetails.filter((call) => call.status === status);
  }
  async getCallsBySentiment(sentiment) {
    const callsWithDetails = await this.getCallsWithDetails();
    return callsWithDetails.filter((call) => call.sentiment?.overallSentiment === sentiment);
  }
};
var storage = new MemStorage();

// server/services/assemblyai.ts
var AssemblyAIService = class {
  config;
  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLY_AI_API_KEY || "",
      baseUrl: "https://api.assemblyai.com/v2"
    };
    if (!this.config.apiKey) {
      throw new Error("AssemblyAI API key is required. Set ASSEMBLYAI_API_KEY or ASSEMBLY_AI_API_KEY environment variable.");
    }
  }
  async uploadAudioFile(audioBuffer, fileName) {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: "POST",
      // Inside the uploadAudioFile function...
      headers: {
        "Authorization": this.config.apiKey,
        // Correctly sends the key directly
        "Content-Type": "application/octet-stream"
      },
      body: audioBuffer
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload audio file: ${error}`);
    }
    const result = await response.json();
    return result.upload_url;
  }
  async transcribeAudio(audioUrl, options = {}) {
    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: "POST",
      headers: {
        "Authorization": this.config.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_model: "nano",
        // --- Enhanced Analysis Features ---
        summarization: true,
        summary_model: "informative",
        // Use a better model for the summary
        summary_type: "bullets",
        // Get a bulleted list summary
        sentiment_analysis: true,
        // This enables detailed sentiment results
        entity_detection: true,
        // Detects entities like person, organization, etc.
        auto_highlights: true,
        // Extracts key phrases and sentences
        speaker_labels: true,
        punctuate: true,
        format_text: true
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start transcription: ${error}`);
    }
    const result = await response.json();
    return result.id;
  }
  async getTranscript(transcriptId) {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      method: "GET",
      headers: {
        "Authorization": this.config.apiKey
      }
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get transcript: ${error}`);
    }
    return await response.json();
  }
  async pollTranscript(transcriptId, maxAttempts = 60) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);
      if (transcript.status === "completed") {
        return transcript;
      } else if (transcript.status === "error") {
        throw new Error("Transcription failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    throw new Error("Transcription timed out");
  }
  // Replace your old function with this new one in server/services/assemblyai.ts
  processTranscriptData(response, callId) {
    if (!response.text) {
      throw new Error("No transcript text available");
    }
    const transcript = {
      callId,
      text: response.text,
      confidence: response.confidence || 0,
      words: response.words || []
    };
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    const sentiment = {
      callId,
      overallSentiment: overallSentiment.sentiment,
      overallScore: overallSentiment.score,
      segments: sentimentResults.map((segment) => ({
        text: segment.text,
        sentiment: segment.sentiment.toLowerCase(),
        confidence: segment.confidence,
        start: segment.start,
        end: segment.end
      }))
    };
    const analysis = {
      callId,
      // Use the new, high-quality summary directly from the API response
      summary: response.summary || this.generateSummary(response.text),
      // Extract topics from the detected entities
      topics: response.entities?.filter((entity) => entity.entity_type === "topic").map((entity) => entity.text).slice(0, 5) || [],
      // Get the top 5 topics
      // Extract action items using auto_highlights
      actionItems: response.auto_highlights?.results?.filter((h) => h.text.toLowerCase().includes("follow up") || h.text.toLowerCase().includes("schedule")).map((h) => h.text) || [],
      // The rest of your analysis calculations can remain
      performanceScore: this.calculatePerformanceScore(response),
      talkTimeRatio: this.calculateTalkTimeRatio(response),
      responseTime: this.calculateResponseTime(response),
      keywords: this.extractKeywords(response.text),
      feedback: this.generateFeedback(response)
    };
    return { transcript, sentiment, analysis };
  }
  calculateOverallSentiment(sentimentResults) {
    if (sentimentResults.length === 0) {
      return { sentiment: "neutral", score: 0.5 };
    }
    let positiveScore = 0;
    let neutralScore = 0;
    let negativeScore = 0;
    let totalWeight = 0;
    sentimentResults.forEach((result) => {
      const weight = result.end - result.start;
      totalWeight += weight;
      if (result.sentiment === "POSITIVE") {
        positiveScore += weight * result.confidence;
      } else if (result.sentiment === "NEUTRAL") {
        neutralScore += weight * result.confidence;
      } else {
        negativeScore += weight * result.confidence;
      }
    });
    const avgPositive = positiveScore / totalWeight;
    const avgNeutral = neutralScore / totalWeight;
    const avgNegative = negativeScore / totalWeight;
    if (avgPositive > avgNeutral && avgPositive > avgNegative) {
      return { sentiment: "positive", score: avgPositive };
    } else if (avgNegative > avgNeutral) {
      return { sentiment: "negative", score: avgNegative };
    } else {
      return { sentiment: "neutral", score: avgNeutral };
    }
  }
  calculatePerformanceScore(response) {
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    let score = 5;
    if (overallSentiment.sentiment === "positive") {
      score += 2 + overallSentiment.score * 1;
    } else if (overallSentiment.sentiment === "neutral") {
      score += 1;
    }
    if (response.confidence) {
      score += response.confidence * 2;
    }
    return Math.min(10, Math.max(0, score));
  }
  calculateTalkTimeRatio(response) {
    return 0.6;
  }
  calculateResponseTime(response) {
    return 2.5;
  }
  extractKeywords(text2) {
    const commonWords = /* @__PURE__ */ new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her", "its", "our", "their"]);
    const words = text2.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((word) => word.length > 3 && !commonWords.has(word));
    const wordCount = /* @__PURE__ */ new Map();
    words.forEach((word) => {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    });
    return Array.from(wordCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map((entry) => entry[0]);
  }
  generateSummary(text2) {
    const sentences = text2.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.slice(0, 2).join(". ").trim() + ".";
  }
  extractActionItems(text2) {
    const actionKeywords = ["follow up", "will call", "send email", "schedule", "contact", "check", "review", "update"];
    const sentences = text2.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.filter(
      (sentence) => actionKeywords.some(
        (keyword) => sentence.toLowerCase().includes(keyword)
      )
    ).slice(0, 3);
  }
  generateFeedback(response) {
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    const feedback = {
      strengths: [],
      improvements: [],
      suggestions: []
    };
    if (overallSentiment.sentiment === "positive") {
      feedback.strengths.push("Maintained positive customer interaction throughout the call");
    }
    if (response.confidence && response.confidence > 0.8) {
      feedback.strengths.push("Clear and articulate communication");
    } else {
      feedback.improvements.push("Consider speaking more clearly to improve transcription confidence");
    }
    feedback.suggestions.push("Continue to use empathy phrases to build rapport");
    feedback.suggestions.push("Summarize key points before ending the call");
    return feedback;
  }
};
var assemblyAIService = new AssemblyAIService();

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  role: text("role").notNull(),
  email: text("email"),
  initials: text("initials").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  duration: integer("duration"),
  // in seconds
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull().default("processing"),
  // processing, completed, failed
  assemblyAiId: text("assembly_ai_id")
});
var transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  text: text("text").notNull(),
  confidence: real("confidence"),
  words: jsonb("words"),
  // array of word objects with timestamps
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var sentimentAnalysis = pgTable("sentiment_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  overallSentiment: text("overall_sentiment").notNull(),
  // positive, negative, neutral
  overallScore: real("overall_score").notNull(),
  // 0-1
  segments: jsonb("segments"),
  // array of sentiment segments
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var callAnalysis = pgTable("call_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  performanceScore: real("performance_score").notNull(),
  talkTimeRatio: real("talk_time_ratio"),
  // employee talk time / total time
  responseTime: real("response_time"),
  // average response time in seconds
  keywords: text("keywords").array(),
  topics: text("topics").array(),
  summary: text("summary"),
  actionItems: text("action_items").array(),
  feedback: jsonb("feedback"),
  // AI-generated feedback object
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true
});
var insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  uploadedAt: true
});
var insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  createdAt: true
});
var insertSentimentAnalysisSchema = createInsertSchema(sentimentAnalysis).omit({
  id: true,
  createdAt: true
});
var insertCallAnalysisSchema = createInsertSchema(callAnalysis).omit({
  id: true,
  createdAt: true
});

// server/routes.ts
import { z } from "zod";
var upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 500 * 1024 * 1024
    // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only audio files are allowed."));
    }
  }
});
async function registerRoutes(app2) {
  app2.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });
  app2.get("/api/dashboard/sentiment", async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });
  app2.get("/api/dashboard/performers", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 3;
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });
  app2.get("/api/employees", async (req, res) => {
    try {
      const employees2 = await storage.getAllEmployees();
      res.json(employees2);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });
  app2.post("/api/employees", async (req, res) => {
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
  app2.get("/api/calls", async (req, res) => {
    try {
      const { status, sentiment, employee, search } = req.query;
      let calls2 = await storage.getCallsWithDetails();
      if (status) {
        calls2 = calls2.filter((call) => call.status === status);
      }
      if (sentiment) {
        calls2 = calls2.filter((call) => call.sentiment?.overallSentiment === sentiment);
      }
      if (employee) {
        calls2 = calls2.filter((call) => call.employeeId === employee);
      }
      if (search) {
        calls2 = await storage.searchCalls(search);
      }
      res.json(calls2);
    } catch (error) {
      res.status(500).json({ message: "Failed to get calls" });
    }
  });
  app2.get("/api/calls/:id", async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      const employee = await storage.getEmployee(call.employeeId);
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
  app2.post("/api/calls/upload", upload.single("audioFile"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }
      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "Employee ID is required" });
        return;
      }
      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }
      const call = await storage.createCall({
        employeeId,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: "processing"
      });
      processAudioFile(call.id, req.file.path, req.file.buffer || fs.readFileSync(req.file.path)).catch((error) => {
        console.error(`Failed to process call ${call.id}:`, error);
        storage.updateCall(call.id, { status: "failed" });
      });
      res.status(201).json(call);
    } catch (error) {
      res.status(500).json({ message: "Failed to upload call" });
    }
  });
  async function cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error("Failed to cleanup file:", error);
    }
  }
  async function processAudioFile(callId, filePath, audioBuffer) {
    console.log(`[${callId}] Starting audio processing...`);
    try {
      console.log(`[${callId}] Step 1/5: Uploading audio file to AssemblyAI...`);
      const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      console.log(`[${callId}] Step 1/5: Upload successful. Audio URL: ${audioUrl}`);
      console.log(`[${callId}] Step 2/5: Submitting for transcription...`);
      const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
      console.log(`[${callId}] Step 2/5: Transcription submitted. Transcript ID: ${transcriptId}`);
      await storage.updateCall(callId, { assemblyAiId: transcriptId });
      console.log(`[${callId}] Step 3/5: Polling for results... (This may take some time)`);
      const response = await assemblyAIService.pollTranscript(transcriptId);
      console.log(`[${callId}] Step 3/5: Polling complete. Status: ${response.status}`);
      console.log(`[${callId}] Step 4/5: Processing transcript data...`);
      const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(response, callId);
      console.log(`[${callId}] Step 4/5: Data processing complete.`);
      console.log(`[${callId}] Step 5/5: Saving results to the database...`);
      await storage.createTranscript(transcript);
      await storage.createSentimentAnalysis(sentiment);
      await storage.createCallAnalysis(analysis);
      await storage.updateCall(callId, {
        status: "completed",
        duration: Math.floor((response.words?.[response.words.length - 1]?.end || 0) / 1e3)
      });
      console.log(`[${callId}] Step 5/5: Database updated. Status is now 'completed'.`);
      await cleanupFile(filePath);
      console.log(`[${callId}] Processing finished successfully.`);
    } catch (error) {
      console.error(`[${callId}] A critical error occurred during audio processing:`, error);
      await storage.updateCall(callId, { status: "failed" });
      await cleanupFile(filePath);
    }
  }
  app2.get("/api/calls/:id/transcript", async (req, res) => {
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
  app2.get("/api/calls/:id/sentiment", async (req, res) => {
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
  app2.get("/api/calls/:id/analysis", async (req, res) => {
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
  app2.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q;
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
  app2.get("/api/performance", async (req, res) => {
    try {
      const performers = await storage.getTopPerformers(10);
      res.json(performers);
    } catch (error) {
      console.error("Failed to get performance data:", error);
      res.status(500).json({ message: "Failed to get performance data" });
    }
  });
  app2.get("/api/reports/summary", async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      const sentiment = await storage.getSentimentDistribution();
      const performers = await storage.getTopPerformers(5);
      const reportData = {
        metrics,
        sentiment,
        performers
      };
      res.json(reportData);
    } catch (error) {
      console.error("Failed to generate report data:", error);
      res.status(500).json({ message: "Failed to generate report data" });
    }
  });
  app2.delete("/api/calls/:id", async (req, res) => {
    try {
      const callId = req.params.id;
      await storage.deleteCall(callId);
      console.log(`Successfully deleted call ID: ${callId}`);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete call:", error);
      res.status(500).json({ message: "Failed to delete call" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs2 from "fs";
import path3 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path2 from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      ),
      await import("@replit/vite-plugin-dev-banner").then(
        (m) => m.devBanner()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path2.resolve(import.meta.dirname, "client", "src"),
      "@shared": path2.resolve(import.meta.dirname, "shared"),
      "@assets": path2.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path2.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path2.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path3.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
