/**
 * BullMQ job queue infrastructure for async processing.
 *
 * Replaces in-process fire-and-forget async tasks with durable,
 * retryable job queues. Jobs survive server restarts and can be
 * distributed across multiple worker processes.
 *
 * Queues:
 * - audio-processing: Transcription + AI analysis pipeline
 * - bulk-reanalysis: Re-analyze all calls for an org
 * - data-retention: Purge expired calls per org retention policy
 * - usage-metering: Track per-org usage events for billing
 *
 * Requires REDIS_URL to be set. Falls back to in-process execution
 * when Redis is unavailable (backward compatible with current behavior).
 */
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { logger } from "./logger";

// Job type definitions
export interface AudioProcessingJob {
  orgId: string;
  callId: string;
  fileName: string;
  callCategory?: string;
  uploadedBy?: string;
}

export interface BulkReanalysisJob {
  orgId: string;
  callIds?: string[]; // If empty, reanalyze all completed calls
  requestedBy: string;
}

export interface DataRetentionJob {
  orgId: string;
  retentionDays: number;
}

export interface UsageMeteringJob {
  orgId: string;
  eventType: "transcription" | "ai_analysis" | "storage_mb" | "api_call";
  quantity: number;
  metadata?: Record<string, unknown>;
}

// Queue instances
let audioQueue: Queue<AudioProcessingJob> | null = null;
let reanalysisQueue: Queue<BulkReanalysisJob> | null = null;
let retentionQueue: Queue<DataRetentionJob> | null = null;
let usageQueue: Queue<UsageMeteringJob> | null = null;

// Connection config
let connection: ConnectionOptions | null = null;

/**
 * Initialize BullMQ queues. Requires REDIS_URL.
 * Returns true if queues were initialized, false if Redis unavailable.
 */
export function initQueues(): boolean {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — job queues unavailable, using in-process execution");
    return false;
  }

  try {
    // Parse Redis URL for BullMQ connection
    const url = new URL(redisUrl);
    connection = {
      host: url.hostname,
      port: parseInt(url.port || "6379"),
      password: url.password || undefined,
      ...(process.env.NODE_ENV === "production" ? { tls: {} } : {}),
    };

    const defaultOpts = {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    };

    audioQueue = new Queue<AudioProcessingJob>("audio-processing", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      },
    });

    reanalysisQueue = new Queue<BulkReanalysisJob>("bulk-reanalysis", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 1, // Don't retry bulk ops
      },
    });

    retentionQueue = new Queue<DataRetentionJob>("data-retention", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
      },
    });

    usageQueue = new Queue<UsageMeteringJob>("usage-metering", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 3,
        backoff: { type: "fixed", delay: 2000 },
      },
    });

    logger.info("BullMQ queues initialized");
    return true;
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize BullMQ queues");
    return false;
  }
}

// --- Queue accessors ---

export function getAudioQueue(): Queue<AudioProcessingJob> | null {
  return audioQueue;
}

export function getReanalysisQueue(): Queue<BulkReanalysisJob> | null {
  return reanalysisQueue;
}

export function getRetentionQueue(): Queue<DataRetentionJob> | null {
  return retentionQueue;
}

export function getUsageQueue(): Queue<UsageMeteringJob> | null {
  return usageQueue;
}

/**
 * Enqueue a usage metering event. Fire-and-forget.
 * Falls back to logging when queues are unavailable.
 */
export async function trackUsage(event: UsageMeteringJob): Promise<void> {
  if (usageQueue) {
    try {
      await usageQueue.add("usage", event);
    } catch (error) {
      logger.error({ err: error, event }, "Failed to enqueue usage event");
    }
  } else {
    // Fallback: just log it
    logger.info({ usage: event }, "Usage event (no queue)");
  }
}

/**
 * Enqueue a data retention job for an org.
 */
export async function enqueueRetention(orgId: string, retentionDays: number): Promise<void> {
  if (retentionQueue) {
    await retentionQueue.add("retention", { orgId, retentionDays }, {
      jobId: `retention:${orgId}`, // Deduplicate per org
    });
  }
}

/**
 * Get BullMQ connection options for creating workers.
 * Workers should be created in a separate process for production.
 */
export function getQueueConnection(): ConnectionOptions | null {
  return connection;
}

/**
 * Close all queues on shutdown.
 */
export async function closeQueues(): Promise<void> {
  const queues = [audioQueue, reanalysisQueue, retentionQueue, usageQueue];
  await Promise.all(queues.filter(Boolean).map((q) => q!.close()));
  audioQueue = null;
  reanalysisQueue = null;
  retentionQueue = null;
  usageQueue = null;
  logger.info("BullMQ queues closed");
}
