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

// --- Dark mode wrapper ---

/**
 * Wraps email HTML content with dark mode support.
 * Uses @media (prefers-color-scheme: dark) for clients that support it
 * (Apple Mail, iOS Mail, Outlook.com, Gmail mobile).
 * Falls back gracefully to light mode on unsupported clients.
 */
function wrapWithDarkMode(innerHtml: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <style>
        :root { color-scheme: light dark; }
        @media (prefers-color-scheme: dark) {
          .email-body { background-color: #1a1a2e !important; }
          .email-card { background-color: #16213e !important; border-color: #2a2a4a !important; }
          .email-text { color: #e0e0e0 !important; }
          .email-heading { color: #f0f0f0 !important; }
          .email-muted { color: #a0a0b0 !important; }
          .email-border { border-color: #2a2a4a !important; }
          .email-table-header { color: #a0a0b0 !important; border-color: #2a2a4a !important; }
          .email-table-cell { color: #e0e0e0 !important; }
          .email-bar-bg { background: #2a2a4a !important; }
        }
      </style>
    </head>
    <body class="email-body" style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <div class="email-card" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; padding: 24px;">
        ${innerHtml}
      </div>
    </body>
    </html>
  `;
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

  const html = wrapWithDarkMode(`
      <h2 class="email-heading" style="color: #1a1a1a; margin: 0 0 16px;">Password Reset</h2>
      <p class="email-text" style="color: #333;">Hi ${escapeHtml(userName)},</p>
      <p class="email-text" style="color: #333;">You requested a password reset for your <strong>${escapeHtml(orgName)}</strong> account.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(resetUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p class="email-muted" style="color: #666; font-size: 14px;">This link is valid for 1 hour. If you didn't request this, ignore this email.</p>
  `);

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

  const html = wrapWithDarkMode(`
      <h2 class="email-heading" style="color: #1a1a1a; margin: 0 0 16px;">You're Invited</h2>
      <p class="email-text" style="color: #333;"><strong>${escapeHtml(invitedByName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(role)}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Accept Invitation
        </a>
      </p>
      <p class="email-muted" style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
  `);

  return { to: "", subject, text, html };
}

export function buildFlaggedCallEmail(
  callId: string,
  flags: string[],
  performanceScore: number | undefined,
  agentName: string | undefined,
  fileName: string | undefined,
  summary: string | undefined,
  orgName: string,
  dashboardUrl: string,
): EmailOptions {
  const flagLabels = flags.map(f => {
    if (f === "low_score") return "Low Score";
    if (f === "exceptional_call") return "Exceptional Call";
    if (f.startsWith("agent_misconduct")) return `Misconduct: ${f.split(":")[1] || "unspecified"}`;
    return f;
  });
  const isGood = flags.includes("exceptional_call") && !flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
  const scoreText = performanceScore != null ? `${performanceScore.toFixed(1)}/10` : "N/A";
  const emoji = isGood ? "Star" : "Alert";

  const subject = `[${orgName}] Call Flagged: ${flagLabels.join(", ")} — Score: ${scoreText}`;
  const callUrl = `${dashboardUrl}/transcripts/${callId}`;

  const text = [
    `${emoji === "Star" ? "Exceptional" : "Flagged"} Call — ${orgName}`,
    "",
    `Flags: ${flagLabels.join(", ")}`,
    `Score: ${scoreText}`,
    ...(agentName ? [`Agent: ${agentName}`] : []),
    ...(fileName ? [`File: ${fileName}`] : []),
    ...(summary ? ["", `Summary: ${summary.slice(0, 500)}`] : []),
    "",
    `View call: ${callUrl}`,
    "",
    `— ${orgName} QA Platform`,
  ].join("\n");

  const flagColor = isGood ? "#10b981" : "#ef4444";
  const html = wrapWithDarkMode(`
      <div style="border-left: 4px solid ${flagColor}; padding-left: 16px; margin-bottom: 16px;">
        <h2 class="email-heading" style="color: #1a1a1a; margin: 0 0 4px;">Call Flagged: ${escapeHtml(flagLabels.join(", "))}</h2>
        <p class="email-muted" style="color: #666; font-size: 14px; margin: 0;">${escapeHtml(orgName)}</p>
      </div>
      <table style="font-size: 14px; border-collapse: collapse;">
        <tr><td class="email-muted" style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">Score</td><td class="email-text" style="color: #333;">${escapeHtml(scoreText)}</td></tr>
        ${agentName ? `<tr><td class="email-muted" style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">Agent</td><td class="email-text" style="color: #333;">${escapeHtml(agentName)}</td></tr>` : ""}
        ${fileName ? `<tr><td class="email-muted" style="padding: 4px 12px 4px 0; color: #666; font-weight: 600;">File</td><td class="email-text" style="color: #333;">${escapeHtml(fileName)}</td></tr>` : ""}
      </table>
      ${summary ? `<p class="email-text" style="font-size: 14px; color: #333; margin-top: 12px;">${escapeHtml(summary.slice(0, 500))}</p>` : ""}
      <p style="margin: 20px 0;">
        <a href="${escapeHtml(callUrl)}" style="background: ${flagColor}; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">
          View Call Details
        </a>
      </p>
  `);

  return { to: "", subject, text, html };
}

export function buildQuotaAlertEmail(
  orgName: string,
  warnings: Array<{ label: string; used: number; limit: number; pct: number }>,
  isExhausted: boolean,
  dashboardUrl: string,
): EmailOptions {
  const severity = isExhausted ? "Limit Reached" : "Approaching Limit";
  const subject = `[${orgName}] Plan ${severity}: ${warnings.map(w => `${w.label} ${w.pct}%`).join(", ")}`;
  const settingsUrl = `${dashboardUrl}/admin/settings?tab=billing`;

  const text = [
    `${orgName} — Plan ${severity}`,
    "",
    ...warnings.map(w => `${w.label}: ${w.used}/${w.limit} (${w.pct}%)`),
    "",
    isExhausted
      ? "Your organization has hit its plan limit. New uploads and analyses are blocked until the next billing cycle or you upgrade."
      : "Your organization is approaching its plan limits for this billing period.",
    "",
    `Upgrade or manage your plan: ${settingsUrl}`,
    "",
    `— ${orgName} QA Platform`,
  ].join("\n");

  const barColor = isExhausted ? "#ef4444" : "#f59e0b";
  const warningRows = warnings.map(w => `
    <tr>
      <td class="email-text" style="padding: 8px 12px; font-weight: 600; color: #333;">${escapeHtml(w.label)}</td>
      <td class="email-text" style="padding: 8px 12px; color: #333;">${w.used} / ${w.limit}</td>
      <td style="padding: 8px 12px;">
        <div class="email-bar-bg" style="width: 100px; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(w.pct, 100)}%; height: 100%; background: ${barColor}; border-radius: 4px;"></div>
        </div>
      </td>
      <td style="padding: 8px 12px; font-weight: 600; color: ${w.pct >= 100 ? '#ef4444' : '#f59e0b'};">${w.pct}%</td>
    </tr>
  `).join("");

  const html = wrapWithDarkMode(`
      <div style="border-left: 4px solid ${barColor}; padding-left: 16px; margin-bottom: 16px;">
        <h2 class="email-heading" style="color: #1a1a1a; margin: 0 0 4px;">Plan ${escapeHtml(severity)}</h2>
        <p class="email-muted" style="color: #666; font-size: 14px; margin: 0;">${escapeHtml(orgName)}</p>
      </div>
      <table style="font-size: 14px; border-collapse: collapse; width: 100%;">
        <thead>
          <tr class="email-border" style="border-bottom: 1px solid #e5e7eb;">
            <th class="email-table-header" style="padding: 8px 12px; text-align: left; color: #666;">Resource</th>
            <th class="email-table-header" style="padding: 8px 12px; text-align: left; color: #666;">Usage</th>
            <th style="padding: 8px 12px;"></th>
            <th style="padding: 8px 12px;"></th>
          </tr>
        </thead>
        <tbody>${warningRows}</tbody>
      </table>
      <p class="email-text" style="font-size: 14px; color: #333; margin-top: 16px;">
        ${isExhausted
          ? "New uploads and analyses are <strong>blocked</strong> until the next billing cycle or you upgrade."
          : "Consider upgrading before you hit your limit."}
      </p>
      <p style="margin: 20px 0;">
        <a href="${escapeHtml(settingsUrl)}" style="background: ${barColor}; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">
          ${isExhausted ? "Upgrade Now" : "Manage Plan"}
        </a>
      </p>
  `);

  return { to: "", subject, text, html };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
