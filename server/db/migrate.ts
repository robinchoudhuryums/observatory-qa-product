/**
 * Run database migrations.
 *
 * Usage: npx tsx server/db/migrate.ts
 *    or: npm run db:migrate
 *
 * This applies all pending Drizzle migrations to the configured PostgreSQL database.
 * Run `npm run db:generate` first to create migration SQL files from schema changes.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    console.error("Set it in your .env file or export it before running migrations.");
    process.exit(1);
  }

  let pool: pg.Pool | null = null;

  try {
    console.log("Connecting to database...");
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 10000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });

    // Verify connectivity before running migrations
    const client = await pool.connect();
    client.release();
    console.log("Database connection established.");

    const db = drizzle(pool);

    console.log("Running pending migrations from ./drizzle ...");
    await migrate(db, { migrationsFolder: "./drizzle" });

    console.log("All migrations applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log("Database connection closed.");
    }
  }
}

main();
