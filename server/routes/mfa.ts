/**
 * MFA (Multi-Factor Authentication) routes — TOTP-based.
 *
 * HIPAA: MFA is a strongly recommended safeguard under the Security Rule.
 * This implementation uses TOTP (RFC 6238) with backup recovery codes.
 *
 * Endpoints:
 *   POST /api/auth/mfa/setup      — Generate TOTP secret + QR code
 *   POST /api/auth/mfa/enable      — Verify TOTP code & activate MFA
 *   POST /api/auth/mfa/verify      — Verify TOTP during login (MFA challenge)
 *   POST /api/auth/mfa/disable     — Disable MFA (requires current TOTP code)
 *   POST /api/auth/mfa/backup      — Use a backup code during login
 */
import type { Express } from "express";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import * as QRCode from "qrcode";
import { randomBytes, createHash } from "crypto";
import { requireAuth, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { encryptMfaSecret, decryptMfaSecret } from "../services/phi-encryption";
import { logger } from "../services/logger";

// Rate limit MFA verification attempts (per session)
const mfaAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;

function isMfaLocked(sessionId: string): boolean {
  const record = mfaAttempts.get(sessionId);
  if (!record || record.count < MFA_MAX_ATTEMPTS) return false;
  if (Date.now() - record.lastAttempt > MFA_LOCKOUT_MS) {
    mfaAttempts.delete(sessionId);
    return false;
  }
  return true;
}

function recordMfaAttempt(sessionId: string): void {
  const record = mfaAttempts.get(sessionId) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  mfaAttempts.set(sessionId, record);
}

function clearMfaAttempts(sessionId: string): void {
  mfaAttempts.delete(sessionId);
}

// Prune stale MFA attempt records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of Array.from(mfaAttempts)) {
    if (now - record.lastAttempt > MFA_LOCKOUT_MS * 2) mfaAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Generate N random backup codes (8-char alphanumeric).
 * Returns { plain: string[], hashed: string[] }.
 */
function generateBackupCodes(count = 10): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString("hex"); // 8 hex chars
    plain.push(code);
    hashed.push(createHash("sha256").update(code).digest("hex"));
  }
  return { plain, hashed };
}

function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase().trim()).digest("hex");
}

