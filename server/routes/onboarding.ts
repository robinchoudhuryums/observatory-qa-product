/**
 * Onboarding routes: logo upload, reference document upload, branding setup.
 * These supplement the settings routes with file-upload-oriented endpoints
 * used during the onboarding wizard and in settings.
 */
import type { Express } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { storage, objectStorage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { REFERENCE_DOC_CATEGORIES, PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";
import { enqueueDocumentIndexing } from "../services/queue";
import { removeDocumentChunks, searchRelevantChunks, formatRetrievedContext, hasIndexedChunks } from "../services/rag";
import { isEmbeddingAvailable } from "../services/embeddings";
import { invalidateRefDocCache } from "./calls";

// Configure multer for logo + document uploads
const onboardingUploadsDir = "uploads/onboarding";
if (!fs.existsSync(onboardingUploadsDir)) {
  fs.mkdirSync(onboardingUploadsDir, { recursive: true });
}

const logoUpload = multer({
  dest: onboardingUploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for logos
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

const docUpload = multer({
  dest: onboardingUploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for documents
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

function cleanupFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

/**
 * Extract dominant colors from an image buffer.
 * Simple algorithm: sample pixels and find the two most common non-white/non-black hue clusters.
 * Returns [primaryColor, secondaryColor] as hex strings.
 */
function extractColorsFromImage(buffer: Buffer, mimeType: string): { primary: string; secondary: string } | null {
  // For SVG, try to parse fill/stroke colors from the markup
  if (mimeType === "image/svg+xml") {
    const svgText = buffer.toString("utf-8");
    const hexColors = svgText.match(/#[0-9a-fA-F]{6}/g) || [];
    const filtered = hexColors.filter(c => {
      const upper = c.toUpperCase();
      return upper !== "#FFFFFF" && upper !== "#000000" && upper !== "#FFFFF" && upper !== "#00000";
    });
    if (filtered.length >= 2) return { primary: filtered[0], secondary: filtered[1] };
    if (filtered.length === 1) return { primary: filtered[0], secondary: darkenHex(filtered[0]) };
    return null;
  }

  // For raster images (PNG/JPEG/WebP/GIF), sample raw pixel data.
  // This is a simplified approach — works well for logos with solid brand colors.
  // For PNG, the raw buffer starts with an 8-byte signature, then IHDR chunk.
  // Rather than implementing full PNG decoding, we sample byte patterns.
  try {
    const colorCounts = new Map<string, number>();

    // Sample every Nth byte triple looking for RGB-like patterns
    const step = Math.max(3, Math.floor(buffer.length / 3000)) * 3;
    for (let i = 0; i < buffer.length - 2; i += step) {
      const r = buffer[i];
      const g = buffer[i + 1];
      const b = buffer[i + 2];

      // Skip near-white, near-black, and near-gray pixels
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 30 || min > 225) continue; // too dark or too light
      if (max - min < 30) continue; // too gray / desaturated

      // Quantize to reduce noise (round to nearest 16)
      const qr = Math.round(r / 16) * 16;
      const qg = Math.round(g / 16) * 16;
      const qb = Math.round(b / 16) * 16;
      const key = `${qr},${qg},${qb}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }

    if (colorCounts.size === 0) return null;

    // Sort by frequency
    const sorted = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0][0].split(",").map(Number);
    const primaryHex = `#${primary.map(v => v.toString(16).padStart(2, "0")).join("")}`;

    // Find a secondary color that's visually distinct from primary
    let secondaryHex = darkenHex(primaryHex);
    for (let i = 1; i < sorted.length; i++) {
      const c = sorted[i][0].split(",").map(Number);
      const dist = Math.abs(c[0] - primary[0]) + Math.abs(c[1] - primary[1]) + Math.abs(c[2] - primary[2]);
      if (dist > 80) { // Sufficiently different
        secondaryHex = `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
        break;
      }
    }

    return { primary: primaryHex, secondary: secondaryHex };
  } catch {
    return null;
  }
}

/** Darken a hex color by ~20% for use as secondary when only one color found */
function darkenHex(hex: string): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return "#374151"; // fallback gray
  const r = Math.max(0, Math.round(parseInt(match[1], 16) * 0.8));
  const g = Math.max(0, Math.round(parseInt(match[2], 16) * 0.8));
  const b = Math.max(0, Math.round(parseInt(match[3], 16) * 0.8));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Extract text from uploaded document files.
 * For TXT/MD/CSV: direct read. For PDF: pdf-parse library. For DOCX: XML extraction.
 * All extraction is wrapped in error boundaries — failures return empty string (graceful degradation).
 */
async function extractTextFromFile(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv") {
      return buffer.toString("utf-8").slice(0, 50000); // Cap at 50K chars
    }

    // PDF: use pdf-parse for proper text extraction
    if (mimeType === "application/pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        const text = result.text || "";
        if (text.trim().length > 0) {
          return text.slice(0, 50000);
        }
        // Empty result from parser — try regex fallback
        return extractPdfFallback(buffer);
      } catch (pdfErr) {
        // Fallback to regex extraction for malformed PDFs
        logger.warn({ err: pdfErr }, "pdf-parse failed, falling back to regex extraction");
        return extractPdfFallback(buffer);
      }
    }

    // DOCX: extract from XML within the zip
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const text = buffer.toString("utf-8");
      const textParts: string[] = [];
      const regex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        textParts.push(match[1]);
      }
      return textParts.join(" ").slice(0, 50000);
    }

    return "";
  } catch (error) {
    logger.error({ err: error, mimeType }, "Text extraction failed");
    return "";
  }
}

/** Fallback PDF extraction when pdf-parse fails (e.g., encrypted or corrupted PDFs) */
function extractPdfFallback(buffer: Buffer): string {
  const text = buffer.toString("latin1");
  const textParts: string[] = [];
  const regex = /\(([^)]{1,500})\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\\\/g, "\\")
      .replace(/\\([()])/g, "$1");
    if (content.trim().length > 1 && /[a-zA-Z]/.test(content)) {
      textParts.push(content.trim());
    }
  }
  return textParts.join(" ").slice(0, 50000);
}

export function registerOnboardingRoutes(app: Express): void {

  // --- Upload logo ---
  app.post("/api/onboarding/logo", requireAuth, requireRole("admin"), injectOrgContext,
    logoUpload.single("logo"),
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ message: "No logo file provided" });
      }

      const filePath = req.file.path;
      try {
        const buffer = fs.readFileSync(filePath);
        const orgId = req.orgId!;
        const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
        const storagePath = `orgs/${orgId}/branding/logo${ext}`;

        // Upload to cloud storage if available
        if (objectStorage) {
          await objectStorage.uploadFile(storagePath, buffer, req.file.mimetype);
        }

        // Generate a URL for the logo
        const logoUrl = `/api/onboarding/logo/serve`;

        // Extract colors from the logo
        const colors = extractColorsFromImage(buffer, req.file.mimetype);

        // Update org branding
        const org = await storage.getOrganization(orgId);
        const currentSettings = (org?.settings || {}) as Record<string, any>;
        const currentBranding = (currentSettings.branding || {}) as Record<string, any>;
        const newBranding: Record<string, any> = {
          ...currentBranding,
          logoUrl,
          logoStoragePath: storagePath,
        };

        // Auto-apply extracted colors (only if user hasn't set custom colors)
        if (colors) {
          if (!currentBranding.primaryColor) {
            newBranding.primaryColor = colors.primary;
          }
          if (!currentBranding.secondaryColor) {
            newBranding.secondaryColor = colors.secondary;
          }
        }

        await storage.updateOrganization(orgId, {
          settings: { ...currentSettings, branding: newBranding } as any,
        });

        logger.info({ orgId, storagePath }, "Logo uploaded");

        res.json({
          logoUrl,
          extractedColors: colors,
          branding: newBranding,
        });
      } catch (error) {
        logger.error({ err: error }, "Logo upload failed");
        res.status(500).json({ message: "Failed to upload logo" });
      } finally {
        cleanupFile(filePath);
      }
    },
  );

  // --- Serve logo ---
  app.get("/api/onboarding/logo/serve", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const storagePath = (org?.settings?.branding as any)?.logoStoragePath;
      if (!storagePath || !objectStorage) {
        return res.status(404).json({ message: "No logo found" });
      }

      const buffer = await objectStorage.downloadFile(storagePath);
      if (!buffer) {
        return res.status(404).json({ message: "Logo file not found" });
      }

      const ext = path.extname(storagePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };

      res.setHeader("Content-Type", mimeMap[ext] || "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ message: "Failed to serve logo" });
    }
  });

  // --- Upload reference document ---
  app.post("/api/reference-documents", requireAuth, requireRole("admin"), injectOrgContext,
    docUpload.single("document"),
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ message: "No document file provided" });
      }

      const filePath = req.file.path;
      try {
        const buffer = fs.readFileSync(filePath);
        const orgId = req.orgId!;
        const docId = randomUUID();
        const ext = path.extname(req.file.originalname).toLowerCase();
        const storagePath = `orgs/${orgId}/reference-documents/${docId}${ext}`;

        // Upload to cloud storage
        if (objectStorage) {
          await objectStorage.uploadFile(storagePath, buffer, req.file.mimetype);
        }

        // Extract text content for AI injection
        const extractedText = await extractTextFromFile(buffer, req.file.mimetype);

        const { name, category, description, appliesTo } = req.body;

        let parsedAppliesTo: string[] | undefined;
        if (appliesTo) {
          try {
            parsedAppliesTo = JSON.parse(appliesTo);
          } catch {
            return res.status(400).json({ message: "Invalid appliesTo format" });
          }
        }

        const doc = await storage.createReferenceDocument(orgId, {
          orgId,
          name: name || req.file.originalname,
          category: REFERENCE_DOC_CATEGORIES.includes(category) ? category : "other",
          description: description || undefined,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          storagePath,
          extractedText: extractedText || undefined,
          appliesTo: parsedAppliesTo,
          isActive: true,
          uploadedBy: req.user?.username,
        });

        logger.info({ orgId, docId: doc.id, name: doc.name, category: doc.category }, "Reference document uploaded");
        invalidateRefDocCache(orgId);

        // Enqueue RAG indexing (chunking + embedding) if text was extracted
        if (extractedText && extractedText.length > 0) {
          enqueueDocumentIndexing({
            orgId,
            documentId: doc.id,
            extractedText,
          }).catch((err) => {
            logger.warn({ err, docId: doc.id }, "Failed to enqueue RAG indexing (non-blocking)");
          });
        }

        res.status(201).json(doc);
      } catch (error) {
        logger.error({ err: error }, "Document upload failed");
        res.status(500).json({ message: "Failed to upload document" });
      } finally {
        cleanupFile(filePath);
      }
    },
  );

  // --- List reference documents ---
  app.get("/api/reference-documents", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const docs = await storage.listReferenceDocuments(req.orgId!);
      // Don't send extractedText in list response (can be large)
      res.json(docs.map(d => ({ ...d, extractedText: d.extractedText ? `[${d.extractedText.length} chars]` : undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to list documents" });
    }
  });

  // --- Get reference document details ---
  app.get("/api/reference-documents/:id", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const doc = await storage.getReferenceDocument(req.orgId!, req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (error) {
      res.status(500).json({ message: "Failed to get document" });
    }
  });

  // --- Update reference document metadata ---
  app.patch("/api/reference-documents/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { name, category, description, appliesTo, isActive } = req.body;
      const updates: Record<string, unknown> = {};
      if (name) updates.name = name;
      if (category && REFERENCE_DOC_CATEGORIES.includes(category)) updates.category = category;
      if (description !== undefined) updates.description = description;
      if (appliesTo !== undefined) updates.appliesTo = appliesTo;
      if (isActive !== undefined) updates.isActive = isActive;

      const doc = await storage.updateReferenceDocument(req.orgId!, req.params.id, updates);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (error) {
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  // --- Delete reference document ---
  app.delete("/api/reference-documents/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const doc = await storage.getReferenceDocument(req.orgId!, req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      // Delete from cloud storage
      if (objectStorage && doc.storagePath) {
        try {
          await objectStorage.deleteObject(doc.storagePath);
        } catch { /* non-blocking */ }
      }

      // Remove RAG chunks if database is available
      if (process.env.DATABASE_URL) {
        try {
          const { getDatabase } = await import("../db/index");
          const db = getDatabase();
          if (db) {
            await removeDocumentChunks(db as any, req.params.id);
          }
        } catch { /* non-blocking */ }
      }

      await storage.deleteReferenceDocument(req.orgId!, req.params.id);
      invalidateRefDocCache(req.orgId!);
      res.json({ message: "Document deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // --- RAG: Get indexing status for org's documents ---
  app.get("/api/reference-documents/rag/status", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;

      // Check plan tier
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      const ragEnabled = plan?.limits?.ragEnabled === true;

      const result: Record<string, unknown> = {
        ragEnabled,
        embeddingServiceAvailable: isEmbeddingAvailable(),
        databaseAvailable: !!process.env.DATABASE_URL,
      };

      if (ragEnabled && process.env.DATABASE_URL) {
        try {
          const { getDatabase } = await import("../db/index");
          const db = getDatabase();
          if (db) {
            const hasChunks = await hasIndexedChunks(db as any, orgId);
            result.hasIndexedChunks = hasChunks;

            // Get chunk counts per document
            const { sql } = await import("drizzle-orm");
            const counts = await (db as any).execute(sql`
              SELECT document_id, COUNT(*) as chunk_count
              FROM document_chunks
              WHERE org_id = ${orgId}
              GROUP BY document_id
            `);
            result.documentChunkCounts = (counts.rows as any[]).reduce((acc: Record<string, number>, row: any) => {
              acc[row.document_id] = parseInt(row.chunk_count);
              return acc;
            }, {});
          }
        } catch { /* non-blocking */ }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get RAG status" });
    }
  });

  // --- RAG: Re-index a specific document ---
  app.post("/api/reference-documents/:id/reindex", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const doc = await storage.getReferenceDocument(orgId, req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      if (!doc.extractedText || doc.extractedText.length === 0) {
        return res.status(400).json({ message: "Document has no extracted text to index" });
      }

      await enqueueDocumentIndexing({
        orgId,
        documentId: doc.id,
        extractedText: doc.extractedText,
      });

      res.json({ message: "Document re-indexing started", documentId: doc.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to start re-indexing" });
    }
  });

  // --- RAG: Search knowledge base (preview/test) ---
  app.post("/api/reference-documents/rag/search", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const { query, topK } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query text is required" });
      }

      if (!process.env.DATABASE_URL) {
        return res.status(503).json({ message: "Database not configured for RAG search" });
      }

      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        return res.status(503).json({ message: "Database not available" });
      }

      // Get all active document IDs for this org
      const docs = await storage.listReferenceDocuments(orgId);
      const activeDocIds = docs.filter(d => d.isActive).map(d => d.id);

      if (activeDocIds.length === 0) {
        return res.json({ chunks: [], formattedContext: "" });
      }

      const chunks = await searchRelevantChunks(
        db as any,
        orgId,
        query,
        activeDocIds,
        { topK: topK || 6 },
      );

      res.json({
        chunks,
        formattedContext: formatRetrievedContext(chunks),
      });
    } catch (error) {
      logger.error({ err: error }, "RAG search failed");
      res.status(500).json({ message: "RAG search failed" });
    }
  });

  // --- Mark onboarding as completed ---
  app.post("/api/onboarding/complete", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const settings = (org?.settings || {}) as Record<string, any>;
      const branding = (settings.branding || {}) as Record<string, any>;

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, branding: { ...branding, onboardingCompleted: true } } as any,
      });

      res.json({ message: "Onboarding marked as completed" });
    } catch (error) {
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });
}
