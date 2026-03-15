/**
 * Standardized error codes for support tickets.
 *
 * Format: OBS-{DOMAIN}-{NUMBER}
 * Domains: AUTH, CALL, EMP, BILLING, SSO, EXPORT, COACHING, ADMIN
 *
 * Include error codes in API error responses so users can reference them
 * when contacting support.
 */

export const ERROR_CODES = {
  // Auth errors
  AUTH_INVALID_CREDENTIALS: "OBS-AUTH-001",
  AUTH_ACCOUNT_LOCKED: "OBS-AUTH-002",
  AUTH_SESSION_EXPIRED: "OBS-AUTH-003",
  AUTH_INSUFFICIENT_ROLE: "OBS-AUTH-004",
  AUTH_SSO_REQUIRED: "OBS-AUTH-005",
  AUTH_SSO_CONFIG_MISSING: "OBS-AUTH-006",
  AUTH_REGISTRATION_FAILED: "OBS-AUTH-007",

  // Call errors
  CALL_UPLOAD_FAILED: "OBS-CALL-001",
  CALL_NOT_FOUND: "OBS-CALL-002",
  CALL_PROCESSING_FAILED: "OBS-CALL-003",
  CALL_TRANSCRIPTION_FAILED: "OBS-CALL-004",
  CALL_ANALYSIS_FAILED: "OBS-CALL-005",
  CALL_DELETE_FAILED: "OBS-CALL-006",
  CALL_ASSIGN_FAILED: "OBS-CALL-007",

  // Employee errors
  EMP_NOT_FOUND: "OBS-EMP-001",
  EMP_CREATE_FAILED: "OBS-EMP-002",
  EMP_DUPLICATE_EMAIL: "OBS-EMP-003",
  EMP_IMPORT_FAILED: "OBS-EMP-004",

  // Billing errors
  BILLING_QUOTA_EXCEEDED: "OBS-BILL-001",
  BILLING_CHECKOUT_FAILED: "OBS-BILL-002",
  BILLING_WEBHOOK_FAILED: "OBS-BILL-003",
  BILLING_NO_SUBSCRIPTION: "OBS-BILL-004",

  // Export errors
  EXPORT_FAILED: "OBS-EXP-001",

  // Coaching errors
  COACHING_NOT_FOUND: "OBS-COACH-001",
  COACHING_CREATE_FAILED: "OBS-COACH-002",

  // Admin errors
  ADMIN_USER_NOT_FOUND: "OBS-ADM-001",
  ADMIN_SETTINGS_FAILED: "OBS-ADM-002",
  ADMIN_INVITATION_FAILED: "OBS-ADM-003",

  // General errors
  INTERNAL_ERROR: "OBS-GEN-001",
  RATE_LIMITED: "OBS-GEN-002",
  VALIDATION_ERROR: "OBS-GEN-003",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Create a structured error response with an error code.
 * Use in route handlers: res.status(4xx).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"))
 */
export function errorResponse(code: ErrorCode, message: string, details?: string) {
  return {
    message,
    errorCode: code,
    ...(details ? { details } : {}),
  };
}
