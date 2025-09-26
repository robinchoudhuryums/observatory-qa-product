import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";

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
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || "",
      baseUrl: 'https://api.assemblyai.com/v2'
    };
    if (!this.config.apiKey) {
      throw new Error('AssemblyAI API key is required.');
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
        format_text: true
      })
    });
    if (!response.ok) throw new Error(`Failed to start transcription: ${await response.text()}`);
    return (await response.json()).id;
  }

  // --- NEW FUNCTION 1: SUBMIT LeMUR TASK ---
  async submitLeMURTask(transcriptId: string): Promise<string> {
    console.log(`[${transcriptId}] Submitting task to LeMUR...`);
    const response = await fetch(`https://api.assemblyai.com/lemur/v3/tasks`, { // Correct endpoint
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt: "Generate a concise one-paragraph summary, a list of up to 5 key topics, and an overall sentiment analysis (positive, neutral, or negative) for this conversation. Format the output clearly with headers for each section: 'Summary:', 'Topics:', and 'Sentiment:'",
      })
    });
    if (!response.ok) throw new Error(`Failed to submit LeMUR task: ${await response.text()}`);
    const result = await response.json();
    console.log(`[${transcriptId}] LeMUR task submitted. Task ID: ${result.task_id}`);
    return result.task_id;
  }

  // --- NEW FUNCTION 2: POLL LeMUR RESULT ---
  async pollLeMURResult(taskId: string, maxAttempts = 20): Promise<any> {
    console.log(`[${taskId}] Polling for LeMUR results...`);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(`https://api.assemblyai.com/lemur/v3/tasks/${taskId}`, {
        headers: { 'Authorization': this.config.apiKey }
      });
      if (!response.ok) throw new Error(`Failed to poll LeMUR task: ${await response.text()}`);
      
      const result = await response.json();
      if (result.status === 'completed') {
        console.log(`[${taskId}] LeMUR task complete.`);
        return result;
      }
      if (result.status === 'failed') throw new Error('LeMUR task failed');
      
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
    }
    throw new Error('LeMUR task timed out');
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      headers: { 'Authorization': this.config.apiKey }
    });
    if (!response.ok) throw new Error(`Failed to get transcript: ${await response.text()}`);
    return await response.json();
  }

  async pollTranscript(transcriptId: string, maxAttempts = 60): Promise<AssemblyAIResponse> {
    // ... (This function remains the same) ...
  }
  
  // ... (Your processTranscriptData and other helper functions remain the same) ...
}

export const assemblyAIService = new AssemblyAIService();


