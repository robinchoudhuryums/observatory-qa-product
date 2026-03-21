import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";
import type { CallAnalysis } from "./ai-provider";
import { normalizeStringArray } from "../utils";
import { logger } from "./logger";

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface AssemblyAIResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  confidence?: number;
  words?: TranscriptWord[];
  sentiment_analysis_results?: Array<{
    text: string;
    sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    confidence: number;
    start: number;
    end: number;
  }>;
  auto_chapters?: Array<{
    summary: string;
    headline: string;
    start: number;
    end: number;
  }>;
  iab_categories_result?: {
    summary: Record<string, number>;
  };
  error?: string;
}

export interface LeMURResponse {
  request_id: string;
  response: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || "",
      baseUrl: 'https://api.assemblyai.com/v2'
    };
    if (!this.config.apiKey) {
      logger.warn("ASSEMBLYAI_API_KEY is not set. Audio processing will fail.");
    }
  }

  async uploadAudioFile(audioBuffer: Buffer, fileName: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/octet-stream' },
      body: audioBuffer
    });
    if (!response.ok) throw new Error(`Failed to upload audio file: ${await response.text()}`);
    return (await response.json()).upload_url;
  }

  async transcribeAudio(audioUrl: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_model: "best",
        speaker_labels: true,
        punctuate: true,
        format_text: true,
        sentiment_analysis: true,
        // PII/PHI auto-redaction: replaces sensitive data with hash markers in transcript
        redact_pii: true,
        redact_pii_policies: [
          "person_name", "phone_number", "email_address", "date_of_birth",
          "us_social_security_number", "credit_card_number", "medical_record_number",
          "blood_type", "drug", "injury", "medical_condition",
        ],
        redact_pii_sub: "hash", // Replace with ### instead of removing
      })
    });
    if (!response.ok) throw new Error(`Failed to start transcription: ${await response.text()}`);
    return (await response.json()).id;
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      headers: { 'Authorization': this.config.apiKey }
    });
    if (!response.ok) throw new Error(`Failed to get transcript: ${await response.text()}`);
    return await response.json();
  }

  async pollTranscript(
    transcriptId: string,
    maxAttempts = 60,
    onProgress?: (attempt: number, maxAttempts: number, status: string) => void,
  ): Promise<AssemblyAIResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);

      if (transcript.status === 'completed') {
        return transcript;
      }
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error || 'Unknown error'}`);
      }

      onProgress?.(attempt, maxAttempts, transcript.status);

      // Wait with backoff: 3s for first 10 attempts, then 5s
      const delay = attempt < 10 ? 3000 : 5000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Transcription polling timed out');
  }

  // LeMUR task endpoint is synchronous - it returns the result directly
  async submitLeMURTask(transcriptId: string): Promise<LeMURResponse> {
    logger.info({ transcriptId }, "Submitting task to LeMUR");
    const response = await fetch(`https://api.assemblyai.com/lemur/v3/generate/task`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt: `Analyze this customer service call for a medical supply company. Provide your response in the following JSON format only, with no additional text:
{
  "summary": "A concise one-paragraph summary of the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": ["strength1", "strength2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

For sentiment_score, use 0.0-1.0 where 1.0 is most positive.
For performance_score, use 0.0-10.0 where 10.0 is best.
Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols.`,
      })
    });
    if (!response.ok) throw new Error(`Failed to submit LeMUR task: ${await response.text()}`);
    const result = await response.json();
    logger.info({ transcriptId, requestId: result.request_id }, "LeMUR task complete");
    return result;
  }

  processTranscriptData(
    transcriptResponse: AssemblyAIResponse,
    aiAnalysis: CallAnalysis | null,
    callId: string,
    orgId: string
  ): { transcript: InsertTranscript; sentiment: InsertSentimentAnalysis; analysis: InsertCallAnalysis } {
    // Build transcript record
    const transcript: InsertTranscript = {
      orgId,
      callId,
      text: transcriptResponse.text || '',
      confidence: transcriptResponse.confidence?.toString(),
      words: transcriptResponse.words || [],
    };

    // Determine sentiment: prefer Gemini analysis, fall back to AssemblyAI sentiment results
    let overallSentiment = aiAnalysis?.sentiment || 'neutral';
    let overallScore = aiAnalysis?.sentiment_score ?? 0.5;

    // If no AI analysis, derive sentiment from AssemblyAI's built-in sentiment results
    if (!aiAnalysis && transcriptResponse.sentiment_analysis_results?.length) {
      const sentiments = transcriptResponse.sentiment_analysis_results;
      const positiveCount = sentiments.filter(s => s.sentiment === 'POSITIVE').length;
      const negativeCount = sentiments.filter(s => s.sentiment === 'NEGATIVE').length;
      const total = sentiments.length;

      if (positiveCount > total * 0.5) overallSentiment = 'positive';
      else if (negativeCount > total * 0.3) overallSentiment = 'negative';
      else overallSentiment = 'neutral';

      const avgConfidence = sentiments.reduce((sum, s) => {
        const weight = s.sentiment === 'POSITIVE' ? s.confidence : s.sentiment === 'NEGATIVE' ? (1 - s.confidence) : 0.5;
        return sum + weight;
      }, 0) / total;
      overallScore = Math.round(avgConfidence * 100) / 100;
    }

    // Validate overallSentiment to match the enum type
    const validSentiments = ["positive", "neutral", "negative"] as const;
    const normalizedSentiment = typeof overallSentiment === "string" ? overallSentiment.toLowerCase() : "neutral";
    const validatedSentiment: "positive" | "neutral" | "negative" =
      validSentiments.includes(normalizedSentiment as any)
        ? (normalizedSentiment as "positive" | "neutral" | "negative")
        : "neutral";

    const sentiment: InsertSentimentAnalysis = {
      orgId,
      callId,
      overallSentiment: validatedSentiment,
      overallScore: overallScore.toString(),
      segments: transcriptResponse.sentiment_analysis_results || [],
    };

    // Build analysis record
    const performanceScore = aiAnalysis?.performance_score ?? 5.0;
    const words = transcriptResponse.words || [];

    // Calculate talk time ratio (if speaker labels exist)
    let talkTimeRatio = 0.5;
    if (words.length > 0) {
      const speakerATime = words
        .filter((w: TranscriptWord) => w.speaker === 'A')
        .reduce((sum: number, w: TranscriptWord) => sum + (w.end - w.start), 0);
      const totalTime = words[words.length - 1].end - words[0].start;
      if (totalTime > 0) {
        talkTimeRatio = Math.round((speakerATime / totalTime) * 100) / 100;
      }
    }

    // --- Speech Analytics: compute from word timing data ---
    const speechMetrics = this.computeSpeechMetrics(words);

    // Determine flags
    const flags: string[] = aiAnalysis?.flags || [];
    if (performanceScore <= 2.0 && !flags.includes("low_score")) {
      flags.push("low_score");
    }
    if (performanceScore >= 9.0 && !flags.includes("exceptional_call")) {
      flags.push("exceptional_call");
    }

    const analysis: InsertCallAnalysis = {
      orgId,
      callId,
      performanceScore: performanceScore.toString(),
      talkTimeRatio: talkTimeRatio.toString(),
      responseTime: undefined,
      keywords: normalizeStringArray(aiAnalysis?.topics),
      topics: normalizeStringArray(aiAnalysis?.topics),
      summary: typeof aiAnalysis?.summary === "string" ? aiAnalysis.summary : (aiAnalysis?.summary ? JSON.stringify(aiAnalysis.summary) : transcriptResponse.text?.slice(0, 500) || ''),
      actionItems: normalizeStringArray(aiAnalysis?.action_items),
      feedback: aiAnalysis?.feedback || { strengths: [], suggestions: [] },
      lemurResponse: undefined,
      callPartyType: typeof aiAnalysis?.call_party_type === "string" ? aiAnalysis.call_party_type : undefined,
      flags: flags.length > 0 ? flags : undefined,
      speechMetrics: Object.keys(speechMetrics).length > 0 ? speechMetrics : undefined,
    };

    return { transcript, sentiment, analysis };
  }

  /**
   * Compute speech analytics metrics from AssemblyAI word timing data.
   * Analyzes dead air, interruptions, talk speed, filler words, and response times.
   */
  private computeSpeechMetrics(words: TranscriptWord[]): Record<string, unknown> {
    if (!words || words.length < 2) return {};

    const DEAD_AIR_THRESHOLD_MS = 3000; // 3 seconds
    const FILLER_WORDS = new Set(["um", "uh", "uhm", "hmm", "like", "you know", "basically", "actually", "right", "so", "well", "I mean"]);

    const totalDurationMs = words[words.length - 1].end - words[0].start;
    if (totalDurationMs <= 0) return {};

    // --- Talk speed (words per minute) ---
    const totalWords = words.length;
    const talkSpeedWpm = Math.round((totalWords / (totalDurationMs / 60000)) * 10) / 10;

    // --- Dead air detection ---
    let deadAirSeconds = 0;
    let deadAirCount = 0;
    let longestDeadAirMs = 0;

    for (let i = 1; i < words.length; i++) {
      const gap = words[i].start - words[i - 1].end;
      if (gap >= DEAD_AIR_THRESHOLD_MS) {
        deadAirCount++;
        deadAirSeconds += gap / 1000;
        if (gap > longestDeadAirMs) longestDeadAirMs = gap;
      }
    }

    // --- Interruption detection (speaker overlap) ---
    let interruptionCount = 0;
    for (let i = 1; i < words.length; i++) {
      if (words[i].speaker && words[i - 1].speaker &&
          words[i].speaker !== words[i - 1].speaker) {
        // Speaker changed — check if there's overlap (new speaker starts before old ends)
        if (words[i].start < words[i - 1].end) {
          interruptionCount++;
        }
      }
    }

    // --- Filler word count ---
    const fillerWordCounts: Record<string, number> = {};
    let fillerWordTotal = 0;
    for (const w of words) {
      const lower = w.text.toLowerCase().replace(/[.,!?]/g, "");
      if (FILLER_WORDS.has(lower)) {
        fillerWordCounts[lower] = (fillerWordCounts[lower] || 0) + 1;
        fillerWordTotal++;
      }
    }

    // --- Average response time between speaker turns ---
    const turnGaps: number[] = [];
    for (let i = 1; i < words.length; i++) {
      if (words[i].speaker && words[i - 1].speaker &&
          words[i].speaker !== words[i - 1].speaker) {
        const gap = words[i].start - words[i - 1].end;
        if (gap > 0 && gap < 30000) { // Ignore unreasonable gaps
          turnGaps.push(gap);
        }
      }
    }
    const avgResponseTimeMs = turnGaps.length > 0
      ? Math.round(turnGaps.reduce((a, b) => a + b, 0) / turnGaps.length)
      : undefined;

    // --- Per-speaker talk percentages ---
    const speakerTime: Record<string, number> = {};
    for (const w of words) {
      const speaker = w.speaker || "unknown";
      speakerTime[speaker] = (speakerTime[speaker] || 0) + (w.end - w.start);
    }
    const totalTalkTime = Object.values(speakerTime).reduce((a, b) => a + b, 0);
    const speakerATalkPercent = totalTalkTime > 0 ? Math.round(((speakerTime["A"] || 0) / totalTalkTime) * 100) : undefined;
    const speakerBTalkPercent = totalTalkTime > 0 ? Math.round(((speakerTime["B"] || 0) / totalTalkTime) * 100) : undefined;

    return {
      talkSpeedWpm,
      deadAirSeconds: Math.round(deadAirSeconds * 10) / 10,
      deadAirCount,
      longestDeadAirSeconds: Math.round((longestDeadAirMs / 1000) * 10) / 10,
      interruptionCount,
      fillerWordCount: fillerWordTotal,
      fillerWords: Object.keys(fillerWordCounts).length > 0 ? fillerWordCounts : undefined,
      avgResponseTimeMs,
      speakerATalkPercent,
      speakerBTalkPercent,
    };
  }
}

export const assemblyAIService = new AssemblyAIService();
