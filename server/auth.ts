import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { logPhiAccess } from "./services/audit-log";
import { storage } from "./storage";
import { createRedisSessionStore } from "./services/redis";
import { logger } from "./services/logger";

const scryptAsync = promisify(scrypt);

// HIPAA: Login attempt tracking for account lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>();

// Prune expired lockout entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of Array.from(loginAttempts)) {
    // Remove entries whose lockout has expired, or that are stale (no activity for 2x lockout window)
    const expiry = record.lockedUntil || (record.lastAttempt + LOCKOUT_DURATION_MS * 2);
    if (now > expiry) loginAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref();

function isAccountLocked(username: string): boolean {
  const record = loginAttempts.get(username);
  if (!record?.lockedUntil) return false;
  if (Date.now() > record.lockedUntil) {
    // Lockout expired — reset
    loginAttempts.delete(username);
    return false;
  }
  return true;
}

function recordFailedAttempt(username: string): void {
  const record = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn({ username, failedAttempts: record.count }, "Account locked after excessive failed attempts");
  }
  loginAttempts.set(username, record);
}

function clearFailedAttempts(username: string): void {
  loginAttempts.delete(username);
}

/**
 * Users are defined via the AUTH_USERS environment variable.
 * Format: username:password:role:displayName:orgSlug (comma-separated for multiple users)
 * The orgSlug field maps to an organization's slug. If omitted, defaults to DEFAULT_ORG_SLUG env var or "default".
 * Example: admin:SecurePass123!:admin:Admin User:ums,viewer:ViewerPass456:viewer:Jane Doe:ums
 */

interface EnvUser {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  orgSlug: string;
  orgId?: string; // Resolved at runtime from orgSlug → org record
}

// In-memory store of hashed user credentials parsed from env vars
const envUsers: EnvUser[] = [];

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashedPassword, salt] = stored.split(".");
  const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
  const suppliedPasswordBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
}

async function loadUsersFromEnv(): Promise<void> {
  const authUsersRaw = process.env.AUTH_USERS;
  if (!authUsersRaw) {
    logger.warn("AUTH_USERS not set. No users will be able to log in.");
    return;
  }

  const defaultOrgSlug = process.env.DEFAULT_ORG_SLUG || "default";
  const userEntries = authUsersRaw.split(",").map((s) => s.trim()).filter(Boolean);

  for (const entry of userEntries) {
    const parts = entry.split(":");
    if (parts.length < 2) {
      logger.warn({ entry }, "Skipping malformed AUTH_USERS entry");
      continue;
    }

    // Format: username:password:role:displayName:orgSlug
    const [username, password, role = "viewer", displayName, orgSlug] = parts;
    const name = displayName || username;
    const userOrgSlug = orgSlug || defaultOrgSlug;

    const passwordHash = await hashPassword(password);
    envUsers.push({
      id: randomBytes(8).toString("hex"),
      username,
      passwordHash,
      name,
      role,
      orgSlug: userOrgSlug,
    });

    logger.info({ username, role, orgSlug: userOrgSlug }, "Loaded user from AUTH_USERS");
  }
}

/**
 * Resolve orgSlug → orgId for all loaded env users.
 * Called after storage is initialized so we can look up org records.
 * If an org doesn't exist yet, it will be auto-created (for backward compat).
 */
async function resolveUserOrgIds(): Promise<void> {
  const resolvedSlugs = new Map<string, string>(); // slug → orgId cache

  for (const user of envUsers) {
    if (resolvedSlugs.has(user.orgSlug)) {
      user.orgId = resolvedSlugs.get(user.orgSlug);
      continue;
    }

    let org = await storage.getOrganizationBySlug(user.orgSlug);
    if (!org) {
      // Auto-create org for backward compatibility (single-tenant migration)
      logger.info({ orgSlug: user.orgSlug }, "Auto-creating organization for slug");
      org = await storage.createOrganization({
        name: user.orgSlug === "default" ? "Default Organization" : user.orgSlug,
        slug: user.orgSlug,
        status: "active",
      });
    }

    user.orgId = org.id;
    resolvedSlugs.set(user.orgSlug, org.id);
    logger.info({ orgSlug: user.orgSlug, orgId: org.id }, "Resolved org slug to orgId");
  }
}

