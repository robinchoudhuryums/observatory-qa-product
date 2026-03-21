/**
 * AssemblyAI Real-Time Transcription Service.
 *
 * Manages per-session WebSocket connections to AssemblyAI's real-time
 * transcription API, relaying audio from the client and returning
 * partial/final transcript segments.
 *
 * HIPAA: Audio is streamed over WSS (TLS) to AssemblyAI.
 * PHI is not logged — only transcript status events are logged.
 */
import WebSocket from "ws";
import { logger } from "./logger";

const ASSEMBLYAI_REALTIME_URL = "wss://api.assemblyai.com/v2/realtime/ws";

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

      this.ws.on("open", () => {
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
        logger.error({ err }, "AssemblyAI real-time WebSocket error");
        this.onEvent({ type: "error", text: "Transcription connection error" });
        if (!this.ws) reject(err);
      });

      this.ws.on("close", (code, reason) => {
        logger.info({ code, reason: reason.toString() }, "AssemblyAI real-time WebSocket closed");
        this.ws = null;
        if (!this.closed) {
          this.onEvent({ type: "session_end", text: "" });
        }
      });
    });
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
    this.closed = true;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Send terminate_session message
    this.ws.send(JSON.stringify({ terminate_session: true }));
    // Wait briefly for clean close
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.ws?.close();
        resolve();
      }, 3000);
      this.ws!.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
