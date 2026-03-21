import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage, initPostgresStorage } from "./storage";
import { setupWebSocket } from "./services/websocket";
import { logger } from "./services/logger";
import { initRedis, checkRateLimit, closeRedis } from "./services/redis";
import { initQueues, enqueueRetention, closeQueues } from "./services/queue";
import { initEmail, sendEmail, buildQuotaAlertEmail } from "./services/email";
import { isPhiEncryptionEnabled } from "./services/phi-encryption";
import { wafMiddleware } from "./middleware/waf";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

const app = express();

// --- In-memory rate limiter (fallback when Redis unavailable) ---
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimitKey(req: Request, includeOrg: boolean): string {
  const orgPart = includeOrg && req.orgId ? `:org:${req.orgId}` : "";
  return `${req.ip}:${req.path}${orgPart}`;
}

function inMemoryRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = rateLimitKey(req, includeOrg);
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    return next();
  };
}

// --- Distributed rate limiter (Redis-backed when available) ---
let redisAvailable = false;

function distributedRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisAvailable) {
      // Fall back to in-memory
      return inMemoryRateLimit(windowMs, maxRequests, includeOrg)(req, res, next);
    }

    const key = rateLimitKey(req, includeOrg);
    try {
      const result = await checkRateLimit(key, windowMs, maxRequests);
      if (!result.allowed) {
        res.setHeader("Retry-After", Math.ceil(result.resetMs / 1000).toString());
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      return next();
    } catch {
      // Redis error — fall through to allow the request
      return next();
    }
  };
}

// Clean up expired in-memory rate limit entries every 5 minutes
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((entry, key) => {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  });
}, 5 * 60 * 1000);

// Trust reverse proxy (Render, Heroku, etc.) so secure cookies and
// x-forwarded-proto work correctly behind their load balancer.
if (process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE) {
  app.set("trust proxy", 1);
}

// HIPAA: Enforce HTTPS in production (redirect HTTP → HTTPS)
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https" &&
    !req.hostname.startsWith("localhost") &&
    !req.hostname.startsWith("127.0.0.1")
  ) {
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  }
  next();
});

// WAF: Application-level firewall (SQL injection, XSS, path traversal, anomaly scoring)
app.use(wafMiddleware);

// Stripe webhook needs raw body for signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// HIPAA: Security headers including Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  // CSP: restrict resource loading to same-origin and trusted CDNs
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; frame-ancestors 'none';"
  );
  // Only set no-cache on API routes — static assets need caching for performance
  if (req.path.startsWith("/api")) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// CSRF protection: double-submit cookie pattern
// State-changing API requests must include X-CSRF-Token header matching the csrf cookie
import { randomBytes } from "crypto";

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  const match = header.split(";").map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

app.use((req, res, next) => {
  // Set CSRF cookie on all responses if not already present
  if (!parseCookie(req, "csrf-token")) {
    const token = randomBytes(32).toString("hex");
    res.cookie("csrf-token", token, {
      httpOnly: false, // Must be readable by JS to send in header
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  // Skip CSRF checks for safe methods and non-API routes
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.path.startsWith("/api")) {
    return next();
  }

  // Skip CSRF for Stripe webhooks (uses its own signature verification)
  if (req.path === "/api/billing/webhook") return next();

  // Skip CSRF for API key authenticated requests (no browser session)
  if (req.headers["x-api-key"]) return next();

  // Skip CSRF for login/register/forgot-password (pre-auth, no session yet)
  const csrfExemptPaths = ["/api/auth/login", "/api/auth/register", "/api/auth/forgot-password", "/api/auth/reset-password"];
  if (csrfExemptPaths.includes(req.path)) return next();

  // Verify CSRF token
  const cookieToken = parseCookie(req, "csrf-token");
  const headerToken = req.headers["x-csrf-token"] as string | undefined;
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: "Invalid or missing CSRF token", code: "OBS-AUTH-CSRF" });
    return;
  }

  next();
});

// HIPAA: Audit logging middleware - logs all API access with user identity but never PHI
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const user = req.user;
      const userId = user ? `${user.username}(${user.role})` : "anonymous";
      const orgSlug = user?.orgSlug || "-";
      logger.info({
        type: "audit",
        org: orgSlug,
        user: userId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
      }, `${req.method} ${path} ${res.statusCode}`);
    }
  });

  next();
});

// HIPAA: Rate limiting on login endpoint (5 attempts per 15 minutes per IP)
app.post("/api/auth/login", distributedRateLimit(15 * 60 * 1000, 5) as any);
// Rate limit registration: 3 per hour per IP
app.post("/api/auth/register", distributedRateLimit(60 * 60 * 1000, 3) as any);
// Rate limit password reset: 5 per 15 minutes per IP (prevent token brute-force & enumeration)
app.post("/api/auth/forgot-password", distributedRateLimit(15 * 60 * 1000, 5) as any);
app.post("/api/auth/reset-password", distributedRateLimit(15 * 60 * 1000, 5) as any);
// HIPAA: Read rate limiting to prevent bulk data exfiltration
// Org-scoped so one tenant's usage doesn't block another on shared IPs
app.use("/api/export", distributedRateLimit(60 * 1000, 5, true) as any);
app.use("/api/calls", distributedRateLimit(60 * 1000, 60, true) as any);
app.use("/api/employees", distributedRateLimit(60 * 1000, 60, true) as any);
app.use("/api/clinical", distributedRateLimit(60 * 1000, 60, true) as any);
app.use("/api/ehr", distributedRateLimit(60 * 1000, 30, true) as any);