// Extend Express types for session user
declare global {
  namespace Express {
    interface User {
      id: string;
      username: string;
      name: string;
      role: string;
      orgId: string;
      orgSlug: string;
    }
    interface Request {
      /** Organization ID extracted from authenticated user session */
      orgId?: string;
    }
  }
}

// Exposed so WebSocket upgrade handler can verify sessions (HIPAA requirement)
export let sessionMiddleware: RequestHandler;

export async function setupAuth(app: Express) {
  // Load users from environment variables on startup
  await loadUsersFromEnv();
  // Resolve org slugs to org IDs (auto-creates orgs if needed)
  await resolveUserOrgIds();

  // HIPAA: Session configuration with proper memory store and idle timeout
  const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
  if (!process.env.SESSION_SECRET) {
    const msg = "SESSION_SECRET not set - using random secret (sessions will not persist across restarts)";
    if (process.env.NODE_ENV === "production") {
      logger.error(msg + " — THIS IS A SECURITY RISK IN PRODUCTION. Set SESSION_SECRET env var.");
    } else {
      logger.warn(msg);
    }
  }

  // HIPAA: 15-minute idle timeout (addressable requirement, standard in healthcare)
  const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  // Prefer Redis session store (distributed, survives restarts)
  // Falls back to MemoryStore if Redis unavailable
  const redisStore = createRedisSessionStore(session);
  let sessionStore: session.Store;
  if (redisStore) {
    sessionStore = redisStore;
    logger.info("Using Redis session store (distributed, persistent)");
  } else {
    const MemoryStore = createMemoryStore(session);
    sessionStore = new MemoryStore({ checkPeriod: 60 * 1000 });
    logger.info("Using in-memory session store (non-persistent)");
  }

  sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE,
      httpOnly: true,
      maxAge: SESSION_IDLE_TIMEOUT_MS,
      sameSite: "lax",
    },
    // HIPAA: rolling=true resets cookie expiry on each request (acts as idle timeout).
    // maxAge=15min means session expires after 15 minutes of inactivity.
    rolling: true,
  });
  app.use(sessionMiddleware);

  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy: authenticate against env-var-defined users AND database users
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // HIPAA: Check account lockout before attempting authentication
        if (isAccountLocked(username)) {
          logPhiAccess({

            event: "login_locked",
            username,
            resourceType: "auth",
            detail: "Account locked due to excessive failed attempts",
          });
          return done(null, false, { message: "Account temporarily locked. Try again later." });
        }

        // 1. Check env-var users first (backward compatibility)
        const envUser = envUsers.find((u) => u.username === username);
        if (envUser) {
          const isValid = await comparePasswords(password, envUser.passwordHash);
          if (!isValid) {
            recordFailedAttempt(username);
            logPhiAccess({ event: "login_failed", username, resourceType: "auth" });
            return done(null, false, { message: "Invalid username or password" });
          }
          // Check if org enforces SSO login
          if (envUser.orgId) {
            const envUserOrg = await storage.getOrganization(envUser.orgId);
            if (envUserOrg?.settings?.ssoEnforced) {
              return done(null, false, { message: "This organization requires SSO login." });
            }
          }

          clearFailedAttempts(username);
          logPhiAccess({
            event: "login_success",
            orgId: envUser.orgId,
            userId: envUser.id,
            username: envUser.username,
            role: envUser.role,
            resourceType: "auth",
            detail: `org: ${envUser.orgSlug}`,
          });
          return done(null, {
            id: envUser.id,
            username: envUser.username,
            name: envUser.name,
            role: envUser.role,
            orgId: envUser.orgId!,
            orgSlug: envUser.orgSlug,
          });
        }

        // 2. Check database users (created via admin UI or self-registration)
        const dbUser = await storage.getUserByUsername(username);
        if (!dbUser) {
          recordFailedAttempt(username);
          logPhiAccess({ event: "login_failed", username, resourceType: "auth" });
          return done(null, false, { message: "Invalid username or password" });
        }

        const isValid = await comparePasswords(password, dbUser.passwordHash);
        if (!isValid) {
          recordFailedAttempt(username);
          logPhiAccess({ event: "login_failed", username, resourceType: "auth" });
          return done(null, false, { message: "Invalid username or password" });
        }

        // Resolve org slug for DB user
        const org = await storage.getOrganization(dbUser.orgId);
        const orgSlug = org?.slug || "default";

        // Check if org enforces SSO login
        if (org?.settings?.ssoEnforced) {
          return done(null, false, { message: "This organization requires SSO login." });
        }

        clearFailedAttempts(username);
        logPhiAccess({
          event: "login_success",
          orgId: dbUser.orgId,
          userId: dbUser.id,
          username: dbUser.username,
          role: dbUser.role,
          resourceType: "auth",
          detail: `org: ${orgSlug} (db user)`,
        });
        return done(null, {
          id: dbUser.id,
          username: dbUser.username,
          name: dbUser.name,
          role: dbUser.role,
          orgId: dbUser.orgId,
          orgSlug,
        });
      } catch (err) {
        return done(err);
      }
    })
  );

  // Serialize user ID into session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session (check env users first, then DB)
  passport.deserializeUser(async (id: string, done) => {
    // Check env users
    const envUser = envUsers.find((u) => u.id === id);
    if (envUser) {
      return done(null, {
        id: envUser.id,
        username: envUser.username,
        name: envUser.name,
        role: envUser.role,
        orgId: envUser.orgId!,
        orgSlug: envUser.orgSlug,
      });
    }

    // Check database users
    try {
      const dbUser = await storage.getUser(id);
      if (!dbUser) {
        return done(null, false);
      }
      const org = await storage.getOrganization(dbUser.orgId);
      done(null, {
        id: dbUser.id,
        username: dbUser.username,
        name: dbUser.name,
        role: dbUser.role,
        orgId: dbUser.orgId,
        orgSlug: org?.slug || "default",
      });
    } catch {
      done(null, false);
    }
  });
}

