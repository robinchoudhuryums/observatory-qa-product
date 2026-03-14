import { GcsClient } from "../services/gcs";
import { S3Client } from "../services/s3";
import { MemStorage } from "./memory";
import { CloudStorage } from "./cloud";
import type { IStorage, ObjectStorageClient } from "./types";

// Re-export types and utilities so consumers can import from "./storage" or "../storage"
export { type IStorage, type ObjectStorageClient, type UsageSummary, normalizeAnalysis, applyCallFilters, mapConcurrent } from "./types";
export { MemStorage } from "./memory";
export { CloudStorage } from "./cloud";

/**
 * Create the storage backend based on environment configuration.
 *
 * Priority:
 *   1. STORAGE_BACKEND=postgres + DATABASE_URL → PostgresStorage (recommended for SaaS)
 *   2. STORAGE_BACKEND=s3 or S3_BUCKET → CloudStorage (S3)
 *   3. STORAGE_BACKEND=gcs or GCS_CREDENTIALS → CloudStorage (GCS)
 *   4. No config → MemStorage (development only)
 *
 * When using PostgresStorage, an optional S3/GCS client can be provided
 * for audio blob storage. Set S3_BUCKET alongside DATABASE_URL for this.
 */
function createStorage(): IStorage {
  const storageBackend = process.env.STORAGE_BACKEND?.toLowerCase();

  // PostgreSQL backend (recommended for multi-tenant SaaS)
  // Note: Requires initDatabase() to be called first — see initPostgresStorage()
  if (storageBackend === "postgres") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when STORAGE_BACKEND=postgres");
    }
    // PostgresStorage is initialized asynchronously in initPostgresStorage()
    // For now, return MemStorage as placeholder (will be replaced on startup)
    console.log("[STORAGE] PostgreSQL backend selected — will initialize after DB connection");
    return new MemStorage();
  }

  // Explicit S3 or auto-detect via AWS credentials + S3_BUCKET
  if (storageBackend === "s3" || (!storageBackend && process.env.S3_BUCKET)) {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error("S3_BUCKET environment variable is required when using S3 storage backend");
    }
    console.log(`[STORAGE] Using S3 (bucket: ${bucket})`);
    return new CloudStorage(new S3Client(bucket));
  }

  // Explicit GCS or auto-detect via GCS credentials
  if (storageBackend === "gcs" || process.env.GCS_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      throw new Error("GCS_BUCKET environment variable is required when using GCS storage backend");
    }
    console.log(`[STORAGE] Using GCS (bucket: ${bucket})`);
    return new CloudStorage(new GcsClient(bucket));
  }

  // PRODUCTION SAFETY: Warn loudly if no persistent backend is configured
  if (process.env.NODE_ENV === "production") {
    console.error("[STORAGE] WARNING: No persistent storage backend configured in production!");
    console.error("[STORAGE] Set STORAGE_BACKEND=postgres with DATABASE_URL, or configure S3/GCS.");
    console.error("[STORAGE] Data WILL BE LOST on restart with in-memory storage.");
  }

  console.log("[STORAGE] No cloud credentials — using in-memory storage (data will not persist across restarts)");
  return new MemStorage();
}

export let storage: IStorage = createStorage();

/**
 * Optional object storage client for file operations (logo uploads, reference docs).
 * Available when S3/GCS is configured, regardless of primary storage backend.
 */
export let objectStorage: ObjectStorageClient | null = null;

// Initialize object storage from environment
(function initObjectStorage() {
  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    objectStorage = new S3Client(bucket);
    return;
  }
  const gcsBucket = process.env.GCS_BUCKET;
  if (gcsBucket && (process.env.GCS_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    objectStorage = new GcsClient(gcsBucket);
  }
})();

/**
 * Initialize PostgreSQL storage backend (called during server startup).
 * Replaces the placeholder MemStorage with a real PostgresStorage instance.
 */
export async function initPostgresStorage(): Promise<boolean> {
  if (process.env.STORAGE_BACKEND?.toLowerCase() !== "postgres") {
    return false;
  }

  try {
    const { initDatabase } = await import("../db/index");
    const { PostgresStorage } = await import("../db/pg-storage");

    const db = await initDatabase();
    if (!db) {
      console.error("[STORAGE] Failed to connect to PostgreSQL — falling back to in-memory");
      return false;
    }

    // Optional: create blob client for audio files stored in S3
    let blobClient: ObjectStorageClient | null = null;
    if (process.env.S3_BUCKET) {
      blobClient = new S3Client(process.env.S3_BUCKET);
      console.log(`[STORAGE] Audio blob storage: S3 (bucket: ${process.env.S3_BUCKET})`);
    }

    storage = new PostgresStorage(db, blobClient);
    console.log("[STORAGE] PostgreSQL storage backend initialized");
    return true;
  } catch (error) {
    console.error("[STORAGE] PostgreSQL initialization failed:", error);
    return false;
  }
}
