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

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {
        // Production: structured JSON for log aggregation (Datadog, CloudWatch, etc.)
        formatters: {
          level: (label: string) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        // Development: human-readable output
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

/**
 * Create a child logger scoped to a specific context.
 * Useful for request-scoped or org-scoped logging.
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