// Middleware to require authentication on API routes
export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required", errorCode: "OBS-AUTH-003" });
};

// HIPAA: Role-based access control middleware
// Roles hierarchy: admin > manager > viewer
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  manager: 2,
  viewer: 1,
};

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const userRole = req.user.role || "viewer";
    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] ?? 0));
    if (userLevel >= requiredLevel) {
      return next();
    }
    return res.status(403).json({ message: "Insufficient permissions", errorCode: "OBS-AUTH-004" });
  };
}

/**
 * Middleware that extracts orgId from the authenticated user's session
 * and sets it on req.orgId for use by route handlers.
 * Must be used AFTER requireAuth.
 */
/**
 * Look up a loaded env user by their session ID and return their orgId.
 * Used by WebSocket upgrade handler to resolve org context from session.
 */
export async function resolveUserOrgId(userId: string): Promise<string | undefined> {
  const envUser = envUsers.find((u) => u.id === userId);
  if (envUser?.orgId) return envUser.orgId;
  // Fall back to database users (created via registration/invitation/admin)
  try {
    const dbUser = await storage.getUser(userId);
    return dbUser?.orgId;
  } catch {
    return undefined;
  }
}

export const injectOrgContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.orgId) {
    return res.status(401).json({ message: "No organization context in session" });
  }
  req.orgId = req.user.orgId;
  next();
};
