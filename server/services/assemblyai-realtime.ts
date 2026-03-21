/**
 * AssemblyAI Real-Time Transcription Service.
 *
 * Manages per-session WebSocket connections to AssemblyAI's real-time
 * transcription API, relaying audio from the client and returning
 * partial/final transcript segments.
 *
 * Includes automatic reconnection on unexpected disconnects with
 * exponential backoff (up to 3 retries).
 *
 * HIPAA: Audio is streamed over WSS (TLS) to AssemblyAI.
 * PHI is not logged — only transcript status events are logged.
 */
import WebSocket from "ws";
import { logger } from "./logger";

const ASSEMBLYAI_REALTIME_URL = "wss://api.assemblyai.com/v2/realtime/ws";
const CONNECTION_TIMEOUT_MS = 10_000; // 10 seconds to connect
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000; // 2s, 4s, 8s

export interface RealtimeTranscriptEvent {
  /** "partial" = interim (will change), "final" = committed segment */
  type: "partial" | "final" | "error" | "session_begin" | "session_end";
  text: string;
  /** Confidence (0-1) for final transcripts */
  confidence?: number;
  /** Word-level timing */
  words?: Array<{ text: string; start: number; end: number; confidence: number }>;
  /** Audio start/end in milliseconds */
  audioStart?: number;
  audioEnd?: number;
}

export type RealtimeEventHandler = (event: RealtimeTranscriptEvent) => void;

/**
 * Manages a single real-time transcription session with AssemblyAI.
 */
export class RealtimeTranscriptionSession {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sampleRate: number;
  private onEvent: RealtimeEventHandler;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnecting = false;

  constructor(apiKey: string, sampleRate: number, onEvent: RealtimeEventHandler) {
    this.apiKey = apiKey;
    this.sampleRate = sampleRate;
    this.onEvent = onEvent;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${ASSEMBLYAI_REALTIME_URL}?sample_rate=${this.sampleRate}`;
      this.ws = new WebSocket(url, {
        headers: { Authorization: this.apiKey },
      });

      // Connection timeout
      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.close();
          this.ws = null;
          reject(new Error("AssemblyAI real-time connection timed out"));
        }
      }, CONNECTION_TIMEOUT_MS);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0; // Reset on successful connection
        logger.info("AssemblyAI real-time WebSocket connected");
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.message_type === "SessionBegins") {
            this.onEvent({ type: "session_begin", text: "" });
          } else if (msg.message_type === "PartialTranscript") {
            this.onEvent({
              type: "partial",
              text: msg.text || "",
              words: msg.words,
              audioStart: msg.audio_start,
              audioEnd: msg.audio_end,
            });
          } else if (msg.message_type === "FinalTranscript") {
            this.onEvent({
              type: "final",
              text: msg.text || "",
              confidence: msg.confidence,
              words: msg.words,
              audioStart: msg.audio_start,
              audioEnd: msg.audio_end,
            });
          } else if (msg.message_type === "SessionTerminated") {
            this.onEvent({ type: "session_end", text: "" });
          }
        } catch (err) {
          logger.error({ err }, "Failed to parse AssemblyAI real-time message");
        }
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        logger.error({ err }, "AssemblyAI real-time WebSocket error");
        this.onEvent({ type: "error", text: "Transcription connection error" });
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        logger.info({ code, reason: reason.toString() }, "AssemblyAI real-time WebSocket closed");
        this.ws = null;
        if (!this.closed) {
          // Unexpected close — attempt reconnection
          this.attemptReconnect();
        }
      });
    });
  }

  /**
   * Attempt automatic reconnection with exponential backoff.
   * Only fires on unexpected disconnects (not user-initiated close()).
   */
  private async attemptReconnect(): Promise<void> {
    if (this.closed || this.reconnecting) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn({ attempts: this.reconnectAttempts }, "AssemblyAI reconnect limit reached — giving up");
      this.onEvent({ type: "error", text: "Transcription disconnected after reconnect attempts" });
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    logger.info({ attempt: this.reconnectAttempts, delayMs: delay }, "Attempting AssemblyAI reconnection");

    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    if (this.closed) {
      this.reconnecting = false;
      return;
    }

    try {
      await this.connect();
      logger.info({ attempt: this.reconnectAttempts }, "AssemblyAI reconnected successfully");
      this.onEvent({ type: "session_begin", text: "" });
    } catch (err) {
      logger.error({ err, attempt: this.reconnectAttempts }, "AssemblyAI reconnect attempt failed");
      // The close handler on the failed connection will trigger another attemptReconnect
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Send raw audio data (base64-encoded PCM16) to AssemblyAI.
   */
  sendAudio(audioBase64: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ audio_data: audioBase64 }));
  }

  /**
   * Gracefully close the transcription session.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.ws = null;
      return;
    }
    // Send terminate_session message
    try {
      this.ws.send(JSON.stringify({ terminate_session: true }));
    } catch { /* connection may already be closing */ }
    // Wait briefly for clean close
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { this.ws?.close(); } catch { /* best effort */ }
        this.ws = null;
        resolve();
      }, 3000);
      this.ws!.once("close", () => {
        clearTimeout(timeout);
        this.ws = null;
        resolve();
      });
    });
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
