/**
 * Express middleware for OpenTelemetry request tracing.
 *
 * - Adds X-Trace-Id response header for correlation
 * - Records org_id, user_id, user_role as span attributes
 * - Tracks request duration as a histogram metric
 */

import type { Request, Response, NextFunction } from "express";
import { getMeter } from "../services/telemetry";

let requestDuration: ReturnType<ReturnType<typeof getMeter>["createHistogram"]> | null = null;

function getRequestDurationHistogram() {
  if (!requestDuration) {
    requestDuration = getMeter("observatory-qa").createHistogram(
      "http_request_duration_ms",
      {
        description: "HTTP request duration in milliseconds",
        unit: "ms",
      },
    );
  }
  return requestDuration;
}

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // Try to get the active span and attach trace ID + custom attributes
  let traceId: string | undefined;
  try {
    const otelApi = require("@opentelemetry/api");
    const span = otelApi.trace.getActiveSpan?.();
    if (span) {
      const ctx = span.spanContext();
      traceId = ctx?.traceId;

      if (traceId) {
        res.setHeader("X-Trace-Id", traceId);
      }

      // Attach org/user context once auth has populated req
      // We set attributes on finish so auth middleware has run by then
      res.on("finish", () => {
        try {
          if (req.orgId) span.setAttribute("org_id", req.orgId);
          if (req.user) {
            span.setAttribute("user_id", (req.user as any).id ?? (req.user as any).username ?? "");
            span.setAttribute("user_role", (req.user as any).role ?? "");
          }
        } catch {
          // span may have already ended — ignore
        }
      });
    }
  } catch {
    // @opentelemetry/api not available — telemetry disabled, skip
  }

  // Record request duration metric on response finish
  res.on("finish", () => {
    const duration = Date.now() - start;
    try {
      getRequestDurationHistogram().record(duration, {
        method: req.method,
        route: req.route?.path ?? req.path,
        status_code: res.statusCode.toString(),
      });
    } catch {
      // metrics not available — ignore
    }
  });

  next();
}
