/**
 * HIPAA PHI Access Audit Logger
 *
 * Logs access to Protected Health Information (PHI) — call recordings,
 * transcripts, analysis data — for compliance and incident response.
 *
 * Audit entries are written to structured JSON log lines on stdout so they
 * can be captured by any log aggregator (CloudWatch, Stackdriver, ELK, etc.).
 */

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

import { logger } from "../logger";

export function logPhiAccess(entry: AuditEntry): void {
  logger.info({
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
    _audit: "HIPAA_PHI",
  }, `[HIPAA_AUDIT] ${entry.event}`);
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
