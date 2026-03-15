/**
 * Notification service for call processing events and proactive alerts.
 *
 * Supports Slack and Microsoft Teams webhook formats.
 * Configurable per-channel routing via WEBHOOK_* env vars.
 *
 * Configure via environment variables:
 *   WEBHOOK_URL — Default URL to POST notifications (Slack/Teams incoming webhook)
 *   WEBHOOK_COACHING_URL — Optional separate channel for coaching alerts
 *   WEBHOOK_DIGEST_URL — Optional separate channel for weekly digests
 *   WEBHOOK_PLATFORM — "slack" (default) or "teams"
 *   WEBHOOK_EVENTS — comma-separated event types (default: "low_score,agent_misconduct,exceptional_call")
 */
import { logger } from "./logger";
import { storage } from "../storage";
import { sendEmail, buildFlaggedCallEmail } from "./email";

// --- Configuration ---

const ENV_WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_COACHING_URL = process.env.WEBHOOK_COACHING_URL || ENV_WEBHOOK_URL;
const WEBHOOK_DIGEST_URL = process.env.WEBHOOK_DIGEST_URL || ENV_WEBHOOK_URL;
const ENV_WEBHOOK_PLATFORM = (process.env.WEBHOOK_PLATFORM || "slack") as "slack" | "teams";
const ENV_WEBHOOK_EVENTS = (process.env.WEBHOOK_EVENTS || "low_score,agent_misconduct,exceptional_call")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Keep backwards compat aliases
const WEBHOOK_URL = ENV_WEBHOOK_URL;
const WEBHOOK_PLATFORM = ENV_WEBHOOK_PLATFORM;
const WEBHOOK_EVENTS = ENV_WEBHOOK_EVENTS;

/** Resolve webhook config for an org: org settings override env vars. */
async function resolveOrgWebhookConfig(orgId?: string): Promise<{
  url: string | undefined;
  platform: "slack" | "teams";
  events: string[];
}> {
  if (!orgId) return { url: WEBHOOK_URL, platform: WEBHOOK_PLATFORM, events: WEBHOOK_EVENTS };
  try {
    const org = await storage.getOrganization(orgId);
    const s = org?.settings;
    return {
      url: s?.webhookUrl || WEBHOOK_URL,
      platform: s?.webhookPlatform || WEBHOOK_PLATFORM,
      events: (s?.webhookEvents && s.webhookEvents.length > 0) ? s.webhookEvents : WEBHOOK_EVENTS,
    };
  } catch {
    return { url: WEBHOOK_URL, platform: WEBHOOK_PLATFORM, events: WEBHOOK_EVENTS };
  }
}

// --- Types ---

export interface CallNotification {
  event: "call_flagged" | "call_completed";
  callId: string;
  orgId: string;
  flags: string[];
  performanceScore?: number;
  agentName?: string;
  fileName?: string;
  summary?: string;
  timestamp: string;
}

export interface SlackNotificationPayload {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
}

type SlackBlock = {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
};

// --- Core send function ---

async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn({ statusCode: response.status, responseBody: body }, "Webhook returned non-OK status");
      return false;
    }
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Webhook delivery failed");
    return false;
  }
}

function getChannelUrl(channel?: string): string | undefined {
  if (channel === "coaching") return WEBHOOK_COACHING_URL;
  if (channel === "digest") return WEBHOOK_DIGEST_URL;
  return WEBHOOK_URL;
}

// --- Public API ---

/**
 * Check if any flags match the configured notification events.
 */
function shouldNotify(flags: string[]): boolean {
  if (!WEBHOOK_URL || flags.length === 0) return false;
  return flags.some(flag =>
    WEBHOOK_EVENTS.some(event => flag === event || flag.startsWith(`${event}:`))
  );
}

/**
 * Send a webhook notification for a flagged call.
 * Non-blocking — failures are logged but never throw.
 */
export async function notifyFlaggedCall(notification: CallNotification): Promise<void> {
  // Send webhook notification
  try {
    const config = await resolveOrgWebhookConfig(notification.orgId);
    if (config.url && notification.flags.length > 0) {
      const matched = notification.flags.some(flag =>
        config.events.some(event => flag === event || flag.startsWith(`${event}:`))
      );
      if (matched) {
        const payload = config.platform === "teams"
          ? buildTeamsCallPayload(notification)
          : buildSlackCallPayload(notification);

        const sent = await sendWebhook(config.url, payload);
        if (sent) {
          logger.info({ callId: notification.callId, flags: notification.flags }, "Webhook sent for flagged call");
        }
      }
    }
  } catch (error) {
    logger.warn({ callId: notification.callId, err: error }, "Webhook failed for call");
  }

  // Send email notification to org admins/managers
  try {
    await sendFlaggedCallEmails(notification);
  } catch (error) {
    logger.warn({ callId: notification.callId, err: error }, "Email notification failed for call");
  }
}

