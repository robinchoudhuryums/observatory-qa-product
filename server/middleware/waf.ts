/**
 * Application-level Web Application Firewall (WAF)
 *
 * Detects and blocks common attack patterns:
 * - SQL injection attempts
 * - XSS (cross-site scripting) payloads
 * - Path traversal attacks
 * - Suspicious bot/scanner user agents
 * - IP-based blocking with anomaly scoring
 *
 * Multi-tenant aware: tracks anomalies per-IP across all orgs.
 * This is a defense-in-depth layer — not a replacement for AWS WAF at the edge.
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

// --- Configuration ---
const ANOMALY_THRESHOLD = 10;       // Block IP after this many violation points
const ANOMALY_DECAY_MS = 15 * 60 * 1000; // Reset anomaly score after 15 minutes of inactivity
const MAX_TRACKED_IPS = 10_000;     // Prevent unbounded memory growth

// --- Attack pattern regexes ---
const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|create|exec|execute)\b.*\b(from|into|table|database|where|set)\b)/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,        // OR 1=1 / AND 1=1
  /(--|#|\/\*)\s/,                            // SQL comments
  /;\s*(drop|delete|update|insert|alter)\b/i, // Chained destructive statements
  /\b(char|nchar|varchar|nvarchar)\s*\(/i,    // CHAR() obfuscation
  /\b(waitfor\s+delay|benchmark\s*\(|sleep\s*\()/i, // Time-based injection
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(error|load|click|mouseover|focus|blur)\s*=/i,
  /\beval\s*\(/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /document\.(cookie|location|write)/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,                    // ../
  /\.\.\\/, // ..\
  /%2e%2e[%2f\\]/i,           // URL-encoded
  /\/(etc\/passwd|proc\/self|windows\/system32)/i,
];

const SUSPICIOUS_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /dirbuster/i,
  /gobuster/i,
  /wpscan/i,
  /burpsuite/i,
  /havij/i,
  /acunetix/i,
  /nessus/i,
  /openvas/i,
];

// --- Anomaly tracking ---
interface AnomalyRecord {
  score: number;
  lastSeen: number;
  blocked: boolean;
}

const anomalyMap = new Map<string, AnomalyRecord>();
const manualBlocklist = new Set<string>();

// Prune stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of Array.from(anomalyMap)) {
    if (now - record.lastSeen > ANOMALY_DECAY_MS) {
      anomalyMap.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

function addAnomalyPoints(ip: string, points: number, reason: string): boolean {
  // Enforce max tracked IPs
  if (!anomalyMap.has(ip) && anomalyMap.size >= MAX_TRACKED_IPS) return false;

  const record = anomalyMap.get(ip) || { score: 0, lastSeen: 0, blocked: false };
  const now = Date.now();

  // Decay score if quiet for a while
  if (now - record.lastSeen > ANOMALY_DECAY_MS) {
    record.score = 0;
    record.blocked = false;
  }

  record.score += points;
  record.lastSeen = now;

  if (record.score >= ANOMALY_THRESHOLD) {
    record.blocked = true;
    logger.warn({ ip, score: record.score, reason }, "WAF: IP blocked (anomaly threshold exceeded)");
  }

  anomalyMap.set(ip, record);
  return record.blocked;
}

function isBlocked(ip: string): boolean {
  if (manualBlocklist.has(ip)) return true;
  const record = anomalyMap.get(ip);
  if (!record) return false;
  // Auto-unblock after decay window
  if (Date.now() - record.lastSeen > ANOMALY_DECAY_MS) {
    record.blocked = false;
    record.score = 0;
    return false;
  }
  return record.blocked;
}

function checkPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(value));
}

/**
 * Scan request for attack patterns.
 * Returns a violation reason string or null if clean.
 */
function scanRequest(req: Request): { reason: string; points: number } | null {
  const url = decodeURIComponent(req.originalUrl || req.url);
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const query = JSON.stringify(req.query || {});

  // Skip regex scanning on large payloads to prevent ReDoS (legitimate uploads are large)
  const MAX_SCAN_LENGTH = 100_000; // 100KB
  const combined = `${url} ${query} ${body}`.slice(0, MAX_SCAN_LENGTH);

  // Path traversal (high severity)
  if (checkPatterns(url, PATH_TRAVERSAL_PATTERNS)) {
    return { reason: "path_traversal", points: 5 };
  }

  // SQL injection
  if (checkPatterns(combined, SQL_INJECTION_PATTERNS)) {
    return { reason: "sql_injection", points: 3 };
  }

  // XSS
  if (checkPatterns(combined, XSS_PATTERNS)) {
    return { reason: "xss", points: 3 };
  }

  // Suspicious user agent
  const ua = req.headers["user-agent"] || "";
  if (checkPatterns(ua, SUSPICIOUS_USER_AGENTS)) {
    return { reason: "suspicious_user_agent", points: 5 };
  }

  return null;
}

// --- Express middleware ---

export function wafMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  // Check blocklist first
  if (isBlocked(ip)) {
    res.status(403).json({ message: "Access denied" });
    return;
  }

  // Skip scanning for health checks and static assets
  if (req.path === "/api/health" || !req.path.startsWith("/api")) {
    next();
    return;
  }

  const violation = scanRequest(req);
  if (violation) {
    const blocked = addAnomalyPoints(ip, violation.points, violation.reason);

    logger.warn({
      ip,
      method: req.method,
      path: req.path,
      reason: violation.reason,
      points: violation.points,
      blocked,
    }, `WAF: Detected ${violation.reason}`);

    if (blocked) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    // Under threshold: allow but log. Some legitimate requests may trigger
    // false positives (e.g., pasting code snippets in coaching notes).
  }

  next();
}

// --- Admin API helpers ---

export function blockIp(ip: string): void {
  manualBlocklist.add(ip);
  logger.info({ ip }, "WAF: IP manually blocked");
}

export function unblockIp(ip: string): void {
  manualBlocklist.delete(ip);
  anomalyMap.delete(ip);
  logger.info({ ip }, "WAF: IP manually unblocked");
}

export function getWafStats(): {
  blockedIps: string[];
  manualBlocklist: string[];
  trackedIps: number;
  recentViolations: number;
} {
  const blockedIps: string[] = [];
  let recentViolations = 0;
  const now = Date.now();

  for (const [ip, record] of Array.from(anomalyMap)) {
    if (record.blocked) blockedIps.push(ip);
    if (now - record.lastSeen < 60 * 60 * 1000) recentViolations++;
  }

  return {
    blockedIps,
    manualBlocklist: Array.from(manualBlocklist),
    trackedIps: anomalyMap.size,
    recentViolations,
  };
}
