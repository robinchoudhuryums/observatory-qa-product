import multer from "multer";
import path from "path";
import fs from "fs";
import { logger } from "../services/logger";

/** Parse a numeric value safely, returning fallback if NaN or non-finite. */
export function safeFloat(val: unknown, fallback = 0): number {
  const num = parseFloat(String(val ?? fallback));
  return Number.isFinite(num) ? num : fallback;
}

export function safeInt(val: unknown, fallback = 0): number {
  const num = parseInt(String(val ?? fallback), 10);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Retry an async operation with exponential backoff.
 * Useful for transient failures in AI/transcription services.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelay?: number; label?: string } = {}
): Promise<T> {
  const { retries = 2, baseDelay = 1000, label = "operation" } = opts;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn({ label, attempt: attempt + 1, maxAttempts: retries + 1, delayMs: delay, err: lastError }, "Retrying failed operation");
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
export const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (reasonable for audio files)
  },
  fileFilter: (req, file, cb) => {
    // Validate both file extension and MIME type
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'];
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/flac', 'audio/x-flac',
      'audio/ogg', 'audio/vorbis', 'video/mp4', 'application/octet-stream',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    if (allowedTypes.includes(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files (MP3, WAV, M4A, MP4, FLAC, OGG) are allowed.'), false);
    }
  }
});
