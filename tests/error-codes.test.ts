/**
 * Tests for standardized error codes and error response builder.
 *
 * Run with: npx tsx --test tests/error-codes.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, errorResponse, type ErrorCode } from "../server/services/error-codes.js";

describe("Error Codes", () => {
  describe("ERROR_CODES constant", () => {
    it("all codes follow OBS-{DOMAIN}-{NUMBER} format", () => {
      const pattern = /^OBS-[A-Z]+-\d{3}$/;
      for (const [key, code] of Object.entries(ERROR_CODES)) {
        assert.match(code, pattern, `Error code ${key} = "${code}" doesn't match expected format`);
      }
    });

    it("all codes are unique", () => {
      const codes = Object.values(ERROR_CODES);
      const uniqueCodes = new Set(codes);
      assert.equal(codes.length, uniqueCodes.size, "Error codes must be unique");
    });

    it("has auth error codes", () => {
      assert.ok(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      assert.ok(ERROR_CODES.AUTH_ACCOUNT_LOCKED);
      assert.ok(ERROR_CODES.AUTH_SESSION_EXPIRED);
      assert.ok(ERROR_CODES.AUTH_INSUFFICIENT_ROLE);
    });

    it("has call error codes", () => {
      assert.ok(ERROR_CODES.CALL_UPLOAD_FAILED);
      assert.ok(ERROR_CODES.CALL_NOT_FOUND);
      assert.ok(ERROR_CODES.CALL_PROCESSING_FAILED);
    });

    it("has billing error codes", () => {
      assert.ok(ERROR_CODES.BILLING_QUOTA_EXCEEDED);
      assert.ok(ERROR_CODES.BILLING_CHECKOUT_FAILED);
    });

    it("has general error codes", () => {
      assert.ok(ERROR_CODES.INTERNAL_ERROR);
      assert.ok(ERROR_CODES.RATE_LIMITED);
      assert.ok(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  describe("errorResponse", () => {
    it("creates response with code and message", () => {
      const resp = errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found");
      assert.deepEqual(resp, {
        message: "Call not found",
        errorCode: "OBS-CALL-002",
      });
    });

    it("includes details when provided", () => {
      const resp = errorResponse(ERROR_CODES.VALIDATION_ERROR, "Invalid input", "Field 'email' is required");
      assert.deepEqual(resp, {
        message: "Invalid input",
        errorCode: "OBS-GEN-003",
        details: "Field 'email' is required",
      });
    });

    it("omits details when not provided", () => {
      const resp = errorResponse(ERROR_CODES.INTERNAL_ERROR, "Server error");
      assert.ok(!("details" in resp), "Should not have details key");
    });

    it("returns correct structure for all error codes", () => {
      for (const [key, code] of Object.entries(ERROR_CODES)) {
        const resp = errorResponse(code as ErrorCode, `Test ${key}`);
        assert.equal(resp.errorCode, code);
        assert.equal(resp.message, `Test ${key}`);
      }
    });
  });
});
