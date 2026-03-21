/**
 * Shared EHR HTTP request utility with timeout and retry support.
 *
 * All EHR adapters should use this instead of calling fetch() directly.
 * Provides:
 * - AbortController timeout (default 30s)
 * - Exponential backoff retry for transient failures (5xx, network errors)
 * - Structured error messages
 */

import { logger } from "../logger.js";

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

interface EhrRequestOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Number of retries for transient failures (default: 2) */
  retries?: number;
  /** Label for logging (e.g., "Open Dental") */
  systemLabel?: string;
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

export async function ehrRequest<T>(opts: EhrRequestOptions): Promise<T> {
  const {
    method, url, headers, body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    systemLabel = "EHR",
  } = opts;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn({ systemLabel, attempt, delay, url }, `${systemLabel}: Retrying after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");

        if (isRetryable(response.status) && attempt < retries) {
          lastError = new Error(`${systemLabel} API error ${response.status}: ${errorText}`);
          continue; // Retry
        }

        throw new Error(`${systemLabel} API error ${response.status}: ${errorText}`);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error(`${systemLabel} API request timed out after ${timeoutMs}ms: ${method} ${url}`);
        if (attempt < retries) continue; // Retry timeouts
        throw lastError;
      }

      // Network errors are retryable
      if (err instanceof TypeError && attempt < retries) {
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error(`${systemLabel}: Request failed after ${retries + 1} attempts`);
}
