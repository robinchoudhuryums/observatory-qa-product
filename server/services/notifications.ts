/**
 * Notification service for call processing events.
 * Sends webhook notifications when calls are flagged (low score, misconduct, etc.)
 *
 * Configure via environment variables:
 *   WEBHOOK_URL — URL to POST notifications to (e.g., Slack incoming webhook)
 *   WEBHOOK_EVENTS — comma-separated event types to notify on (default: "low_score,agent_misconduct,exceptional_call")
 */

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

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_EVENTS = (process.env.WEBHOOK_EVENTS || "low_score,agent_misconduct,exceptional_call")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

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
  if (!shouldNotify(notification.flags)) return;

  try {
    const payload = buildPayload(notification);
    const response = await fetch(WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[NOTIFY] Webhook returned ${response.status}: ${await response.text().catch(() => "")}`);
    } else {
      console.log(`[NOTIFY] Webhook sent for call ${notification.callId} (flags: ${notification.flags.join(", ")})`);
    }
  } catch (error) {
    console.warn(`[NOTIFY] Webhook failed for call ${notification.callId}:`, (error as Error).message);
  }
}

/**
 * Build the webhook payload. Supports Slack-compatible format.
 */
function buildPayload(notification: CallNotification): Record<string, unknown> {
  const { callId, flags, performanceScore, agentName, fileName, summary } = notification;

  const flagLabels = flags.map(f => {
    if (f === "low_score") return "Low Score";
    if (f === "exceptional_call") return "Exceptional Call";
    if (f.startsWith("agent_misconduct")) return `Misconduct: ${f.split(":")[1] || "unspecified"}`;
    return f;
  });

  const emoji = flags.includes("exceptional_call") ? "star" : "warning";
  const scoreText = performanceScore != null ? `${performanceScore.toFixed(1)}/10` : "N/A";

  // Slack-compatible block format
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