/**
 * Email org admins and managers when a call is flagged.
 * Non-blocking — failures logged but never throw to caller.
 */
async function sendFlaggedCallEmails(notification: CallNotification): Promise<void> {
  const { orgId, callId, flags, performanceScore, agentName, fileName, summary } = notification;

  // Get org info and admin/manager users
  const [org, users] = await Promise.all([
    storage.getOrganization(orgId),
    storage.listUsersByOrg(orgId),
  ]);
  if (!org) return;

  const orgName = org.name || org.slug || "Observatory QA";
  // Determine the base URL from org settings or default
  const dashboardUrl = process.env.APP_URL || "https://app.observatory-qa.com";

  const emailRecipients = users.filter(u =>
    (u.role === "admin" || u.role === "manager") && u.username?.includes("@")
  );
  if (emailRecipients.length === 0) return;

  const emailTemplate = buildFlaggedCallEmail(
    callId, flags, performanceScore, agentName, fileName, summary, orgName, dashboardUrl,
  );

  await Promise.allSettled(
    emailRecipients.map(user =>
      sendEmail({ ...emailTemplate, to: user.username })
    )
  );

  logger.info(
    { callId, recipientCount: emailRecipients.length },
    "Flagged call email notifications sent",
  );
}

/**
 * Send a Slack/Teams notification with custom payload.
 * Used by proactive alerts and coaching engine.
 */
export async function sendSlackNotification(payload: SlackNotificationPayload, orgId?: string): Promise<boolean> {
  const config = await resolveOrgWebhookConfig(orgId);
  const url = config.url ? (getChannelUrl(payload.channel) || config.url) : undefined;
  if (!url) {
    logger.debug("No webhook URL configured for channel, skipping notification");
    return false;
  }

  if (config.platform === "teams") {
    return sendWebhook(url, convertToTeamsFormat(payload));
  }

  return sendWebhook(url, payload as unknown as Record<string, unknown>);
}

/**
 * Send a weekly digest to the configured digest webhook.
 */
export async function sendDigestNotification(digest: {
  period: { from: string; to: string };
  totalCalls: number;
  avgScore: number;
  flaggedCalls: number;
  sentiment: { positive: number; neutral: number; negative: number };
  topPerformers: Array<{ name: string; avgScore: number; callCount: number }>;
  agentsNeedingAttention: Array<{ name: string; avgScore: number; reason: string }>;
}): Promise<boolean> {
  const url = WEBHOOK_DIGEST_URL;
  if (!url) return false;

  const fromDate = new Date(digest.period.from).toLocaleDateString();
  const toDate = new Date(digest.period.to).toLocaleDateString();

  if (WEBHOOK_PLATFORM === "teams") {
    return sendWebhook(url, buildTeamsDigest(digest, fromDate, toDate));
  }

  return sendWebhook(url, buildSlackDigest(digest, fromDate, toDate));
}

// --- Slack payload builders ---

function buildSlackCallPayload(notification: CallNotification): Record<string, unknown> {
  const { callId, flags, performanceScore, agentName, fileName, summary } = notification;
  const flagLabels = formatFlagLabels(flags);
  const emoji = flags.includes("exceptional_call") ? "star" : "warning";
  const scoreText = performanceScore != null ? `${performanceScore.toFixed(1)}/10` : "N/A";

  return {
    text: `Call flagged: ${flagLabels.join(", ")} — Score: ${scoreText}${agentName ? ` — Agent: ${agentName}` : ""}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `:${emoji}: Call Flagged: ${flagLabels.join(", ")}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Call ID:*\n${callId}` },
          { type: "mrkdwn", text: `*Score:*\n${scoreText}` },
          ...(agentName ? [{ type: "mrkdwn", text: `*Agent:*\n${agentName}` }] : []),
          ...(fileName ? [{ type: "mrkdwn", text: `*File:*\n${fileName}` }] : []),
        ],
      },
      ...(summary ? [{
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${summary.slice(0, 500)}` },
      }] : []),
    ],
  };
}

