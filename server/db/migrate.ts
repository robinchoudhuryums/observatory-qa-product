/**
 * Run database migrations.
 *
 * Usage: npx tsx server/db/migrate.ts
 *
 * This applies all pending Drizzle migrations to the configured PostgreSQL database.
 * Run `npx drizzle-kit generate` first to create migration SQL files from schema changes.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log("Connecting to database...");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
