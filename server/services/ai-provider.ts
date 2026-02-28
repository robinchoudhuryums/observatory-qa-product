/**
 * AI Analysis Provider — shared interface and factory.
 *
 * Supports multiple backends:
 *   AI_PROVIDER=gemini   — Google AI Studio or Vertex AI (default)
 *   AI_PROVIDER=bedrock  — AWS Bedrock with Claude
 *
 * All providers implement the same interface and return identical output shapes.
 */

export interface CallAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  action_items: string[];
  feedback: {
    strengths: string[];
    suggestions: string[];
  };
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string): Promise<CallAnalysis>;
}

const CATEGORY_CONTEXT: Record<string, string> = {
  inbound: "This is an INBOUND call — a customer or patient called into the company. One speaker is the customer/patient and the other is the company employee/agent.",
  outbound: "This is an OUTBOUND call — the company employee called a customer or patient. One speaker is the employee/agent and the other is the customer/patient.",
  internal: "This is an INTERNAL call — both speakers are coworkers or employees within the same company. Evaluate collaboration, communication clarity, and productivity rather than customer service metrics.",
  vendor: "This is a VENDOR/PARTNER call — the employee is speaking with an external vendor or business partner. Evaluate negotiation, clarity, and professionalism.",
};

export function buildAnalysisPrompt(transcriptText: string, callCategory?: string): string {
  const categoryContext = callCategory && CATEGORY_CONTEXT[callCategory]
    ? `\nCALL CONTEXT:\n${CATEGORY_CONTEXT[callCategory]}\n`
    : "";

  const evaluationCriteria = callCategory === "internal"
    ? "- Evaluate on: communication clarity, collaboration effectiveness, action item follow-through, and productivity"
    : "- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols";

  return `You are analyzing a call transcript for a medical supply company. Analyze the following transcript and provide your assessment.
${categoryContext}
TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "A concise one-paragraph summary of what happened in the call",
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

Guidelines:
- sentiment_score: 0.0 to 1.0 (1.0 = most positive)
- performance_score: 0.0 to 10.0 (10.0 = best)
${evaluationCriteria}
- Be specific in strengths and suggestions — reference actual moments from the call
- Include 2-4 action items that are concrete and actionable
- Topics should be specific (e.g. "order tracking", "billing dispute") not generic`;
}

/**
 * Parse a JSON object from model output, handling markdown fences and extra text.
 */
export function parseJsonResponse(text: string, callId: string): CallAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[${callId}] AI response was not parseable JSON:`, text.slice(0, 200));
    throw new Error("AI response did not contain valid JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]) as CallAnalysis;
  } catch (parseError) {
    console.warn(`[${callId}] JSON parse failed:`, (parseError as Error).message, text.slice(0, 300));
    throw new Error("AI response contained malformed JSON");
  }
}
