/**
 * Tests for HIPAA audit log utilities.
 * Tests the pure functions (integrity hashing, context extraction)
 * without requiring a database connection.
 *
 * Run with: npx tsx --test tests/audit-log.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { auditContext, type AuditEntry } from "../server/services/audit-log.js";

describe("Audit Log", () => {
  describe("AuditEntry interface", () => {
    it("accepts a minimal entry", () => {
      const entry: AuditEntry = {
        event: "phi_access",
        resourceType: "call",
      };
      assert.equal(entry.event, "phi_access");
      assert.equal(entry.resourceType, "call");
    });

    it("accepts a full entry with all fields", () => {
      const entry: AuditEntry = {
        timestamp: "2024-01-01T00:00:00.000Z",
        event: "phi_access",
        orgId: "org-1",
        userId: "user-1",
        username: "admin",
        role: "admin",
        resourceType: "transcript",
        resourceId: "call-123",
        ip: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        detail: "Viewed transcript",
      };
      assert.equal(entry.orgId, "org-1");
      assert.equal(entry.userId, "user-1");
    });
  });

  describe("auditContext", () => {
    it("extracts user info from request object", () => {
      const mockReq = {
        user: {
          id: "user-123",
          username: "jdoe",
          role: "admin",
          orgId: "org-456",
        },
        headers: {
          "x-forwarded-for": "10.0.0.1, 192.168.1.1",
          "user-agent": "TestAgent/1.0",
        },
        socket: { remoteAddress: "127.0.0.1" },
      };

      const ctx = auditContext(mockReq);
      assert.equal(ctx.orgId, "org-456");
      assert.equal(ctx.userId, "user-123");
      assert.equal(ctx.username, "jdoe");
      assert.equal(ctx.role, "admin");
      assert.equal(ctx.ip, "10.0.0.1"); // First IP from x-forwarded-for
      assert.equal(ctx.userAgent, "TestAgent/1.0");
    });

    it("falls back to req.orgId when user.orgId is missing", () => {
      const mockReq = {
        user: { id: "user-1", username: "test" },
        orgId: "fallback-org",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      };

      const ctx = auditContext(mockReq);
      assert.equal(ctx.orgId, "fallback-org");
    });

    it("falls back to socket remoteAddress when x-forwarded-for is missing", () => {
      const mockReq = {
        user: { id: "user-1" },
        headers: {},
        socket: { remoteAddress: "192.168.0.100" },
      };

      const ctx = auditContext(mockReq);
      assert.equal(ctx.ip, "192.168.0.100");
    });

    it("handles missing user gracefully", () => {
      const mockReq = {
        user: undefined,
        headers: { "user-agent": "Bot" },
        socket: { remoteAddress: "0.0.0.0" },
      };

      const ctx = auditContext(mockReq);
      assert.equal(ctx.userId, undefined);
      assert.equal(ctx.username, undefined);
      assert.equal(ctx.role, undefined);
    });
  });

  describe("integrity hash computation", () => {
    // Replicate the hash logic to verify it's deterministic
    function computeIntegrityHash(
      prevHash: string,
      entry: { orgId: string; event: string; userId?: string; username?: string; resourceType: string; resourceId?: string; detail?: string; timestamp: string; sequenceNum: number },
    ): string {
      const payload = JSON.stringify({
        prevHash,
        orgId: entry.orgId,
        event: entry.event,
        userId: entry.userId || "",
        username: entry.username || "",
        resourceType: entry.resourceType,
        resourceId: entry.resourceId || "",
        detail: entry.detail || "",
        timestamp: entry.timestamp,
        sequenceNum: entry.sequenceNum,
      });
      return createHash("sha256").update(payload).digest("hex");
    }

    it("produces a 64-char hex SHA-256 hash", () => {
      const hash = computeIntegrityHash("genesis", {
        orgId: "org-1",
        event: "phi_access",
        resourceType: "call",
        timestamp: "2024-01-01T00:00:00.000Z",
        sequenceNum: 1,
      });
      assert.equal(hash.length, 64);
      assert.match(hash, /^[a-f0-9]{64}$/);
    });

    it("is deterministic (same input = same output)", () => {
      const entry = {
        orgId: "org-1",
        event: "phi_access",
        userId: "user-1",
        username: "admin",
        resourceType: "transcript",
        resourceId: "call-123",
        detail: "Viewed",
        timestamp: "2024-01-01T00:00:00.000Z",
        sequenceNum: 1,
      };
      const hash1 = computeIntegrityHash("genesis", entry);
      const hash2 = computeIntegrityHash("genesis", entry);
      assert.equal(hash1, hash2);
    });

    it("changes when any field changes", () => {
      const base = {
        orgId: "org-1",
        event: "phi_access",
        resourceType: "call",
        timestamp: "2024-01-01T00:00:00.000Z",
        sequenceNum: 1,
      };

      const hash1 = computeIntegrityHash("genesis", base);

      // Change orgId
      const hash2 = computeIntegrityHash("genesis", { ...base, orgId: "org-2" });
      assert.notEqual(hash1, hash2);

      // Change event
      const hash3 = computeIntegrityHash("genesis", { ...base, event: "phi_modify" });
      assert.notEqual(hash1, hash3);

      // Change timestamp
      const hash4 = computeIntegrityHash("genesis", { ...base, timestamp: "2024-01-02T00:00:00.000Z" });
      assert.notEqual(hash1, hash4);

      // Change sequenceNum
      const hash5 = computeIntegrityHash("genesis", { ...base, sequenceNum: 2 });
      assert.notEqual(hash1, hash5);
    });

    it("forms a chain (hash N depends on hash N-1)", () => {
      const entry1 = {
        orgId: "org-1",
        event: "access",
        resourceType: "call",
        timestamp: "2024-01-01T00:00:00.000Z",
        sequenceNum: 1,
      };
      const hash1 = computeIntegrityHash("genesis", entry1);

      const entry2 = {
        orgId: "org-1",
        event: "access",
        resourceType: "call",
        timestamp: "2024-01-01T00:01:00.000Z",
        sequenceNum: 2,
      };
      const hash2 = computeIntegrityHash(hash1, entry2);

      // If we tamper with hash1, hash2 should be different
      const hash2Tampered = computeIntegrityHash("tampered", entry2);
      assert.notEqual(hash2, hash2Tampered);
    });
  });
});
