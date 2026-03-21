/**
 * AWS Credential Provider
 *
 * Resolves credentials in priority order:
 *   1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 *   2. EC2 IMDSv2 instance profile (automatic on EC2 instances)
 *
 * IMDSv2 credentials auto-refresh before expiry (5 minutes buffer).
 * Credentials from env vars are trimmed to prevent SigV4 signing failures
 * from trailing whitespace.
 *
 * Usage:
 *   const creds = await getAwsCredentials();
 *   if (creds) { // use creds.accessKeyId, creds.secretAccessKey, etc. }
 */
import { createHash, createHmac } from "crypto";
import { logger } from "./logger";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  source: "env" | "imdsv2";
  expiresAt?: Date;
}

const DEFAULT_REGION = "us-east-1";
const IMDS_TOKEN_TTL = 21600; // 6 hours
const IMDS_BASE = "http://169.254.169.254";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

let cachedCredentials: AwsCredentials | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Attempt to get credentials from environment variables.
 */
function getEnvCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!accessKeyId || !secretAccessKey) return null;

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
    region: process.env.AWS_REGION?.trim() || DEFAULT_REGION,
    source: "env",
  };
}

/**
 * Get an IMDSv2 token (required for all IMDS requests on IMDSv2-enabled instances).
 */
async function getImdsToken(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${IMDS_BASE}/latest/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": String(IMDS_TOKEN_TTL) },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null; // Not on EC2 or IMDS disabled
  }
}

/**
 * Fetch credentials from EC2 instance profile via IMDSv2.
 */
async function getImdsCredentials(): Promise<AwsCredentials | null> {
  const token = await getImdsToken();
  if (!token) return null;

  try {
    const headers = { "X-aws-ec2-metadata-token": token };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    // Get the IAM role name
    const roleRes = await fetch(
      `${IMDS_BASE}/latest/meta-data/iam/security-credentials/`,
      { headers, signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!roleRes.ok) return null;
    const roleName = (await roleRes.text()).trim();
    if (!roleName) return null;

    // Get credentials for the role
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 3000);
    const credRes = await fetch(
      `${IMDS_BASE}/latest/meta-data/iam/security-credentials/${roleName}`,
      { headers, signal: controller2.signal },
    );
    clearTimeout(timeout2);

    if (!credRes.ok) return null;
    const creds = await credRes.json();

    if (creds.Code !== "Success") return null;

    // Get region from instance identity
    let region = DEFAULT_REGION;
    try {
      const controller3 = new AbortController();
      const timeout3 = setTimeout(() => controller3.abort(), 2000);
      const regionRes = await fetch(
        `${IMDS_BASE}/latest/meta-data/placement/region`,
        { headers, signal: controller3.signal },
      );
      clearTimeout(timeout3);
      if (regionRes.ok) region = (await regionRes.text()).trim();
    } catch { /* fall back to default region */ }

    return {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.Token,
      region: process.env.AWS_REGION?.trim() || region,
      source: "imdsv2",
      expiresAt: new Date(creds.Expiration),
    };
  } catch {
    return null;
  }
}

/**
 * Schedule credential refresh before expiry.
 */
function scheduleRefresh(expiresAt: Date): void {
  if (refreshTimer) clearTimeout(refreshTimer);

  const refreshIn = Math.max(0, expiresAt.getTime() - Date.now() - REFRESH_BUFFER_MS);
  refreshTimer = setTimeout(async () => {
    logger.info("Refreshing IMDSv2 credentials before expiry");
    const newCreds = await getImdsCredentials();
    if (newCreds) {
      cachedCredentials = newCreds;
      if (newCreds.expiresAt) scheduleRefresh(newCreds.expiresAt);
      logger.info({ expiresAt: newCreds.expiresAt?.toISOString() }, "IMDSv2 credentials refreshed");
    } else {
      logger.error("Failed to refresh IMDSv2 credentials");
    }
  }, refreshIn);
  refreshTimer.unref();
}

/**
 * Get AWS credentials. Resolves once on first call, returns cached after.
 * Returns null if no credentials are available.
 */
export async function getAwsCredentials(): Promise<AwsCredentials | null> {
  // Return cached if still valid
  if (cachedCredentials) {
    if (!cachedCredentials.expiresAt) return cachedCredentials; // env creds don't expire
    if (cachedCredentials.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
      return cachedCredentials;
    }
    // Expired or about to expire — re-fetch
  }

  // 1. Try environment variables
  const envCreds = getEnvCredentials();
  if (envCreds) {
    cachedCredentials = envCreds;
    logger.info({ source: "env", region: envCreds.region }, "AWS credentials loaded from environment");
    return envCreds;
  }

  // 2. Try EC2 IMDSv2
  const imdsCreds = await getImdsCredentials();
  if (imdsCreds) {
    cachedCredentials = imdsCreds;
    if (imdsCreds.expiresAt) scheduleRefresh(imdsCreds.expiresAt);
    logger.info({
      source: "imdsv2",
      region: imdsCreds.region,
      expiresAt: imdsCreds.expiresAt?.toISOString(),
    }, "AWS credentials loaded from EC2 instance profile");
    return imdsCreds;
  }

  logger.warn("No AWS credentials available (checked env vars and IMDSv2)");
  return null;
}

/**
 * Force refresh credentials (useful after a 403 error).
 */
export async function refreshAwsCredentials(): Promise<AwsCredentials | null> {
  cachedCredentials = null;
  return getAwsCredentials();
}

// --- Shared SigV4 crypto helpers (used by s3.ts, bedrock.ts, embeddings.ts) ---

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

export function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
