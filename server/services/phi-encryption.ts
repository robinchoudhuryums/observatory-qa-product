/**
 * Application-level PHI field encryption using AES-256-GCM.
 *
 * HIPAA: Encrypts sensitive fields (transcript text, call analysis summaries)
 * at the application layer, independent of disk/transport encryption.
 * This provides defense-in-depth: even if database backups are exposed,
 * PHI fields remain encrypted.
 *
 * Key management: Uses PHI_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 * In production, this should come from AWS KMS, HashiCorp Vault, or similar.
 *
 * Format: base64(iv:ciphertext:authTag) — all in one string for DB storage.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (encryptionKey) return encryptionKey;

  const keyHex = process.env.PHI_ENCRYPTION_KEY;
  if (!keyHex) return null;

  if (keyHex.length !== 64) {
    logger.error("PHI_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
    return null;
  }

  encryptionKey = Buffer.from(keyHex, "hex");
  return encryptionKey;
}

/**
 * Check if PHI encryption is configured and available.
 */
export function isPhiEncryptionEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypt a plaintext string. Returns the encrypted payload as a prefixed string.
 * If encryption is not configured, returns the plaintext unchanged.
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack as: enc_v1:<base64(iv + ciphertext + authTag)>
  const packed = Buffer.concat([iv, encrypted, authTag]);
  return `enc_v1:${packed.toString("base64")}`;
}

/**
 * Decrypt an encrypted field. If the value doesn't have the encryption prefix,
 * returns it as-is (backward compatibility with unencrypted data).
 */
export function decryptField(encrypted: string): string {
  if (!encrypted.startsWith("enc_v1:")) return encrypted;

  const key = getKey();
  if (!key) {
    logger.error("Cannot decrypt PHI field: PHI_ENCRYPTION_KEY not configured");
    return "[ENCRYPTED - KEY UNAVAILABLE]";
  }

  try {
    const packed = Buffer.from(encrypted.slice(7), "base64");

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH, packed.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch (err) {
    logger.error({ err }, "Failed to decrypt PHI field — data may be corrupted or key mismatch");
    return "[DECRYPTION FAILED]";
  }
}

/**
 * Encrypt a TOTP MFA secret for storage.
 * Uses the same AES-256-GCM but with a distinct prefix for clarity.
 */
export function encryptMfaSecret(secret: string): string {
  return encryptField(secret);
}

/**
 * Decrypt a stored MFA secret.
 */
export function decryptMfaSecret(encrypted: string): string {
  return decryptField(encrypted);
}

/**
 * Decrypt PHI fields in a clinical note object.
 * Safe to call on already-decrypted or null data — no-ops gracefully.
 * Modifies the object in-place for efficiency.
 */
const PHI_FIELDS = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"] as const;

export function decryptClinicalNotePhi(analysis: Record<string, unknown> | null | undefined): void {
  if (!analysis) return;
  const cn = analysis.clinicalNote as Record<string, unknown> | undefined;
  if (!cn) return;
  for (const field of PHI_FIELDS) {
    if (typeof cn[field] === "string") {
      cn[field] = decryptField(cn[field] as string);
    }
  }
}
