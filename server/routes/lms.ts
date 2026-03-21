/**
 * LMS (Learning Management System) routes.
 *
 * Features:
 * - Learning modules: articles, quizzes, AI-generated content from reference docs
 * - Learning paths: ordered sequences of modules
 * - Employee progress tracking
 * - AI-powered module generation from uploaded reference documents
 * - RAG-powered knowledge base search for employees
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { logger } from "../services/logger";
import { withRetry } from "./helpers";
import type { LearningModule, InsertLearningModule } from "@shared/schema";

export function registerLmsRoutes(app: Express): void {

  // --- Learning Modules ---

  /** GET /api/lms/modules — List all learning modules for the org */
  app.get("/api/lms/modules", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { category, contentType, published } = req.query;
    const modules = await storage.listLearningModules(orgId, {
      category: category as string | undefined,
      contentType: contentType as string | undefined,
      isPublished: published === "true" ? true : published === "false" ? false : undefined,
    });
    res.json(modules);
  });

  /** GET /api/lms/modules/:id — Get a specific module */
  app.get("/api/lms/modules/:id", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const module = await storage.getLearningModule(orgId, req.params.id);
    if (!module) return res.status(404).json({ message: "Module not found" });
    res.json(module);
  });

  /** POST /api/lms/modules — Create a new learning module */
  app.post("/api/lms/modules", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { title, description, contentType, category, content, quizQuestions, estimatedMinutes, difficulty, tags, isPublished } = req.body;
    if (!title || !contentType) return res.status(400).json({ message: "title and contentType are required" });

    const module = await storage.createLearningModule(orgId, {
      orgId,
      title,
      description,
      contentType,
      category,
      content,
      quizQuestions,
      estimatedMinutes,
      difficulty,
      tags,
      isPublished: isPublished ?? false,
      createdBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(module);
  });

  /** PATCH /api/lms/modules/:id — Update a module */
  app.patch("/api/lms/modules/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const updated = await storage.updateLearningModule(orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Module not found" });
    res.json(updated);
  });

  /** DELETE /api/lms/modules/:id — Delete a module */
  app.delete("/api/lms/modules/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    await storage.deleteLearningModule(orgId, req.params.id);
    res.json({ message: "Module deleted" });
  });

  /**
   * POST /api/lms/modules/generate — AI-generate a learning module from a reference document.
   * Takes a reference document ID and generates structured learning content.
   */
  app.post("/api/lms/modules/generate", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { documentId, category, difficulty, generateQuiz } = req.body;
    if (!documentId) return res.status(400).json({ message: "documentId is required" });

    try {
      // Load the reference document
      const doc = await storage.getReferenceDocument(orgId, documentId);
      if (!doc) return res.status(404).json({ message: "Reference document not found" });
      if (!doc.extractedText || doc.extractedText.length < 50) {
        return res.status(400).json({ message: "Document has insufficient text content for module generation" });
      }

      if (!aiProvider.isAvailable || !aiProvider.generateText) {
        return res.status(503).json({ message: "AI provider not available for module generation" });
      }

      const docText = doc.extractedText.slice(0, 30000); // Cap text length
      const quizInstruction = generateQuiz
        ? `\n\nAlso generate a "quiz" section with 5-8 multiple-choice questions testing key concepts. Format each question as:
{"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"Why this is correct"}`
        : "";

      const prompt = `You are creating a training module from a company document. Convert the following document into structured learning content.

DOCUMENT: "${doc.name}" (${doc.category})
---
${docText}
---

Create a training module with:
1. A clear, engaging title (not just the document name)
2. A brief description (1-2 sentences)
3. Well-organized content in Markdown format with:
   - Clear headings and sections
   - Key takeaways highlighted
   - Practical examples where possible
   - A summary section at the end
4. An estimated reading/completion time in minutes${quizInstruction}

Respond with ONLY valid JSON (no markdown fences):
{"title":"...","description":"...","content":"...markdown content...","estimatedMinutes":0${generateQuiz ? ',"quizQuestions":[...]' : ''}}`;

      const response = await withRetry(
        () => aiProvider.generateText!(prompt),
        { retries: 2, baseDelay: 2000, label: "LMS module generation" }
      );

      // Parse AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ message: "AI response was not parseable" });
      }
      const generated = JSON.parse(jsonMatch[0]);

      // Create the module
      const module = await storage.createLearningModule(orgId, {
        orgId,
        title: generated.title || `Training: ${doc.name}`,
        description: generated.description || `Auto-generated from ${doc.name}`,
        contentType: "ai_generated",
        category: category || "general",
        content: generated.content || "",
        quizQuestions: generated.quizQuestions || undefined,
        estimatedMinutes: generated.estimatedMinutes || 10,
        difficulty: difficulty || "intermediate",
        tags: [doc.category, "ai_generated"],
        sourceDocumentId: documentId,
        isPublished: false, // Draft by default
        createdBy: (req.user as any)?.name || "system",
      });

      res.status(201).json(module);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate learning module");
      res.status(500).json({ message: "Failed to generate learning module" });
    }
  });

  // --- Learning Paths ---

  /** GET /api/lms/paths — List all learning paths */
  app.get("/api/lms/paths", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const paths = await storage.listLearningPaths(orgId);
    res.json(paths);
  });

  /** GET /api/lms/paths/:id — Get a learning path with modules */
  app.get("/api/lms/paths/:id", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const path = await storage.getLearningPath(orgId, req.params.id);
    if (!path) return res.status(404).json({ message: "Path not found" });

    // Load modules for this path
    const modules = await Promise.all(
      path.moduleIds.map(mid => storage.getLearningModule(orgId, mid))
    );

    res.json({
      ...path,
      modules: modules.filter(Boolean),
    });
  });

  /** POST /api/lms/paths — Create a learning path */
  app.post("/api/lms/paths", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { title, description, category, moduleIds, isRequired, assignedTo, estimatedMinutes } = req.body;
    if (!title || !moduleIds || !Array.isArray(moduleIds)) {
      return res.status(400).json({ message: "title and moduleIds are required" });
    }

    const path = await storage.createLearningPath(orgId, {
      orgId,
      title,
      description,
      category,
      moduleIds,
      isRequired: isRequired ?? false,
      assignedTo,
      estimatedMinutes,
      createdBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(path);
  });

  /** PATCH /api/lms/paths/:id — Update a learning path */
  app.patch("/api/lms/paths/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const updated = await storage.updateLearningPath(orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Path not found" });
    res.json(updated);
  });

  /** DELETE /api/lms/paths/:id — Delete a learning path */
  app.delete("/api/lms/paths/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    await storage.deleteLearningPath(orgId, req.params.id);
    res.json({ message: "Path deleted" });
  });

  // --- Employee Progress ---

  /** GET /api/lms/progress/:employeeId — Get an employee's learning progress */
  app.get("/api/lms/progress/:employeeId", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const progress = await storage.getEmployeeLearningProgress(orgId, req.params.employeeId);
    res.json(progress);
  });

  /** POST /api/lms/progress — Update learning progress (start, complete, quiz score) */
  app.post("/api/lms/progress", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId, moduleId, pathId, status, quizScore, quizAttempts, timeSpentMinutes, notes } = req.body;
    if (!employeeId || !moduleId) return res.status(400).json({ message: "employeeId and moduleId are required" });

    const progress = await storage.upsertLearningProgress(orgId, {
      orgId,
      employeeId,
      moduleId,
      pathId,
      status: status || "in_progress",
      quizScore,
      quizAttempts,
      timeSpentMinutes,
      completedAt: status === "completed" ? new Date().toISOString() : undefined,
      notes,
    });
    res.json(progress);
  });

  /** GET /api/lms/stats — LMS analytics overview */
  app.get("/api/lms/stats", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const modules = await storage.listLearningModules(orgId);
      const paths = await storage.listLearningPaths(orgId);
      const employees = await storage.getAllEmployees(orgId);

      const publishedModules = modules.filter(m => m.isPublished);
      const aiGenerated = modules.filter(m => m.contentType === "ai_generated");

      // Get aggregate progress
      let totalCompletions = 0;
      let totalInProgress = 0;
      for (const emp of employees.slice(0, 50)) { // Cap at 50 for performance
        const progress = await storage.getEmployeeLearningProgress(orgId, emp.id);
        totalCompletions += progress.filter(p => p.status === "completed").length;
        totalInProgress += progress.filter(p => p.status === "in_progress").length;
      }

      res.json({
        totalModules: modules.length,
        publishedModules: publishedModules.length,
        aiGeneratedModules: aiGenerated.length,
        totalPaths: paths.length,
        totalCompletions,
        totalInProgress,
        modulesByCategory: modules.reduce((acc, m) => {
          const cat = m.category || "general";
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        modulesByType: modules.reduce((acc, m) => {
          acc[m.contentType] = (acc[m.contentType] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get LMS stats");
      res.status(500).json({ message: "Failed to get LMS statistics" });
    }
  });

  /** GET /api/lms/knowledge-search — Search the knowledge base (RAG) for employees */
  app.get("/api/lms/knowledge-search", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const query = req.query.q as string;
    if (!query || query.trim().length < 3) {
      return res.status(400).json({ message: "Search query must be at least 3 characters" });
    }

    try {
      // Search published modules
      const modules = await storage.listLearningModules(orgId, { isPublished: true });
      const matches = modules.filter(m => {
        const searchText = `${m.title} ${m.description || ""} ${m.content || ""} ${(m.tags || []).join(" ")}`.toLowerCase();
        return query.toLowerCase().split(" ").every(term => searchText.includes(term));
      }).slice(0, 10);

      // Also search reference documents (RAG)
      let ragResults: Array<{ text: string; documentName: string; relevance: number }> = [];
      if (process.env.DATABASE_URL) {
        try {
          const { searchRelevantChunks, formatRetrievedContext } = await import("../services/rag");
          const { getDatabase } = await import("../db/index");
          const db = getDatabase();
          if (db) {
            const refDocs = await storage.listReferenceDocuments(orgId);
            const docIds = refDocs.filter(d => d.isActive).map(d => d.id);
            if (docIds.length > 0) {
              const chunks = await searchRelevantChunks(db as any, orgId, query, docIds, { topK: 5 });
              ragResults = chunks.map(c => ({
                text: c.text.slice(0, 500),
                documentName: refDocs.find(d => d.id === c.documentId)?.name || "Unknown",
                relevance: c.score,
              }));
            }
          }
        } catch (ragErr) {
          logger.warn({ err: ragErr }, "RAG search failed in LMS knowledge search");
        }
      }

      res.json({
        modules: matches,
        knowledgeBase: ragResults,
        totalResults: matches.length + ragResults.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to search LMS knowledge base");
      res.status(500).json({ message: "Knowledge search failed" });
    }
  });
}
