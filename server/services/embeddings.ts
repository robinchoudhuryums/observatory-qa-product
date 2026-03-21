/**
 * Embedding generation service using Amazon Titan Embed V2 via Bedrock.
 *
 * Uses @aws-sdk/client-bedrock-runtime InvokeModelCommand.
 *
 * Model: amazon.titan-embed-text-v2:0
 * Dimensions: 1024 (normalized)
 * Max input: 8,192 tokens (~8,000 characters with safety margin)
 */
import { createHash } from "crypto";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { logger } from "./logger";

const EMBED_MODEL = "amazon.titan-embed-text-v2:0";
const EMBED_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 8000;
const BATCH_SIZE = 20; // Concurrent embeddings per batch
const EMBED_TIMEOUT_MS = 30_000; // 30 seconds

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

/**
 * Create a BedrockRuntimeClient for embeddings.
 * Returns null if no AWS credentials are configured.
 */
function createEmbeddingClient(): BedrockRuntimeClient | null {
  const region = process.env.AWS_REGION || "us-east-1";

  let credentials: AwsCredentialIdentityProvider;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    credentials = fromEnv();
  } else {
    // Fall back to EC2 instance metadata (IMDSv2)
    // Note: isEmbeddingAvailable() checks env vars only for a quick sync check;
    // on EC2 this client will still work via instance profile
    credentials = fromInstanceMetadata({ timeout: 3000, maxRetries: 1 });
  }

  return new BedrockRuntimeClient({
    region,
    credentials,
    requestHandler: {
      requestTimeout: EMBED_TIMEOUT_MS,
    } as any,
  });
}

// Lazily initialized client singleton
let _client: BedrockRuntimeClient | null | undefined;
function getClient(): BedrockRuntimeClient | null {
  if (_client === undefined) {
    try {
      _client = createEmbeddingClient();
    } catch {
      _client = null;
    }
  }
  return _client;
}

/**
 * Generate a single embedding vector for text input.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  if (!client) throw new Error("AWS credentials not configured for embeddings");

  // Truncate to model's input limit
  const inputText = text.slice(0, MAX_INPUT_CHARS);

  // Check cache first (deduplicates identical queries within TTL)
  const cacheKey = getCacheKey(inputText);
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.embedding;
  }

  const body = JSON.stringify({
    inputText,
    dimensions: EMBED_DIMENSIONS,
    normalize: true,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const command = new InvokeModelCommand({
      modelId: EMBED_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command, { abortSignal: controller.signal });

    const responseBody = new TextDecoder().decode(response.body);
    const result = JSON.parse(responseBody) as { embedding: number[] };
    const embedding = result.embedding;

    // Cache the result (evict oldest if at capacity)
    if (embeddingCache.size >= CACHE_MAX_SIZE) {
      const oldest = embeddingCache.keys().next().value;
      if (oldest) embeddingCache.delete(oldest);
    }
    embeddingCache.set(cacheKey, { embedding, expiresAt: Date.now() + CACHE_TTL_MS });

    return embedding;
  } catch (err: any) {
    const statusCode = err?.$metadata?.httpStatusCode || "unknown";
    throw new Error(`Bedrock Embedding API error (${statusCode}): ${(err?.message || "").substring(0, 200)}`);
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
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
