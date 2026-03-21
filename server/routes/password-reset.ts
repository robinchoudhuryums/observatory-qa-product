/**
 * Password reset flow:
 * 1. POST /api/auth/forgot-password — accepts { email } (which is the username/email)
 * 2. Generates token, stores SHA-256 hash, sends email with reset link
 * 3. POST /api/auth/reset-password — accepts { token, newPassword }
 * 4. Validates token, updates password hash, invalidates token
 *
 * HIPAA: Tokens are hashed (never stored in plaintext). Emails contain no PHI.
 * Rate limited alongside login to prevent enumeration.
 */
import type { Express } from "express";
import { randomBytes, createHash } from "crypto";
import { storage } from "../storage";
import { hashPassword } from "../auth";
import { sendEmail, buildPasswordResetEmail } from "../services/email";
import { logger } from "../services/logger";

// In-memory token store (fallback when PostgreSQL is not available)
// In production with PostgreSQL, tokens are stored in the password_reset_tokens table
const memoryTokens = new Map<string, {
  userId: string;
  orgId: string;
  expiresAt: Date;
  usedAt?: Date;
}>();

async function storeResetToken(userId: string, orgId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  // Try PostgreSQL first
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (db) {
      const { passwordResetTokens } = await import("../db/schema");
      const { randomUUID } = await import("crypto");
      await db.insert(passwordResetTokens).values({
        id: randomUUID(),
        userId,
        tokenHash,
        expiresAt,
      });
      return;
    }
  } catch {
    // DB not available — fall through to in-memory
  }
  memoryTokens.set(tokenHash, { userId, orgId, expiresAt });
}

async function validateAndConsumeToken(tokenHash: string): Promise<{ userId: string; orgId: string } | null> {
  // Try PostgreSQL first
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (db) {
      const { passwordResetTokens } = await import("../db/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.usedAt) return null; // Already used
      if (new Date(row.expiresAt) < new Date()) return null; // Expired

      // Mark as used
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
      return { userId: row.userId, orgId: (row as any).orgId || "" };
    }
  } catch {
    // DB not available — fall through to in-memory
  }

  // In-memory fallback
  const entry = memoryTokens.get(tokenHash);
  if (!entry) return null;
  if (entry.usedAt) return null;
  if (entry.expiresAt < new Date()) {
    memoryTokens.delete(tokenHash);
    return null;
  }
  entry.usedAt = new Date();
  return { userId: entry.userId, orgId: entry.orgId };
}

export function registerPasswordResetRoutes(app: Express): void {

  /**
   * Request a password reset. Accepts username (which may be an email).
   * Always returns 200 to prevent user enumeration.
   */
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }

      // Always respond with success to prevent enumeration
      res.json({ message: "If an account exists with that email, a reset link has been sent." });

      // Look up user (non-blocking after response)
      const user = await storage.getUserByUsername(email.trim().toLowerCase());
      if (!user) return;

      // Look up org for the email template
      const org = await storage.getOrganization(user.orgId);
      const orgName = org?.name || "Observatory QA";

      // Generate a secure random token
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storeResetToken(user.id, user.orgId, tokenHash, expiresAt);

      // Build reset URL — use the request origin or a configured base URL
      const baseUrl = process.env.APP_BASE_URL
        || `${req.protocol}://${req.get("host")}`;
      const resetUrl = `${baseUrl}/auth?reset=${rawToken}`;

      const emailOpts = buildPasswordResetEmail(resetUrl, user.name, orgName);
      emailOpts.to = email;

      await sendEmail(emailOpts);
      logger.info({ userId: user.id }, "Password reset email sent");
    } catch (error) {
      // Don't expose errors — already responded with 200
      logger.error({ err: error }, "Password reset request failed");
    }
  });

  /**
   * Reset password with a valid token.
   */
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await validateAndConsumeToken(tokenHash);

      if (!result) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Update the user's password using org-scoped lookup
      const user = await storage.getUser(result.userId);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      const passwordHash = await hashPassword(newPassword);
      await storage.updateUser(user.orgId, result.userId, { passwordHash });

      logger.info({ userId: result.userId }, "Password reset successfully");
      res.json({ message: "Password has been reset. You can now log in with your new password." });
    } catch (error) {
      logger.error({ err: error }, "Password reset failed");
      res.status(500).json({ message: "Password reset failed" });
    }
  });
}
