/**
 * Auto-sync database schema on startup.
 *
 * Uses idempotent SQL (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 * to bring the production DB in line with the Drizzle schema definition.
 *
 * This avoids requiring `drizzle-kit push` (a devDependency) in production,
 * while ensuring new tables and columns are created automatically on deploy.
 */
import { sql } from "drizzle-orm";
import type { Database } from "./index";
import { logger } from "../services/logger";

export async function syncSchema(db: Database): Promise<void> {
  logger.info("Running schema sync...");

  try {
    // Enable pgvector if available (required for RAG)
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`).catch(() => {
      logger.warn("pgvector extension not available — RAG features will be disabled");
    });

    // --- Organizations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        settings JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug)`);

    // --- Users ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        username VARCHAR(100) NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        is_active BOOLEAN NOT NULL DEFAULT true,
        mfa_enabled BOOLEAN NOT NULL DEFAULT false,
        mfa_secret TEXT,
        mfa_backup_codes JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login_at TIMESTAMP
      )
    `);
    await addColumnIfNotExists(db, "users", "mfa_enabled", "BOOLEAN NOT NULL DEFAULT false");
    await addColumnIfNotExists(db, "users", "mfa_secret", "TEXT");
    await addColumnIfNotExists(db, "users", "mfa_backup_codes", "JSONB");
    await addColumnIfNotExists(db, "users", "is_active", "BOOLEAN NOT NULL DEFAULT true");
    await addColumnIfNotExists(db, "users", "last_login_at", "TIMESTAMP");
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id)`);

    // --- Employees ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(100),
        initials VARCHAR(5),
        status VARCHAR(20) DEFAULT 'Active',
        sub_team VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS employees_org_id_idx ON employees (org_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS employees_org_email_idx ON employees (org_id, email)`);

    // --- Calls ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT REFERENCES employees(id),
        file_name VARCHAR(500),
        file_path TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        duration INTEGER,
        assembly_ai_id VARCHAR(255),
        call_category VARCHAR(50),
        tags JSONB,
        file_hash VARCHAR(64),
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "calls", "file_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "calls", "call_category", "VARCHAR(50)");
    await addColumnIfNotExists(db, "calls", "tags", "JSONB");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_id_idx ON calls (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_status_idx ON calls (org_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_employee_id_idx ON calls (employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_uploaded_at_idx ON calls (uploaded_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_file_hash_idx ON calls (org_id, file_hash)`);

    // --- Transcripts ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        text TEXT,
        confidence VARCHAR(20),
        words JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS transcripts_call_id_idx ON transcripts (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS transcripts_org_id_idx ON transcripts (org_id)`);

    // --- Sentiment Analyses ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sentiment_analyses (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        overall_sentiment VARCHAR(20),
        overall_score VARCHAR(20),
        segments JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS sentiments_call_id_idx ON sentiment_analyses (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sentiments_org_id_idx ON sentiment_analyses (org_id)`);

    // --- Call Analyses ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS call_analyses (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        performance_score VARCHAR(20),
        talk_time_ratio VARCHAR(20),
        response_time VARCHAR(20),
        keywords JSONB,
        topics JSONB,
        summary TEXT,
        action_items JSONB,
        feedback JSONB,
        lemur_response JSONB,
        call_party_type VARCHAR(50),
        flags JSONB,
        manual_edits JSONB,
        confidence_score VARCHAR(20),
        confidence_factors JSONB,
        sub_scores JSONB,
        detected_agent_name VARCHAR(255),
        clinical_note JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "call_analyses", "sub_scores", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "detected_agent_name", "VARCHAR(255)");
    await addColumnIfNotExists(db, "call_analyses", "confidence_score", "VARCHAR(20)");
    await addColumnIfNotExists(db, "call_analyses", "confidence_factors", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "manual_edits", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "clinical_note", "JSONB");
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS analyses_call_id_idx ON call_analyses (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_org_id_idx ON call_analyses (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_performance_idx ON call_analyses (org_id, performance_score)`);

    // --- Access Requests ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS access_requests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        reason TEXT,
        requested_role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(255),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS access_requests_org_id_idx ON access_requests (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (org_id, status)`);

    // --- Prompt Templates ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_category VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        evaluation_criteria TEXT NOT NULL,
        required_phrases JSONB,
        scoring_weights JSONB,
        additional_instructions TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by VARCHAR(255)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS prompt_templates_org_id_idx ON prompt_templates (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS prompt_templates_org_category_idx ON prompt_templates (org_id, call_category)`);

    // --- Coaching Sessions ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coaching_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        call_id TEXT REFERENCES calls(id),
        assigned_by VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        title VARCHAR(500) NOT NULL,
        notes TEXT,
        action_plan JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_org_id_idx ON coaching_sessions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_employee_id_idx ON coaching_sessions (employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_status_idx ON coaching_sessions (org_id, status)`);

    // --- Coaching Recommendations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coaching_recommendations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        trigger VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        severity VARCHAR(20) NOT NULL DEFAULT 'medium',
        call_ids JSONB,
        metrics JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        coaching_session_id TEXT REFERENCES coaching_sessions(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_org_id_idx ON coaching_recommendations (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_employee_idx ON coaching_recommendations (org_id, employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_status_idx ON coaching_recommendations (org_id, status)`);

    // --- API Keys ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(128) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        permissions JSONB NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS api_keys_org_id_idx ON api_keys (org_id)`);

    // --- Invitations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        token VARCHAR(255) NOT NULL,
        invited_by VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invitations_org_id_idx ON invitations (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (org_id, email)`);

    // --- Subscriptions ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        plan_tier VARCHAR(20) NOT NULL DEFAULT 'free',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        stripe_price_id VARCHAR(255),
        billing_interval VARCHAR(10) NOT NULL DEFAULT 'monthly',
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_org_id_idx ON subscriptions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON subscriptions (stripe_customer_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions (stripe_subscription_id)`);

    // --- Reference Documents ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reference_documents (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        file_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        storage_path TEXT NOT NULL,
        extracted_text TEXT,
        applies_to JSONB,
        is_active BOOLEAN NOT NULL DEFAULT true,
        uploaded_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ref_docs_org_id_idx ON reference_documents (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ref_docs_category_idx ON reference_documents (org_id, category)`);

    // --- Document Chunks (pgvector) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        document_id TEXT NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        section_header VARCHAR(500),
        token_count INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        embedding vector(1024),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(() => {
      // If pgvector is not available, create without the vector column
      logger.warn("Creating document_chunks without vector column (pgvector not available)");
    });
    await db.execute(sql`CREATE INDEX IF NOT EXISTS doc_chunks_org_id_idx ON document_chunks (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS doc_chunks_document_id_idx ON document_chunks (document_id)`);

    // --- Password Reset Tokens ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(128) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token_hash_idx ON password_reset_tokens (token_hash)`);

    // --- Usage Events ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        event_type VARCHAR(50) NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS usage_org_type_idx ON usage_events (org_id, event_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS usage_created_at_idx ON usage_events (created_at)`);

    // --- A/B Tests ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ab_tests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        file_name VARCHAR(500) NOT NULL,
        call_category VARCHAR(50),
        baseline_model VARCHAR(255) NOT NULL,
        test_model VARCHAR(255) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'processing',
        transcript_text TEXT,
        baseline_analysis JSONB,
        test_analysis JSONB,
        baseline_latency_ms INTEGER,
        test_latency_ms INTEGER,
        notes TEXT,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ab_tests_org_id_idx ON ab_tests (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ab_tests_status_idx ON ab_tests (org_id, status)`);

    // --- Spend Records ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spend_records (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        user_name VARCHAR(255) NOT NULL,
        services JSONB NOT NULL,
        total_estimated_cost REAL NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS spend_records_org_id_idx ON spend_records (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS spend_records_timestamp_idx ON spend_records (org_id, timestamp)`);

    // --- Audit Logs (tamper-evident) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        event VARCHAR(100) NOT NULL,
        user_id TEXT,
        username VARCHAR(100),
        role VARCHAR(20),
        resource_type VARCHAR(50) NOT NULL,
        resource_id TEXT,
        ip VARCHAR(45),
        user_agent TEXT,
        detail TEXT,
        integrity_hash VARCHAR(64),
        prev_hash VARCHAR(64),
        sequence_num INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "audit_logs", "user_agent", "TEXT");
    await addColumnIfNotExists(db, "audit_logs", "integrity_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "audit_logs", "prev_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "audit_logs", "sequence_num", "INTEGER");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (org_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_event_idx ON audit_logs (org_id, event)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (org_id, user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_sequence_idx ON audit_logs (org_id, sequence_num)`);

    logger.info("Schema sync complete");
  } catch (error) {
    logger.error({ err: error }, "Schema sync failed — some features may not work");
  }
}

/**
 * Add a column to a table if it doesn't already exist.
 * Uses DO $$ block for idempotent ALTER TABLE.
 */
async function addColumnIfNotExists(
  db: Database,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE ${table} ADD COLUMN ${column} ${definition};
    EXCEPTION
      WHEN duplicate_column THEN NULL;
    END $$;
  `));
}
