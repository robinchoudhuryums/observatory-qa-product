/**
 * Tests for PHI field-level encryption (AES-256-GCM).
 * HIPAA requirement: verify encrypt/decrypt round-trip, key validation,
 * graceful fallback when unconfigured, and tamper detection.
 *
 * Run with: npx tsx --test tests/phi-encryption.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Valid 64-char hex key (32 bytes) for testing
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ALT_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("PHI Encryption", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.PHI_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.PHI_ENCRYPTION_KEY = savedKey;
    } else {
      delete process.env.PHI_ENCRYPTION_KEY;
    }
  });

  /**
   * Helper to get a fresh module (bypasses cached encryptionKey).
   */
  async function loadModule() {
    // Force fresh import by busting the module cache
    const modulePath = `../server/services/phi-encryption.js?t=${Date.now()}-${Math.random()}`;
    return await import(modulePath);
  }

  describe("isPhiEncryptionEnabled", () => {
    it("returns false when PHI_ENCRYPTION_KEY is not set", async () => {
      delete process.env.PHI_ENCRYPTION_KEY;
      const mod = await loadModule();
      assert.equal(mod.isPhiEncryptionEnabled(), false);
    });

    it("returns true when a valid 64-char hex key is set", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();
      assert.equal(mod.isPhiEncryptionEnabled(), true);
    });

    it("returns false when key is wrong length", async () => {
      process.env.PHI_ENCRYPTION_KEY = "tooshort";
      const mod = await loadModule();
      assert.equal(mod.isPhiEncryptionEnabled(), false);
    });
  });

  describe("encryptField / decryptField round-trip", () => {
    it("encrypts and decrypts back to original plaintext", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const plaintext = "Patient John Doe, DOB 1990-01-15, diagnosed with condition X";
      const encrypted = mod.encryptField(plaintext);

      assert.notEqual(encrypted, plaintext, "Encrypted value should differ from plaintext");
      assert.ok(encrypted.startsWith("enc_v1:"), "Should have enc_v1 prefix");

      const decrypted = mod.decryptField(encrypted);
      assert.equal(decrypted, plaintext);
    });

    it("handles empty string", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const encrypted = mod.encryptField("");
      const decrypted = mod.decryptField(encrypted);
      assert.equal(decrypted, "");
    });

    it("handles unicode text", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const plaintext = "Paciente: María García-López, diagnóstico: 日本語テスト 🏥";
      const encrypted = mod.encryptField(plaintext);
      const decrypted = mod.decryptField(encrypted);
      assert.equal(decrypted, plaintext);
    });

    it("handles long text (multi-paragraph clinical note)", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const plaintext = "SOAP Note:\n".repeat(500) + "Assessment: Complex multi-system...\n".repeat(100);
      const encrypted = mod.encryptField(plaintext);
      const decrypted = mod.decryptField(encrypted);
      assert.equal(decrypted, plaintext);
    });

    it("produces different ciphertext each time (random IV)", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const plaintext = "Same input every time";
      const enc1 = mod.encryptField(plaintext);
      const enc2 = mod.encryptField(plaintext);

      assert.notEqual(enc1, enc2, "Two encryptions of the same plaintext should differ (random IV)");

      // Both should decrypt to the same value
      assert.equal(mod.decryptField(enc1), plaintext);
      assert.equal(mod.decryptField(enc2), plaintext);
    });
  });

  describe("passthrough when unconfigured", () => {
    it("encryptField returns plaintext when key is not set", async () => {
      delete process.env.PHI_ENCRYPTION_KEY;
      const mod = await loadModule();

      const plaintext = "Unencrypted PHI data";
      assert.equal(mod.encryptField(plaintext), plaintext);
    });

    it("decryptField returns plaintext for non-prefixed strings", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const plaintext = "Legacy unencrypted data";
      assert.equal(mod.decryptField(plaintext), plaintext);
    });
  });

  describe("decryption failure handling", () => {
    it("returns error placeholder when key is missing for encrypted data", async () => {
      // Encrypt with a key
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod1 = await loadModule();
      const encrypted = mod1.encryptField("Secret data");

      // Try to decrypt without a key
      delete process.env.PHI_ENCRYPTION_KEY;
      const mod2 = await loadModule();
      const result = mod2.decryptField(encrypted);
      assert.equal(result, "[ENCRYPTED - KEY UNAVAILABLE]");
    });

    it("returns error placeholder for corrupted ciphertext", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const result = mod.decryptField("enc_v1:dGhpcyBpcyBub3QgdmFsaWQgY2lwaGVydGV4dA==");
      assert.equal(result, "[DECRYPTION FAILED]");
    });

    it("returns error placeholder for tampered ciphertext", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const encrypted = mod.encryptField("Original data");
      // Tamper with the base64 payload
      const tampered = encrypted.slice(0, -5) + "XXXXX";
      const result = mod.decryptField(tampered);
      assert.equal(result, "[DECRYPTION FAILED]");
    });
  });

  describe("MFA secret helpers", () => {
    it("encryptMfaSecret and decryptMfaSecret round-trip", async () => {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
      const mod = await loadModule();

      const secret = "JBSWY3DPEHPK3PXP";
      const encrypted = mod.encryptMfaSecret(secret);
      assert.ok(encrypted.startsWith("enc_v1:"));

      const decrypted = mod.decryptMfaSecret(encrypted);
      assert.equal(decrypted, secret);
    });
  });
});
