import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage, initPostgresStorage } from "./storage";
import { setupWebSocket } from "./services/websocket";
import { logger } from "./services/logger";
import { initRedis, checkRateLimit, closeRedis } from "./services/redis";
import { initQueues, enqueueRetention, closeQueues } from "./services/queue";

const app = express();

// --- In-memory rate limiter (fallback when Redis unavailable) ---
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function inMemoryRateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
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

function distributedRateLimit(windowMs: number, maxRequests: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisAvailable) {
      // Fall back to in-memory
      return inMemoryRateLimit(windowMs, maxRequests)(req, res, next);
    }

    const key = `${req.ip}:${req.path}`;
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
setInterval(() => {
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

// Stripe webhook needs raw body for signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// HIPAA: Security headers including Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP: restrict resource loading to same-origin and trusted CDNs
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; frame-ancestors 'none';"
  );
  // Only set no-cache on API routes — static assets need caching for performance
  if (req.path.startsWith("/api")) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
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

(async () => {
  // --- Infrastructure initialization ---

  // 1. Initialize Redis (sessions, rate limiting, pub/sub, queue backend)
  const redis = initRedis();
  redisAvailable = redis !== null;
  if (redisAvailable) {
    logger.info("Redis available — using distributed sessions, rate limiting, and job queues");
  }

  // 2. Initialize PostgreSQL storage if configured
  const pgInitialized = await initPostgresStorage();
  if (pgInitialized) {
    logger.info("PostgreSQL storage backend active");
  }

  // 3. Initialize BullMQ job queues
  const queuesReady = initQueues();
  if (queuesReady) {
    logger.info("BullMQ job queues active");
  }

  // Authentication (must come before routes) - async to hash env var passwords on startup
  await setupAuth(app);

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    if (status >= 500) {
      logger.error({ status }, message);
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

    // Run once on startup (after 30s delay to let auth settle)
    setTimeout(runRetention, 30_000);
    // Then run daily (every 24 hours)
    setInterval(runRetention, 24 * 60 * 60 * 1000);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await Promise.all([
      closeQueues(),
      closeRedis(),
    ]);
    // Close DB if PostgreSQL was initialized
    if (pgInitialized) {
      const { closeDatabase } = await import("./db/index");
      await closeDatabase();
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
