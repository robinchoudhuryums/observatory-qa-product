/**
 * Structured logger using pino.
 *
 * Usage:
 *   import { logger } from "./logger";
 *   logger.info({ callId }, "Processing started");
 *   logger.warn({ callId, error: err.message }, "AI analysis failed");
 *
 * In production, outputs JSON lines for log aggregators.
 * In development, outputs human-readable format.
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
    return {
      targets: [
        { target: "pino/file", options: { destination: 1 } },
        { target: "@logtail/pino", options: { sourceToken: betterstackToken } },
      ],
    };
  }

  return undefined;
}

const transport = buildTransport();

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  // HIPAA: Never log sensitive fields
  redact: {
    paths: ["password", "passwordHash", "sessionSecret", "apiKey", "*.password", "*.passwordHash"],
    censor: "[REDACTED]",
  },
  ...(transport ? { transport } : {}),
});
