# Database Migrations

This directory contains Drizzle Kit migration files for the Observatory QA PostgreSQL schema.

## Workflow

### After changing `server/db/schema.ts`:

1. **Generate a migration** from your schema changes:

   ```bash
   npm run db:generate
   ```

   This compares the current schema definition against the last snapshot and produces a new SQL migration file in this directory.

2. **Review the generated SQL** in `drizzle/XXXX_<name>.sql` before applying.

3. **Apply pending migrations** to your database:

   ```bash
   npm run db:migrate
   ```

   This runs all unapplied migrations in order. Requires `DATABASE_URL` in your `.env`.

### Other commands

- `npm run db:push` — Push schema directly (dev only, no migration file generated)
- `npm run db:studio` — Open Drizzle Studio (visual DB explorer)

## How migrations coexist with sync-schema.ts

The project has two schema management mechanisms:

- **Drizzle migrations** (`drizzle/` directory) — the recommended approach for production PostgreSQL databases. Migrations are versioned, reviewable SQL files that run exactly once.

- **sync-schema.ts** (`server/db/sync-schema.ts`) — an idempotent DDL fallback that runs on every server startup. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS` to bring the database in line with the schema.

**They are mutually exclusive at runtime.** When `sync-schema.ts` detects that Drizzle migrations have been applied (by checking for the `drizzle.__drizzle_migrations` table), it skips all DDL and returns early. This means:

- **New production deployments**: Run `npm run db:migrate` once. After that, `sync-schema.ts` becomes a no-op on startup.
- **Development without migrations**: If you never run `db:migrate`, `sync-schema.ts` continues to manage the schema on startup as before.
- **Existing databases**: Running `db:migrate` for the first time applies the initial migration. Since the SQL uses `IF NOT EXISTS`, it is safe to run against a database that was previously managed by `sync-schema.ts`.

## Migration files

| File | Description |
|------|-------------|
| `0000_initial_schema.sql` | All core tables (organizations, users, employees, calls, transcripts, analyses, etc.) |
| `0001_add_document_chunks_pgvector.sql` | pgvector extension + document_chunks table for RAG |
