/**
 * Embedding generation service using Amazon Titan Embed V2 via Bedrock.
 *
 * Uses raw REST API with SigV4 signing — consistent with the existing
 * bedrock.ts and s3.ts approach (no AWS SDK dependency).
 *
 * Model: amazon.titan-embed-text-v2:0
 * Dimensions: 1024 (normalized)
 * Max input: 8,192 tokens (~8,000 characters with safety margin)
 */
import { createHmac, createHash } from "crypto";
import { logger } from "./logger";

const EMBED_MODEL = "amazon.titan-embed-text-v2:0";
const EMBED_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 8000;
const BATCH_SIZE = 20; // Concurrent embeddings per batch

// --- Embedding cache (deduplicates identical queries) ---
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedEmbedding {
  embedding: number[];
  expiresAt: number;
}
const embeddingCache = new Map<string, CachedEmbedding>();

// Prune expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(embeddingCache)) {
    if (now > entry.expiresAt) embeddingCache.delete(key);
  }
}, 10 * 60 * 1000).unref();

function getCacheKey(text: string): string {
  return createHash("sha256").update(text.slice(0, MAX_INPUT_CHARS)).digest("hex");
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

function getCredentials(): AwsCredentials | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION || "us-east-1",
  };
}

/**
 * Generate a single embedding vector for text input.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const creds = getCredentials();
  if (!creds) throw new Error("AWS credentials not configured for embeddings");

  // Truncate to model's input limit
  const inputText = text.slice(0, MAX_INPUT_CHARS);

  // Check cache first (deduplicates identical queries within TTL)
  const cacheKey = getCacheKey(inputText);
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.embedding;
  }

  const host = `bedrock-runtime.${creds.region}.amazonaws.com`;
  const rawPath = `/model/${EMBED_MODEL}/invoke`;
  const url = `https://${host}${rawPath}`;

  const body = JSON.stringify({
    inputText,
    dimensions: EMBED_DIMENSIONS,
    normalize: true,
  });

  const headers = signRequest("POST", host, rawPath, body, creds);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bedrock Embedding API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json() as { embedding: number[] };
    const embedding = result.embedding;

    // Cache the result (evict oldest if at capacity)
    if (embeddingCache.size >= CACHE_MAX_SIZE) {
      const oldest = embeddingCache.keys().next().value;
      if (oldest) embeddingCache.delete(oldest);
    }
    embeddingCache.set(cacheKey, { embedding, expiresAt: Date.now() + CACHE_TTL_MS });

    return embedding;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate embeddings for multiple texts in batches.
 * Processes BATCH_SIZE texts concurrently within each batch.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    logger.info(`Generating embeddings batch ${i}–${i + batch.length} of ${texts.length}`);

    const batchResults = await Promise.all(
      batch.map((text) => generateEmbedding(text)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}

/**
 * Check if embedding generation is available (AWS credentials configured).
 */
export function isEmbeddingAvailable(): boolean {
  return getCredentials() !== null;
}

// --- AWS Signature V4 (same pattern as bedrock.ts and s3.ts) ---

function signRequest(
  method: string,
  host: string,
  rawPath: string,
  body: string,
  creds: AwsCredentials,
): Record<string, string> {
  const service = "bedrock";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256(body);

  const canonicalUri = rawPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    (creds.sessionToken ? `x-amz-security-token:${creds.sessionToken}\n` : "");

  const signedHeaders = creds.sessionToken
    ? "content-type;host;x-amz-date;x-amz-security-token"
    : "content-type;host;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, creds.region, service);
  const signature = hmacHex(signingKey, stringToSign);

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Host": host,
    "X-Amz-Date": amzDate,
    "Authorization": authHeader,
  };
  if (creds.sessionToken) {
    headers["X-Amz-Security-Token"] = creds.sessionToken;
  }
  return headers;
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
