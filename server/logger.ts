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

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        },
      }
    : {}),
  formatters: {
    level: (label) => ({ level: label }),
  },
  // HIPAA: Never log sensitive fields
  redact: {
    paths: ["password", "passwordHash", "sessionSecret", "apiKey", "*.password", "*.passwordHash"],
    censor: "[REDACTED]",
  },
});
