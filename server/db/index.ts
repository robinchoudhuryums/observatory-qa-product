/**
 * Database connection management.
 *
 * Connects to PostgreSQL via DATABASE_URL env var.
 * Falls back gracefully when not configured (existing S3/memory backends still work).
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { logger } from "../services/logger";

export type Database = NodePgDatabase<typeof schema>;

let db: Database | null = null;
let pool: pg.Pool | null = null;

export function getDatabase(): Database | null {
  return db;
}

export async function initDatabase(): Promise<Database | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — PostgreSQL storage backend unavailable");
    return null;
  }

  try {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // HIPAA: Force SSL in production
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });

    // Verify the connection
    const client = await pool.connect();
    client.release();

    db = drizzle(pool, { schema });
    logger.info("PostgreSQL database connected");
    return db;
  } catch (error) {
    logger.error({ err: error }, "Failed to connect to PostgreSQL");
    return null;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info("PostgreSQL connection pool closed");
  }
}
