/**
 * RAG (Retrieval-Augmented Generation) service.
 *
 * Orchestrates document chunking, embedding, storage, and retrieval
 * using pgvector for vector similarity search with BM25 keyword boosting.
 *
 * Flow:
 * 1. On document upload: chunk → embed → store in document_chunks table
 * 2. On call analysis: embed query → pgvector search → inject relevant chunks
 */
import { randomUUID } from "crypto";
import { sql, eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chunkDocument, type DocumentChunk } from "./chunker";
import { generateEmbedding, generateEmbeddingsBatch, isEmbeddingAvailable } from "./embeddings";
import { logger } from "./logger";
import * as tables from "../db/schema";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  documentCategory: string;
  chunkIndex: number;
  text: string;
  sectionHeader: string | null;
  score: number;
}

export interface RAGSearchOptions {
  topK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
}

/**
 * Process a reference document: chunk its text and store embeddings.
 * Called after a document is uploaded and text is extracted.
 */
export async function indexDocument(
  db: NodePgDatabase,
  orgId: string,
  documentId: string,
  extractedText: string,
): Promise<number> {
  if (!isEmbeddingAvailable()) {
    logger.warn("Embedding service unavailable — skipping RAG indexing");
    return 0;
  }

  if (!extractedText || extractedText.trim().length === 0) {
    logger.warn({ documentId }, "No text to index for RAG");
    return 0;
  }

  // Remove old chunks for this document (handles re-indexing)
  await db.delete(tables.documentChunks)
    .where(eq(tables.documentChunks.documentId, documentId));

  // Chunk the document
  const chunks = chunkDocument(documentId, extractedText);
  if (chunks.length === 0) return 0;

  logger.info({ documentId, chunkCount: chunks.length }, "Chunking complete, generating embeddings");

  // Generate embeddings in batches
  const texts = chunks.map((c) => c.text);
  const embeddings = await generateEmbeddingsBatch(texts);

  // Store chunks with embeddings
  const rows = chunks.map((chunk, i) => ({
    id: randomUUID(),
    orgId,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    sectionHeader: chunk.sectionHeader,
    tokenCount: chunk.tokenCount,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    embedding: embeddings[i],
  }));

  // Insert in batches of 100 to avoid exceeding query parameter limits
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await db.insert(tables.documentChunks).values(batch);
  }

  logger.info({ documentId, chunksStored: rows.length }, "RAG indexing complete");
  return rows.length;
}

/**
 * Remove all chunks for a document (called on document deletion).
 */
export async function removeDocumentChunks(
  db: NodePgDatabase,
  documentId: string,
): Promise<void> {
  await db.delete(tables.documentChunks)
    .where(eq(tables.documentChunks.documentId, documentId));
}

/**
 * Search for relevant document chunks using hybrid semantic + keyword search.
 *
 * Uses pgvector's cosine distance operator (<=>), then applies BM25-style
 * keyword boosting for precision.
 */
export async function searchRelevantChunks(
  db: NodePgDatabase,
  orgId: string,
  queryText: string,
  documentIds: string[],
  options: RAGSearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? 6;
  const semanticWeight = options.semanticWeight ?? 0.7;
  const keywordWeight = options.keywordWeight ?? 0.3;

  if (!isEmbeddingAvailable() || documentIds.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Fetch top candidates from pgvector (retrieve more than topK for keyword reranking)
  const candidateLimit = Math.min(topK * 3, 50);

  // Use raw SQL for pgvector cosine distance
  const candidates = await db.execute(sql`
    SELECT
      dc.id,
      dc.document_id,
      dc.chunk_index,
      dc.text,
      dc.section_header,
      rd.name AS document_name,
      rd.category AS document_category,
      1 - (dc.embedding <=> ${embeddingStr}::vector) AS semantic_score
    FROM document_chunks dc
    JOIN reference_documents rd ON rd.id = dc.document_id
    WHERE dc.org_id = ${orgId}
      AND dc.document_id = ANY(${documentIds}::text[])
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${candidateLimit}
  `);

  if (!candidates.rows || candidates.rows.length === 0) {
    return [];
  }

  // Apply BM25-style keyword boosting
  const results: RetrievedChunk[] = (candidates.rows as any[]).map((row) => {
    const semanticScore = parseFloat(row.semantic_score) || 0;
    const kwScore = bm25Score(queryText, row.text);
    const combinedScore = semanticWeight * semanticScore + keywordWeight * kwScore;

    return {
      id: row.id,
      documentId: row.document_id,
      documentName: row.document_name,
      documentCategory: row.document_category,
      chunkIndex: row.chunk_index,
      text: row.text,
      sectionHeader: row.section_header || null,
      score: combinedScore,
    };
  });

  // Sort by combined score, filter out low-relevance chunks, and return top K
  results.sort((a, b) => b.score - a.score);
  const MIN_RELEVANCE_SCORE = 0.3;
  const relevant = results.filter(r => r.score >= MIN_RELEVANCE_SCORE);
  return relevant.slice(0, topK);
}

/**
 * Build context string from retrieved chunks for injection into the AI prompt.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  const sections: string[] = [];
  for (const chunk of chunks) {
    const header = chunk.sectionHeader
      ? `[${chunk.documentName} — ${chunk.documentCategory} — §${chunk.sectionHeader}]`
      : `[${chunk.documentName} — ${chunk.documentCategory}]`;
    sections.push(`${header}\n${chunk.text}`);
  }

  return sections.join("\n\n");
}

/**
 * Check if an org has any indexed document chunks.
 */
export async function hasIndexedChunks(
  db: NodePgDatabase,
  orgId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM document_chunks WHERE org_id = ${orgId} AND embedding IS NOT NULL
    ) AS has_chunks
  `);
  return (result.rows as any[])[0]?.has_chunks === true;
}

// --- BM25-style keyword scoring (simplified, no corpus IDF) ---

function bm25Score(query: string, text: string): number {
  const k1 = 1.2;
  const b = 0.75;
  const avgDocLen = 500; // Approximate average chunk token count

  const queryTerms = tokenize(query);
  const docTerms = tokenize(text);
  const docLen = docTerms.length;

  if (queryTerms.length === 0 || docLen === 0) return 0;

  // Build term frequency map
  const tf = new Map<string, number>();
  for (const term of docTerms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) || 0;
    if (freq === 0) continue;

    // BM25 term frequency saturation
    const numerator = freq * (k1 + 1);
    const denominator = freq + k1 * (1 - b + b * (docLen / avgDocLen));
    score += numerator / denominator;
  }

  // Normalize to 0–1 range
  return Math.min(score / queryTerms.length, 1);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
