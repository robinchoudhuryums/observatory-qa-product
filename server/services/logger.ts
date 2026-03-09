/**
 * Structured logging with Pino.
 *
 * Replaces console.log/warn/error throughout the server with
 * structured JSON logging (production) or pretty-printing (development).
 *
 * HIPAA: Never log PHI (patient names, call content, transcripts).
 * Only log metadata: user IDs, org IDs, call IDs, timestamps, durations.
 */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const betterstackToken = process.env.BETTERSTACK_SOURCE_TOKEN;

function buildTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  if (!isProduction) {
    return {
      target: "pino/file",
      options: { destination: 1 }, // stdout
    };
  }

  if (betterstackToken) {
    // Stream to both stdout (for Render logs) and Betterstack
    console.log("[LOGGER] Betterstack transport enabled");
    return {
      targets: [
        { target: "pino/file", options: { destination: 1 } },
        { target: "@logtail/pino", options: { sourceToken: betterstackToken } },
      ],
    };
  }

  // Production without Betterstack: structured JSON to stdout
  console.log("[LOGGER] BETTERSTACK_SOURCE_TOKEN not set — logging to stdout only");
  return undefined;
}

const transport = buildTransport();
const isMultiTarget = transport && "targets" in transport;

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // Pino disallows custom level formatters with multi-target transports
  ...(!isMultiTarget ? {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  } : {}),
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(transport ? { transport } : {}),
});

/**
 * Create a child logger scoped to a specific context.
 * Useful for request-scoped or org-scoped logging.
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
