/**
 * BullMQ worker for document RAG indexing.
 *
 * Processes DocumentIndexingJob: chunks text, generates embeddings
 * via Bedrock Titan Embed V2, and stores in document_chunks table
 * with pgvector embeddings.
 */
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { indexDocument } from "../services/rag";
import { logger } from "../services/logger";
import type { DocumentIndexingJob } from "../services/queue";

let dbInstance: ReturnType<typeof drizzle> | null = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL required for RAG indexing worker");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  dbInstance = drizzle(pool);
  return dbInstance;
}

export function createIndexingWorker(connection: ConnectionOptions): Worker<DocumentIndexingJob> {
  const worker = new Worker<DocumentIndexingJob>(
    "document-indexing",
    async (job: Job<DocumentIndexingJob>) => {
      const { orgId, documentId, extractedText } = job.data;
      logger.info({ documentId, orgId, jobId: job.id }, "Starting document indexing");

      const db = await getDb();
      const chunkCount = await indexDocument(db as any, orgId, documentId, extractedText);

      logger.info({ documentId, chunkCount, jobId: job.id }, "Document indexing complete");
      return { chunkCount };
    },
    {
      connection,
      concurrency: 2, // Process up to 2 documents concurrently
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Indexing worker: job failed");
  });

  return worker;
}