export function registerMfaRoutes(app: Express): void {
  // ==================== MFA SETUP ====================
  // Step 1: Generate a TOTP secret and QR code URL (does NOT enable MFA yet)
  app.post("/api/auth/mfa/setup", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.mfaEnabled) {
        return res.status(400).json({ message: "MFA is already enabled. Disable it first to reconfigure." });
      }

      // Generate TOTP secret
      const secret = generateSecret();

      // Store encrypted secret (not yet enabled — user must verify first)
      const encryptedSecret = encryptMfaSecret(secret);
      await storage.updateUser(req.orgId!, user.id, { mfaSecret: encryptedSecret } as any);

      // Generate QR code for authenticator app
      const org = await storage.getOrganization(req.orgId!);
      const issuer = org?.settings?.branding?.appName || "Observatory QA";
      const otpAuthUrl = generateURI({ issuer, label: user.username, secret });
      const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_setup_initiated",
        resourceType: "auth",
        detail: "TOTP secret generated for MFA setup",
      });

      res.json({
        secret, // Show to user for manual entry
        qrCode: qrCodeDataUrl,
        message: "Scan the QR code with your authenticator app, then verify with a code to enable MFA.",
      });
    } catch (error) {
      logger.error({ err: error }, "MFA setup failed");
      res.status(500).json({ message: "Failed to set up MFA" });
    }
  });

  // ==================== MFA ENABLE ====================
  // Step 2: Verify a TOTP code to confirm setup and activate MFA
  app.post("/api/auth/mfa/enable", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code is required" });
      }

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.mfaEnabled) return res.status(400).json({ message: "MFA is already enabled" });
      if (!user.mfaSecret) return res.status(400).json({ message: "Run MFA setup first" });

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;

      if (!isValid) {
        logPhiAccess({
          ...auditContext(req),
          event: "mfa_enable_failed",
          resourceType: "auth",
          detail: "Invalid TOTP code during MFA enable",
        });
        return res.status(400).json({ message: "Invalid verification code. Check your authenticator app and try again." });
      }

      // Generate backup codes
      const { plain, hashed } = generateBackupCodes(10);

      // Enable MFA
      await storage.updateUser(req.orgId!, user.id, {
        mfaEnabled: true,
        mfaBackupCodes: hashed,
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_enabled",
        resourceType: "auth",
        detail: "MFA enabled via TOTP verification",
      });

      res.json({
        message: "MFA enabled successfully.",
        backupCodes: plain,
        warning: "Save these backup codes securely. They will not be shown again.",
      });
    } catch (error) {
      logger.error({ err: error }, "MFA enable failed");
      res.status(500).json({ message: "Failed to enable MFA" });
    }
  });

  // ==================== MFA VERIFY (login challenge) ====================
  // Called after password auth succeeds for MFA-enabled users
  app.post("/api/auth/mfa/verify", async (req, res) => {
    try {
      const { userId, code } = req.body;
      if (!userId || !code) {
        return res.status(400).json({ message: "userId and code are required" });
      }

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) {
        return res.status(429).json({ message: "Too many MFA attempts. Try again later." });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA not configured for this user" });
      }

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;

      if (!isValid) {
        recordMfaAttempt(sessionId);
        logPhiAccess({
          userId: user.id,
          username: user.username,
          orgId: user.orgId,
          event: "mfa_verify_failed",
          resourceType: "auth",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        });
        return res.status(401).json({ message: "Invalid MFA code" });
      }

      clearMfaAttempts(sessionId);

      // Complete login — create session
      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgSlug: org?.slug || "default",
      };

      // Regenerate session before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          logger.error({ err: regenErr }, "Session regeneration failed after MFA verify");
          return res.status(500).json({ message: "Login failed" });
        }

        req.login(sessionUser, (loginErr) => {
          if (loginErr) {
            logger.error({ err: loginErr }, "Session creation failed after MFA verify");
            return res.status(500).json({ message: "Login failed" });
          }

          logPhiAccess({
            userId: user.id,
            username: user.username,
            orgId: user.orgId,
            event: "mfa_verify_success",
            resourceType: "auth",
            detail: "MFA verification completed, session created",
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          res.json(sessionUser);
        });
      });
    } catch (error) {
      logger.error({ err: error }, "MFA verification failed");
      res.status(500).json({ message: "MFA verification failed" });
    }
  });

  // ==================== MFA BACKUP CODE ====================
  // Use a backup code when authenticator app is unavailable
  app.post("/api/auth/mfa/backup", async (req, res) => {
    try {
      const { userId, backupCode } = req.body;
      if (!userId || !backupCode) {
        return res.status(400).json({ message: "userId and backupCode are required" });
      }

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) {
        return res.status(429).json({ message: "Too many MFA attempts. Try again later." });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled) {
        return res.status(400).json({ message: "MFA not configured for this user" });
      }

      const backupCodes = user.mfaBackupCodes || [];
      const hashedInput = hashBackupCode(backupCode);
      const codeIndex = backupCodes.indexOf(hashedInput);

      if (codeIndex === -1) {
        recordMfaAttempt(sessionId);
        logPhiAccess({
          userId: user.id,
          username: user.username,
          orgId: user.orgId,
          event: "mfa_backup_failed",
          resourceType: "auth",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        });
        return res.status(401).json({ message: "Invalid backup code" });
      }

      // Remove used backup code (one-time use)
      const remainingCodes = [...backupCodes];
      remainingCodes.splice(codeIndex, 1);
      await storage.updateUser(user.orgId, user.id, { mfaBackupCodes: remainingCodes } as any);

      clearMfaAttempts(sessionId);

      // Complete login
      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgSlug: org?.slug || "default",
      };

      // Regenerate session before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: "Login failed" });

        req.login(sessionUser, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });

          logPhiAccess({
            userId: user.id,
            username: user.username,
            orgId: user.orgId,
            event: "mfa_backup_used",
            resourceType: "auth",
            detail: `Backup code used. ${remainingCodes.length} remaining.`,
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          res.json({
            ...sessionUser,
            warning: `Backup code accepted. You have ${remainingCodes.length} backup codes remaining.`,
          });
        });
      });
    } catch (error) {
      logger.error({ err: error }, "Backup code verification failed");
      res.status(500).json({ message: "Backup code verification failed" });
    }
  });

  // ==================== MFA DISABLE ====================
  app.post("/api/auth/mfa/disable", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Current MFA code is required to disable MFA" });

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.mfaEnabled || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA is not enabled" });
      }

      // Check if org enforces MFA
      const org = await storage.getOrganization(req.orgId!);
      if (org?.settings?.mfaRequired) {
        return res.status(403).json({ message: "Your organization requires MFA. Contact an admin to change this policy." });
      }

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;
      if (!isValid) {
        logPhiAccess({
          ...auditContext(req),
          event: "mfa_disable_failed",
          resourceType: "auth",
          detail: "Invalid TOTP code during MFA disable",
        });
        return res.status(401).json({ message: "Invalid MFA code" });
      }

      await storage.updateUser(req.orgId!, user.id, {
        mfaEnabled: false,
        mfaSecret: undefined,
        mfaBackupCodes: undefined,
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_disabled",
        resourceType: "auth",
        detail: "MFA disabled by user",
      });

      res.json({ message: "MFA has been disabled." });
    } catch (error) {
      logger.error({ err: error }, "MFA disable failed");
      res.status(500).json({ message: "Failed to disable MFA" });
    }
  });

  // ==================== MFA STATUS ====================
  app.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const org = await storage.getOrganization(user.orgId);
      res.json({
        mfaEnabled: user.mfaEnabled || false,
        mfaRequired: org?.settings?.mfaRequired || false,
        backupCodesRemaining: user.mfaBackupCodes?.length || 0,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get MFA status" });
    }
  });
}
