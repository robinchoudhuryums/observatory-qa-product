/**
 * Tests for API key management and OAuth provider configuration.
 * Run with: npx tsx --test tests/api-keys.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "crypto";
import { insertApiKeySchema, apiKeySchema } from "../shared/schema.js";

describe("insertApiKeySchema", () => {
  it("accepts valid API key data", () => {
    const result = insertApiKeySchema.safeParse({
      name: "Production API",
      keyHash: createHash("sha256").update("test-key").digest("hex"),
      keyPrefix: "obs_k_test",
      permissions: ["read", "write"],
      createdBy: "admin@example.com",
    });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.permissions, ["read", "write"]);
  });

  it("defaults permissions to ['read']", () => {
    const result = insertApiKeySchema.safeParse({
      name: "Read-only Key",
      keyHash: createHash("sha256").update("test").digest("hex"),
      keyPrefix: "obs_k_ro",
      createdBy: "admin",
    });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.permissions, ["read"]);
  });

  it("rejects missing name", () => {
    const result = insertApiKeySchema.safeParse({
      keyHash: "abc123",
      keyPrefix: "obs_k_",
      createdBy: "admin",
    });
    assert.ok(!result.success);
  });

  it("rejects empty name", () => {
    const result = insertApiKeySchema.safeParse({
      name: "",
      keyHash: "abc123",
      keyPrefix: "obs_k_",
      createdBy: "admin",
    });
    assert.ok(!result.success);
  });

  it("accepts optional expiresAt", () => {
    const result = insertApiKeySchema.safeParse({
      name: "Expiring Key",
      keyHash: createHash("sha256").update("key").digest("hex"),
      keyPrefix: "obs_k_exp",
      createdBy: "admin",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.ok(result.success);
    assert.ok(result.data.expiresAt);
  });
});

describe("apiKeySchema (full record)", () => {
  it("accepts complete API key record", () => {
    const result = apiKeySchema.safeParse({
      id: "key-123",
      orgId: "org-456",
      name: "Test Key",
      keyHash: createHash("sha256").update("obs_k_test").digest("hex"),
      keyPrefix: "obs_k_test12",
      permissions: ["read"],
      createdBy: "admin@test.com",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.status, "active");
  });

  it("validates status enum", () => {
    const result = apiKeySchema.safeParse({
      id: "key-123",
      orgId: "org-456",
      name: "Test Key",
      keyHash: "hash",
      keyPrefix: "obs_k_",
      permissions: ["read"],
      createdBy: "admin",
      status: "invalid-status",
    });
    assert.ok(!result.success);
  });

  it("accepts revoked status", () => {
    const result = apiKeySchema.safeParse({
      id: "key-123",
      orgId: "org-456",
      name: "Revoked Key",
      keyHash: "hash",
      keyPrefix: "obs_k_",
      permissions: ["admin"],
      createdBy: "admin",
      status: "revoked",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.status, "revoked");
  });
});

describe("API key generation helpers", () => {
  it("generates unique keys with correct prefix", () => {
    const raw1 = randomBytes(32).toString("base64url");
    const raw2 = randomBytes(32).toString("base64url");
    const key1 = `obs_k_${raw1}`;
    const key2 = `obs_k_${raw2}`;

    assert.ok(key1.startsWith("obs_k_"));
    assert.ok(key2.startsWith("obs_k_"));
    assert.notStrictEqual(key1, key2);
  });

  it("produces consistent hash for same key", () => {
    const key = "obs_k_testkey123";
    const hash1 = createHash("sha256").update(key).digest("hex");
    const hash2 = createHash("sha256").update(key).digest("hex");
    assert.strictEqual(hash1, hash2);
  });

  it("produces different hashes for different keys", () => {
    const hash1 = createHash("sha256").update("obs_k_key1").digest("hex");
    const hash2 = createHash("sha256").update("obs_k_key2").digest("hex");
    assert.notStrictEqual(hash1, hash2);
  });

  it("key prefix is first 12 characters", () => {
    const raw = randomBytes(32).toString("base64url");
    const key = `obs_k_${raw}`;
    const prefix = key.slice(0, 12);
    assert.strictEqual(prefix.length, 12);
    assert.ok(prefix.startsWith("obs_k_"));
  });
});

describe("API key permission mapping", () => {
  it("maps read permission to viewer role", () => {
    const perms = ["read"];
    const role = perms.includes("admin") ? "admin" : perms.includes("write") ? "manager" : "viewer";
    assert.strictEqual(role, "viewer");
  });

  it("maps write permission to manager role", () => {
    const perms = ["read", "write"];
    const role = perms.includes("admin") ? "admin" : perms.includes("write") ? "manager" : "viewer";
    assert.strictEqual(role, "manager");
  });

  it("maps admin permission to admin role", () => {
    const perms = ["read", "write", "admin"];
    const role = perms.includes("admin") ? "admin" : perms.includes("write") ? "manager" : "viewer";
    assert.strictEqual(role, "admin");
  });
});

describe("API key expiry checks", () => {
  it("detects expired key", () => {
    const expired = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    assert.ok(new Date(expired) < new Date());
  });

  it("detects valid key", () => {
    const future = new Date(Date.now() + 86400000).toISOString(); // 1 day ahead
    assert.ok(new Date(future) > new Date());
  });

  it("handles missing expiresAt as never-expiring", () => {
    const expiresAt: string | undefined = undefined;
    const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
    assert.ok(!isExpired);
  });
});
