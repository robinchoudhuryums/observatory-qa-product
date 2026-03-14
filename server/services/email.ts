/**
 * Email service abstraction for transactional emails.
 *
 * Supports multiple backends:
 * - SMTP (via Nodemailer) — default, works with any SMTP provider
 * - AWS SES (via Nodemailer SES transport) — set SMTP_HOST=email-smtp.<region>.amazonaws.com
 * - Console/log (dev fallback when no SMTP configured)
 *
 * HIPAA: Never include PHI (call content, transcripts) in emails.
 * Only send metadata: tokens, user names, org names, links.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;
let fromAddress: string = "noreply@observatory-qa.com";

/**
 * Initialize the email transport. Call once at startup.
 * Returns true if a real SMTP transport was configured.
 */
export function initEmail(): boolean {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  fromAddress = process.env.SMTP_FROM || fromAddress;

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — emails will be logged to console only");
    return false;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info({ host, port, from: fromAddress }, "Email transport initialized");
  return true;
}

/**
 * Send a transactional email.
 * Falls back to logging when no transport is configured.
 * Non-blocking — failures are logged but never throw.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const { to, subject, text, html } = options;

  if (!transporter) {
    // Dev fallback: log the email content
    logger.info(
      { to, subject, textLength: text.length },
      `[EMAIL-DEV] Would send email: "${subject}" to ${to}`,
    );
    return true;
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text,
      html,
    });
    logger.info({ to, subject }, "Email sent");
    return true;
  } catch (error) {
    logger.error({ err: error, to, subject }, "Failed to send email");
    return false;
  }
}

// --- Email templates ---

export function buildPasswordResetEmail(
  resetUrl: string,
  userName: string,
  orgName: string,
): EmailOptions {
  const subject = `Password Reset — ${orgName}`;
  const text = [
    `Hi ${userName},`,
    "",
    `You requested a password reset for your ${orgName} account.`,
    "",
    `Click the link below to reset your password (valid for 1 hour):`,
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email.",
    "",
    `— ${orgName} Team`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Password Reset</h2>
      <p>Hi ${escapeHtml(userName)},</p>
      <p>You requested a password reset for your <strong>${escapeHtml(orgName)}</strong> account.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(resetUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This link is valid for 1 hour. If you didn't request this, ignore this email.</p>
    </div>
  `;

  return { to: "", subject, text, html };
}

export function buildInvitationEmail(
  inviteUrl: string,
  orgName: string,
  invitedByName: string,
  role: string,
): EmailOptions {
  const subject = `You're invited to ${orgName}`;
  const text = [
    `${invitedByName} has invited you to join ${orgName} as a ${role}.`,
    "",
    `Click the link below to accept your invitation:`,
    inviteUrl,
    "",
    "This invitation expires in 7 days.",
    "",
    `— ${orgName} Team`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">You're Invited</h2>
      <p><strong>${escapeHtml(invitedByName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(role)}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
    </div>
  `;

  return { to: "", subject, text, html };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
