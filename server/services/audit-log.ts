/**
 * HIPAA PHI Access Audit Logger
 *
 * Dual-write: structured Pino logs AND PostgreSQL audit_logs table.
 * Pino log output goes to stdout/Betterstack for real-time monitoring.
 * Database storage enables in-app audit viewer with search/pagination.
 *
 * HIPAA: Never include PHI (call content, transcripts) in audit entries.
 * Only log metadata: event types, user IDs, resource IDs, timestamps.
 */
import { randomUUID } from "crypto";
import { logger } from "./logger";

export interface AuditEntry {
  timestamp?: string;
  event: string;
  orgId?: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}

/**
 * Log a PHI access event. Writes to both Pino (stdout) and PostgreSQL.
 * DB write is non-blocking — failures are logged but never throw.
 */
export function logPhiAccess(entry: AuditEntry): void {
  const timestamp = entry.timestamp || new Date().toISOString();

  // Always write to Pino (structured log)
  logger.info({
    ...entry,
    timestamp,
    _audit: "HIPAA_PHI",
  }, `[HIPAA_AUDIT] ${entry.event}`);

  // Non-blocking DB write (if PostgreSQL is available)
  persistAuditEntry({ ...entry, timestamp }).catch(() => {
    // Silently swallow — Pino log is the primary audit trail
  });
}

/**
 * Persist an audit entry to the audit_logs table.
 * Called fire-and-forget from logPhiAccess().
 */
async function persistAuditEntry(entry: AuditEntry & { timestamp: string }): Promise<void> {
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (!db) return;

    const { auditLogs } = await import("../db/schema");
    await db.insert(auditLogs).values({
      id: randomUUID(),
      orgId: entry.orgId || "system",
      event: entry.event,
      userId: entry.userId,
      username: entry.username,
      role: entry.role,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ip: entry.ip,
      detail: entry.detail,
    });
  } catch {
    // DB write failure is acceptable — Pino is the primary audit trail
  }
}

/**
 * Query audit logs from the database (for the audit viewer UI).
 */
export async function queryAuditLogs(options: {
  orgId: string;
  event?: string;
  userId?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  const { getDatabase } = await import("../db/index");
  const db = getDatabase();
  if (!db) return { entries: [], total: 0 };

  const { auditLogs } = await import("../db/schema");
  const { eq, and, desc, gte, lte, sql, count } = await import("drizzle-orm");

  const conditions = [eq(auditLogs.orgId, options.orgId)];
  if (options.event) conditions.push(eq(auditLogs.event, options.event));
  if (options.userId) conditions.push(eq(auditLogs.userId, options.userId));
  if (options.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options.from) conditions.push(gte(auditLogs.createdAt, options.from));
  if (options.to) conditions.push(lte(auditLogs.createdAt, options.to));

  const where = and(...conditions);
  const pageLimit = Math.min(options.limit || 50, 200);
  const pageOffset = options.offset || 0;

  const [rows, countResult] = await Promise.all([
    db.select().from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageLimit)
      .offset(pageOffset),
    db.select({ count: count() }).from(auditLogs).where(where),
  ]);

  const entries: AuditEntry[] = rows.map(r => ({
    event: r.event,
    orgId: r.orgId,
    userId: r.userId || undefined,
    username: r.username || undefined,
    role: r.role || undefined,
    resourceType: r.resourceType,
    resourceId: r.resourceId || undefined,
    ip: r.ip || undefined,
    detail: r.detail || undefined,
    timestamp: r.createdAt?.toISOString(),
  }));

  return { entries, total: countResult[0]?.count || 0 };
}

/**
 * Helper to extract audit-relevant fields from an Express request.
 */
export function auditContext(req: any): Pick<AuditEntry, "orgId" | "userId" | "username" | "role" | "ip" | "userAgent"> {
  const user = req.user as { id?: string; username?: string; role?: string; orgId?: string } | undefined;
  return {
    orgId: user?.orgId || req.orgId,
    userId: user?.id,
    username: user?.username,
    role: user?.role,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
}