(async () => {
  // --- Infrastructure initialization ---

  // 1. Initialize Redis (sessions, rate limiting, pub/sub, queue backend)
  const redis = initRedis();
  redisAvailable = redis !== null;
  if (redisAvailable) {
    logger.info("Redis available — using distributed sessions, rate limiting, and job queues");
  } else if (process.env.NODE_ENV === "production") {
    logger.error(
      "REDIS_URL not configured in production. In-memory sessions will be lost on restart " +
      "and rate limiting will not work across instances. Set REDIS_URL to continue."
    );
    process.exit(1);
  }

  // 2. Initialize PostgreSQL storage if configured
  const pgInitialized = await initPostgresStorage();
  if (pgInitialized) {
    logger.info("PostgreSQL storage backend active");
  } else if (process.env.DATABASE_URL) {
    // DATABASE_URL is set but PostgreSQL failed to connect — fail fast in production
    // to prevent silent fallback to in-memory storage (which loses data on restart)
    if (process.env.NODE_ENV === "production") {
      logger.error("PostgreSQL is configured (DATABASE_URL set) but unavailable. Refusing to start in production with in-memory fallback.");
      process.exit(1);
    } else {
      logger.warn("PostgreSQL is configured (DATABASE_URL set) but unavailable. Falling back to in-memory storage for development.");
    }
  }

  // 3. Initialize BullMQ job queues
  const queuesReady = initQueues();
  if (queuesReady) {
    logger.info("BullMQ job queues active");
  }

  // 4. Initialize email transport
  initEmail();

  // 5. HIPAA: Validate PHI encryption key — warn if clinical features may store plaintext
  if (!isPhiEncryptionEnabled()) {
    logger.warn(
      "PHI_ENCRYPTION_KEY is not configured — clinical notes and PHI fields will be stored in plaintext. " +
      "Set PHI_ENCRYPTION_KEY (64 hex chars) for HIPAA-compliant PHI encryption at rest."
    );
  }

  // Authentication (must come before routes) - async to hash env var passwords on startup
  await setupAuth(app);

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (status >= 500) {
      logger.error({ status, err: message }, "Internal server error");
      res.status(status).json({ message: "Internal Server Error" });
    } else {
      res.status(status).json({ message });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // WebSocket: real-time call processing notifications
    setupWebSocket(server);

    // HIPAA: Data retention — purge calls older than configured days
    // Runs across all organizations; uses per-org retentionDays from settings (falls back to env/default 90)
    const defaultRetentionDays = parseInt(process.env.RETENTION_DAYS || "90", 10);
    const runRetention = async () => {
      try {
        const currentStorage = (await import("./storage")).storage;
        const orgs = await currentStorage.listOrganizations();
        let totalPurged = 0;
        for (const org of orgs) {
          const orgRetention = org.settings?.retentionDays ?? defaultRetentionDays;

          // Use job queue if available (non-blocking, durable)
          if (queuesReady) {
            await enqueueRetention(org.id, orgRetention);
          } else {
            // Fallback: run inline
            const purged = await currentStorage.purgeExpiredCalls(org.id, orgRetention);
            if (purged > 0) {
              logger.info({ org: org.slug, purged, retentionDays: orgRetention }, "Retention purge completed");
              totalPurged += purged;
            }
          }
        }
        if (!queuesReady && totalPurged > 0) {
          logger.info({ totalPurged }, "Retention purge complete across all orgs");
        }
      } catch (error) {
        logger.error({ err: error }, "Error during retention purge");
      }
    };

    // Trial auto-downgrade: check for expired trial subscriptions daily
    const runTrialDowngrade = async () => {
      try {
        const currentStorage = (await import("./storage")).storage;
        const orgs = await currentStorage.listOrganizations();
        const now = new Date();
        let downgraded = 0;

        for (const org of orgs) {
          const sub = await currentStorage.getSubscription(org.id);
          if (!sub) continue;

          // Downgrade expired trials
          if (sub.status === "trialing" && sub.currentPeriodEnd) {
            const trialEnd = new Date(sub.currentPeriodEnd);
            if (now > trialEnd) {
              await currentStorage.upsertSubscription(org.id, {
                orgId: org.id,
                planTier: "free",
                status: "active",
                billingInterval: "monthly",
                cancelAtPeriodEnd: false,
              });
              logger.info({ orgId: org.id, orgSlug: org.slug, previousTier: sub.planTier }, "Trial expired — downgraded to free");
              downgraded++;

              // Notify org admins about the downgrade
              try {
                const { buildTrialDowngradeEmail, sendEmail } = await import("./services/email");
                const users = await currentStorage.listUsersByOrg(org.id);
                const admins = users.filter((u: any) => u.role === "admin");
                const dashboardUrl = process.env.APP_URL || `https://${org.slug}.observatory-qa.com`;
                for (const admin of admins) {
                  if (!admin.username?.includes("@")) continue; // skip non-email usernames
                  const emailOpts = buildTrialDowngradeEmail(org.name, dashboardUrl);
                  emailOpts.to = admin.username;
                  await sendEmail(emailOpts);
                }
              } catch (emailErr) {
                logger.warn({ err: emailErr, orgId: org.id }, "Failed to send trial downgrade email");
              }
            }
          }
        }

        if (downgraded > 0) {
          logger.info({ downgraded }, "Trial auto-downgrade complete");
        }
      } catch (error) {
        logger.error({ err: error }, "Error during trial auto-downgrade");
      }
    };

    // Proactive quota alerts: email org admins when usage hits 80% or 100%
    const runQuotaAlerts = async () => {
      try {
        const currentStorage = (await import("./storage")).storage;
        const orgs = await currentStorage.listOrganizations();
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const dashboardUrl = process.env.APP_URL || "https://app.observatory-qa.com";

        for (const org of orgs) {
          const sub = await currentStorage.getSubscription(org.id);
          const tier = (sub?.planTier as PlanTier) || "free";
          const plan = PLAN_DEFINITIONS[tier];
          if (!plan) continue;

          const usage = await currentStorage.getUsageSummary(org.id, periodStart);
          const usageMap: Record<string, number> = {};
          for (const u of usage) usageMap[u.eventType] = u.totalQuantity;

          const warnings: Array<{ label: string; used: number; limit: number; pct: number }> = [];
          const check = (label: string, eventType: string, limitKey: keyof typeof plan.limits) => {
            const limit = plan.limits[limitKey] as number;
            if (limit <= 0 || limit === -1) return;
            const used = usageMap[eventType] || 0;
            const pct = Math.round((used / limit) * 100);
            if (pct >= 80) warnings.push({ label, used, limit, pct });
          };

          check("Calls", "transcription", "callsPerMonth");
          check("AI Analyses", "ai_analysis", "aiAnalysesPerMonth");

          if (warnings.length === 0) continue;

          // Get admin/manager users with email addresses
          const users = await currentStorage.listUsersByOrg(org.id);
          const recipients = users.filter(u =>
            (u.role === "admin" || u.role === "manager") && u.username?.includes("@")
          );
          if (recipients.length === 0) continue;

          const isExhausted = warnings.some(w => w.pct >= 100);
          const orgName = org.name || org.slug || "Observatory QA";
          const emailTemplate = buildQuotaAlertEmail(orgName, warnings, isExhausted, dashboardUrl);

          await Promise.allSettled(
            recipients.map(user => sendEmail({ ...emailTemplate, to: user.username }))
          );

          logger.info(
            { orgId: org.id, warnings: warnings.length, isExhausted, recipients: recipients.length },
            "Quota alert emails sent",
          );
        }
      } catch (error) {
        logger.error({ err: error }, "Error during quota alert check");
      }
    };

    // Run once on startup (after 30s delay to let auth settle)
    const retentionStartupTimer = setTimeout(() => {
      runRetention();
      runTrialDowngrade();
    }, 30_000);
    // Run quota alerts daily at a slight offset (60s after startup, then every 24h)
    const quotaAlertStartupTimer = setTimeout(runQuotaAlerts, 60_000);
    // Then run daily (every 24 hours)
    const retentionDailyTimer = setInterval(runRetention, 24 * 60 * 60 * 1000);
    const trialDowngradeTimer = setInterval(runTrialDowngrade, 24 * 60 * 60 * 1000);
    const quotaAlertDailyTimer = setInterval(runQuotaAlerts, 24 * 60 * 60 * 1000);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info("Shutting down...");
      clearInterval(rateLimitCleanupTimer);
      clearTimeout(retentionStartupTimer);
      clearTimeout(quotaAlertStartupTimer);
      clearInterval(retentionDailyTimer);
      clearInterval(trialDowngradeTimer);
      clearInterval(quotaAlertDailyTimer);
      const { closeWebSocket } = await import("./services/websocket");
      await Promise.all([
        closeQueues(),
        closeRedis(),
        closeWebSocket(),
      ]);
      // Close DB if PostgreSQL was initialized
      if (pgInitialized) {
        const { closeDatabase } = await import("./db/index");
        await closeDatabase();
      }
      // Close RAG worker pool if active
      try {
        const { closeRagWorkerPool } = await import("./services/rag-worker");
        await closeRagWorkerPool();
      } catch { /* not initialized */ }
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
})();