function buildSlackDigest(
  digest: {
    totalCalls: number;
    avgScore: number;
    flaggedCalls: number;
    sentiment: { positive: number; neutral: number; negative: number };
    topPerformers: Array<{ name: string; avgScore: number; callCount: number }>;
    agentsNeedingAttention: Array<{ name: string; avgScore: number; reason: string }>;
  },
  fromDate: string,
  toDate: string,
): Record<string, unknown> {
  const topList = digest.topPerformers
    .map((p, i) => `${i + 1}. ${p.name} — ${p.avgScore.toFixed(1)}/10 (${p.callCount} calls)`)
    .join("\n") || "No data";

  const attentionList = digest.agentsNeedingAttention
    .map(a => `• ${a.name} — ${a.avgScore.toFixed(1)}/10 (${a.reason})`)
    .join("\n") || "None";

  return {
    text: `Weekly QA Digest (${fromDate} – ${toDate}): ${digest.totalCalls} calls, avg score ${digest.avgScore.toFixed(1)}/10`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: ":bar_chart: Weekly QA Digest", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${fromDate} – ${toDate}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Total Calls:*\n${digest.totalCalls}` },
          { type: "mrkdwn", text: `*Avg Score:*\n${digest.avgScore.toFixed(1)}/10` },
          { type: "mrkdwn", text: `*Flagged:*\n${digest.flaggedCalls}` },
          { type: "mrkdwn", text: `*Sentiment:*\n:thumbsup: ${digest.sentiment.positive} :neutral_face: ${digest.sentiment.neutral} :thumbsdown: ${digest.sentiment.negative}` },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*:trophy: Top Performers:*\n${topList}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*:rotating_light: Needs Attention:*\n${attentionList}` },
      },
    ],
  };
}

// --- Teams payload builders ---

function buildTeamsCallPayload(notification: CallNotification): Record<string, unknown> {
  const { callId, flags, performanceScore, agentName, fileName, summary } = notification;
  const flagLabels = formatFlagLabels(flags);
  const scoreText = performanceScore != null ? `${performanceScore.toFixed(1)}/10` : "N/A";

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: flags.includes("exceptional_call") ? "00AA00" : "FF0000",
    summary: `Call Flagged: ${flagLabels.join(", ")}`,
    sections: [
      {
        activityTitle: `Call Flagged: ${flagLabels.join(", ")}`,
        facts: [
          { name: "Call ID", value: callId },
          { name: "Score", value: scoreText },
          ...(agentName ? [{ name: "Agent", value: agentName }] : []),
          ...(fileName ? [{ name: "File", value: fileName }] : []),
        ],
        text: summary ? summary.slice(0, 500) : undefined,
      },
    ],
  };
}

function buildTeamsDigest(
  digest: {
    totalCalls: number;
    avgScore: number;
    flaggedCalls: number;
    sentiment: { positive: number; neutral: number; negative: number };
    topPerformers: Array<{ name: string; avgScore: number; callCount: number }>;
    agentsNeedingAttention: Array<{ name: string; avgScore: number; reason: string }>;
  },
  fromDate: string,
  toDate: string,
): Record<string, unknown> {
  const topList = digest.topPerformers
    .map((p, i) => `${i + 1}. **${p.name}** — ${p.avgScore.toFixed(1)}/10 (${p.callCount} calls)`)
    .join("<br>") || "No data";

  const attentionList = digest.agentsNeedingAttention
    .map(a => `- **${a.name}** — ${a.avgScore.toFixed(1)}/10 (${a.reason})`)
    .join("<br>") || "None";

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "0076D7",
    summary: `Weekly QA Digest: ${digest.totalCalls} calls`,
    sections: [
      {
        activityTitle: `Weekly QA Digest (${fromDate} – ${toDate})`,
        facts: [
          { name: "Total Calls", value: String(digest.totalCalls) },
          { name: "Avg Score", value: `${digest.avgScore.toFixed(1)}/10` },
          { name: "Flagged", value: String(digest.flaggedCalls) },
          { name: "Sentiment", value: `+${digest.sentiment.positive} / =${digest.sentiment.neutral} / -${digest.sentiment.negative}` },
        ],
      },
      {
        activityTitle: "Top Performers",
        text: topList,
      },
      {
        activityTitle: "Needs Attention",
        text: attentionList,
      },
    ],
  };
}

/**
 * Convert a Slack-format payload to Teams MessageCard format.
 */
function convertToTeamsFormat(payload: SlackNotificationPayload): Record<string, unknown> {
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "0076D7",
    summary: payload.text,
    sections: [
      {
        activityTitle: payload.text,
        text: payload.blocks
          ?.filter(b => b.type === "section" && b.text)
          .map(b => b.text!.text)
          .join("\n\n") || "",
      },
    ],
  };
}

// --- Helpers ---

function formatFlagLabels(flags: string[]): string[] {
  return flags.map(f => {
    if (f === "low_score") return "Low Score";
    if (f === "exceptional_call") return "Exceptional Call";
    if (f.startsWith("agent_misconduct")) return `Misconduct: ${f.split(":")[1] || "unspecified"}`;
    return f;
  });
}
