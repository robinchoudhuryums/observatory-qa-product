/**
 * RAG document indexing — in-process fallback.
 *
 * When Redis/BullMQ is unavailable, this module handles document
 * indexing synchronously. The BullMQ worker in server/workers/
 * uses the same indexDocument() function from rag.ts.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { indexDocument } from "./rag";
import { logger } from "./logger";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let dbPool: pg.Pool | null = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL required for RAG indexing");
  }

  dbPool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  dbInstance = drizzle(dbPool);
  return dbInstance;
}

/** Close the RAG worker's database pool on shutdown */
export async function closeRagWorkerPool(): Promise<void> {
  if (dbPool) {
    await dbPool.end();
    dbPool = null;
    dbInstance = null;
  }
}

/**
 * Index a document in-process (no queue). Used as fallback
 * when Redis is unavailable.
 */
export async function indexDocumentInProcess(
  orgId: string,
  documentId: string,
  extractedText: string,
): Promise<number> {
  const db = await getDb();
  const count = await indexDocument(db as any, orgId, documentId, extractedText);
  logger.info({ documentId, chunks: count }, "In-process RAG indexing complete");
  return count;
}
