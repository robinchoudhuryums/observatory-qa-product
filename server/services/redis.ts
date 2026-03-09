/**
 * Redis client and utilities for multi-tenant SaaS.
 *
 * Provides:
 * - Shared Redis connection (for sessions, rate limiting, pub/sub)
 * - Session store factory (connect-redis)
 * - Distributed rate limiter (replaces in-memory Map)
 * - Pub/Sub for cross-instance WebSocket broadcasting
 *
 * Falls back gracefully when REDIS_URL is not configured.
 */
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import type session from "express-session";
import { logger } from "./logger";

let redisClient: Redis | null = null;
let subscriberClient: Redis | null = null;

/**
 * Initialize Redis connection. Returns null if REDIS_URL is not set.
 */
export function initRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — using in-memory fallbacks for sessions and rate limiting");
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
      // TLS is negotiated automatically when REDIS_URL uses the rediss:// scheme
    });

    redisClient.on("error", (err) => {
      logger.error({ err }, "Redis connection error");
    });

    redisClient.on("connect", () => {
      logger.info("Redis connected");
    });

    return redisClient;
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize Redis");
    return null;
  }
}

/**
 * Get the Redis client instance. Returns null if not initialized.
 */
export function getRedis(): Redis | null {
  return redisClient;
}

/**
 * Adapter that wraps an ioredis client to match the node-redis v5 API
 * expected by connect-redis v9 (which passes { expiration: { type, value } }
 * to set() instead of positional "EX", ttl args).
 */
function ioredisAdapter(client: Redis) {
  return {
    get: (key: string) => client.get(key),
    set: (key: string, val: string, opts?: { expiration?: { type: string; value: number } }) => {
      if (opts?.expiration) {
        return client.set(key, val, opts.expiration.type as "EX", opts.expiration.value);
      }
      return client.set(key, val);
    },
    del: (key: string) => client.del(key),
    expire: (key: string, ttl: number) => client.expire(key, ttl),
    scanIterator: (opts: { MATCH: string; COUNT: number }) => {
      // connect-redis uses this for destroy-all; provide a basic async iterator
      let cursor = "0";
      let done = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              const [nextCursor, keys] = await client.scan(
                cursor, "MATCH", opts.MATCH, "COUNT", opts.COUNT,
              );
              cursor = nextCursor;
              if (cursor === "0") done = true;
              return { done: false, value: keys };
            },
          };
        },
      };
    },
  };
}

/**
 * Create a Redis-backed session store (connect-redis).
 * Falls back to null if Redis is unavailable (caller should use MemoryStore).
 */
export function createRedisSessionStore(sessionModule: typeof session): InstanceType<typeof RedisStore> | null {
  if (!redisClient) return null;

  try {
    const store = new RedisStore({
      client: ioredisAdapter(redisClient) as any,
      prefix: "observatory:sess:",
      ttl: 15 * 60, // 15 min idle timeout (matches HIPAA session config)
    });
    logger.info("Redis session store initialized");
    return store;
  } catch (error) {
    logger.error({ err: error }, "Failed to create Redis session store");
    return null;
  }
}

/**
 * Distributed rate limiter backed by Redis.
 * Uses sliding window algorithm for accurate rate limiting across instances.
 */
export async function checkRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  if (!redisClient) {
    // Fallback: always allow (in-memory rate limiter handles this case)
    return { allowed: true, remaining: maxRequests, resetMs: 0 };
  }

  const windowKey = `observatory:rl:${key}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Use a Redis pipeline for atomicity
    const pipeline = redisClient.pipeline();
    // Remove old entries outside the window
    pipeline.zremrangebyscore(windowKey, 0, windowStart);
    // Count current entries
    pipeline.zcard(windowKey);
    // Add current request
    pipeline.zadd(windowKey, now.toString(), `${now}:${Math.random()}`);
    // Set expiry on the key
    pipeline.pexpire(windowKey, windowMs);

    const results = await pipeline.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;

    if (currentCount >= maxRequests) {
      // Get the oldest entry to determine reset time
      const oldest = await redisClient.zrange(windowKey, 0, 0, "WITHSCORES");
      const resetMs = oldest.length >= 2 ? parseInt(oldest[1]) + windowMs - now : windowMs;
      return { allowed: false, remaining: 0, resetMs };
    }

    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetMs: windowMs,
    };
  } catch (error) {
    logger.error({ err: error }, "Redis rate limit check failed — allowing request");
    return { allowed: true, remaining: maxRequests, resetMs: 0 };
  }
}

/**
 * Get a Redis subscriber client for pub/sub (separate connection required by Redis).
 */
export function getSubscriberClient(): Redis | null {
  if (!redisClient) return null;

  if (!subscriberClient) {
    subscriberClient = redisClient.duplicate();
    subscriberClient.on("error", (err) => {
      logger.error({ err }, "Redis subscriber error");
    });
  }
  return subscriberClient;
}

/**
 * Publish a message to a Redis channel (for cross-instance WebSocket broadcasting).
 */
export async function publishMessage(channel: string, message: string): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.publish(channel, message);
  } catch (error) {
    logger.error({ err: error, channel }, "Failed to publish Redis message");
  }
}

/**
 * Clean up Redis connections on shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (subscriberClient) {
    await subscriberClient.quit();
    subscriberClient = null;
  }
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  logger.info("Redis connections closed");
}
