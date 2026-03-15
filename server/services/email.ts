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
        <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb;" class="email-border">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="40" height="40" style="display: inline-block; vertical-align: middle;">
            <g transform="translate(3, -12) scale(0.78)" fill="#10b981">
              <path d="M60.146,32.33c-3.833,0-6.951,3.118-6.951,6.951c0,0.51,0.059,1.005,0.163,1.484c-2.886-1.626-5.3-1.021-6.685-0.141c0.085-0.435,0.133-0.884,0.133-1.344c0-3.833-3.118-6.951-6.951-6.951c-3.833,0-6.951,3.118-6.951,6.951s3.118,6.951,6.951,6.951c2.015,0,3.826-0.867,5.097-2.241c0.03,0.038,0.044,0.084,0.079,0.119l4.086,4.086c0.234,0.234,0.552,0.366,0.884,0.366s0.649-0.132,0.884-0.366l4.085-4.086c0.035-0.035,0.049-0.081,0.079-0.119c1.271,1.374,3.083,2.241,5.097,2.241c3.833,0,6.951-3.118,6.951-6.951S63.978,32.33,60.146,32.33z M39.855,43.732c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S42.309,43.732,39.855,43.732z M50,45.545l-2.452-2.452c0.032-0.026,0.071-0.038,0.101-0.067c0.185-0.186,1.871-1.728,4.776,0.094L50,45.545z M60.146,43.732c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S62.6,43.732,60.146,43.732z"/>
              <path d="M27.054,59.49c0.367,5.874,2.454,10.489,6.202,13.718c2.772,2.388,6.019,3.64,8.892,4.294v1.324c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-0.875c0.293,0.038,0.579,0.071,0.854,0.099v0.776c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-0.641c0.067,0.001,0.143,0.003,0.207,0.003c0.822,0,1.338-0.041,1.425-0.049c0.132-0.012,0.25-0.059,0.366-0.107c0.116,0.049,0.234,0.096,0.366,0.107c0.086,0.008,0.603,0.049,1.425,0.049c0.064,0,0.14-0.002,0.207-0.003v0.641c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25V78.05c0.275-0.027,0.56-0.061,0.854-0.099v0.875c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-1.323c2.873-0.654,6.12-1.907,8.892-4.295c3.748-3.229,5.835-7.844,6.202-13.718c0.277-4.437,0.014-17.334,0.002-17.854c0-11.972-10.229-21.712-22.802-21.712c-0.052,0-0.096,0.023-0.146,0.029c-0.05-0.006-0.095-0.029-0.146-0.029c-12.573,0-22.802,9.74-22.801,21.686C27.041,42.156,26.777,55.054,27.054,59.49z"/>
            </g>
          </svg>
          <span class="email-heading" style="display: inline-block; vertical-align: middle; margin-left: 8px; font-size: 18px; font-weight: 700; color: #1a1a1a;">Observatory</span>
        </div>
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
