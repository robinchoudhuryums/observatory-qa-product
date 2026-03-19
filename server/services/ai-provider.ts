/**
 * AI Analysis Provider — shared interface and factory.
 *
 * Supports multiple backends:
 *   AI_PROVIDER=gemini   — Google AI Studio or Vertex AI (default)
 *   AI_PROVIDER=bedrock  — AWS Bedrock with Claude
 *
 * All providers implement the same interface and return identical output shapes.
 */
import { logger } from "./logger";

export interface CallAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  sub_scores: {
    compliance: number;
    customer_experience: number;
    communication: number;
    resolution: number;
  };
  action_items: string[];
  feedback: {
    strengths: Array<string | { text: string; timestamp?: string }>;
    suggestions: Array<string | { text: string; timestamp?: string }>;
  };
  call_party_type: string;
  flags: string[];
  detected_agent_name: string | null;
  /** Present only for clinical encounter / telemedicine categories */
  clinical_note?: {
    format: string;
    specialty?: string;
    chief_complaint?: string;
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string[];
    hpi_narrative?: string;
    review_of_systems?: Record<string, string>;
    differential_diagnoses?: string[];
    icd10_codes?: Array<{ code: string; description: string }>;
    cpt_codes?: Array<{ code: string; description: string }>;
    prescriptions?: Array<{ medication: string; dosage?: string; instructions?: string }>;
    follow_up?: string;
    documentation_completeness?: number;
    clinical_accuracy?: number;
    missing_sections?: string[];
  };
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: PromptTemplateConfig): Promise<CallAnalysis>;
  generateText?(prompt: string): Promise<string>;
}

/**
 * Build a prompt for generating a narrative agent profile summary.
 */
export function buildAgentSummaryPrompt(data: {
  name: string;
  role?: string;
  totalCalls: number;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  dateRange: string;
}): string {
  const strengthsList = data.topStrengths.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const suggestionsList = data.topSuggestions.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const topicsList = data.commonTopics.map(t => `- ${t.text} (${t.count} calls)`).join("\n");

  return `You are an HR/quality assurance analyst for a medical supply company. Write a professional performance summary for the following call center agent based on aggregated data from their analyzed calls.

AGENT: ${data.name}
DEPARTMENT: ${data.role || "N/A"}
PERIOD: ${data.dateRange}
TOTAL CALLS ANALYZED: ${data.totalCalls}

PERFORMANCE SCORES:
- Average: ${data.avgScore?.toFixed(1) ?? "N/A"}/10
- Best: ${data.highScore?.toFixed(1) ?? "N/A"}/10
- Lowest: ${data.lowScore?.toFixed(1) ?? "N/A"}/10

SENTIMENT BREAKDOWN:
- Positive: ${data.sentimentBreakdown.positive}
- Neutral: ${data.sentimentBreakdown.neutral}
- Negative: ${data.sentimentBreakdown.negative}

RECURRING STRENGTHS:
${strengthsList || "None identified"}

RECURRING AREAS FOR IMPROVEMENT:
${suggestionsList || "None identified"}

COMMON CALL TOPICS:
${topicsList || "Various"}

Write a concise (3-4 paragraph) professional narrative that:
1. Summarizes overall performance and trends
2. Highlights consistent strengths with specific examples from the data
3. Identifies key areas for improvement with actionable recommendations
4. Provides a brief outlook or coaching recommendation

Use a professional but supportive tone appropriate for a performance review. Do NOT use markdown formatting, bullet points, or headers — write in plain paragraph form.`;
}

const CATEGORY_CONTEXT: Record<string, string> = {
  inbound: "This is an INBOUND call — a customer or patient called into the company. One speaker is the customer/patient and the other is the company employee/agent.",
  outbound: "This is an OUTBOUND call — the company employee called a customer or patient. One speaker is the employee/agent and the other is the customer/patient.",
  internal: "This is an INTERNAL call — both speakers are coworkers or employees within the same company. Evaluate collaboration, communication clarity, and productivity rather than customer service metrics.",
  vendor: "This is a VENDOR/PARTNER call — the employee is speaking with an external vendor or business partner. Evaluate negotiation, clarity, and professionalism.",
  clinical_encounter: "This is a CLINICAL ENCOUNTER recording — a healthcare provider seeing a patient in person. One speaker is the provider (doctor/NP/PA) and the other is the patient. Focus on clinical documentation accuracy rather than customer service metrics.",
  telemedicine: "This is a TELEMEDICINE VISIT — a remote healthcare consultation via phone or video. One speaker is the healthcare provider and the other is the patient. Focus on clinical documentation accuracy rather than customer service metrics.",
  // Dental front desk call categories
  dental_scheduling: "This is a DENTAL SCHEDULING call — a patient or prospective patient is calling to schedule, reschedule, or cancel a dental appointment. One speaker is the front desk staff and the other is the patient. Evaluate scheduling efficiency, patient experience, and whether the staff properly verified insurance and patient identity.",
  dental_insurance: "This is a DENTAL INSURANCE call — the front desk or billing staff is handling insurance verification, benefits explanation, or pre-authorization. Evaluate accuracy of insurance information communicated, clarity of patient financial responsibility explanation, and compliance with billing protocols.",
  dental_treatment: "This is a DENTAL TREATMENT DISCUSSION call — staff is discussing a treatment plan with a patient, including procedures, costs, payment options, and scheduling. Evaluate treatment acceptance techniques, clarity of financial presentation, and whether all patient questions were addressed. Track whether the patient accepted, deferred, or declined the proposed treatment.",
  dental_recall: "This is a DENTAL RECALL/RECARE call — staff is contacting a patient for a recall or recare appointment (routine cleaning, periodic exam). Evaluate persuasiveness, professionalism, and whether the staff communicated the importance of preventive care.",
  dental_emergency: "This is a DENTAL EMERGENCY TRIAGE call — a patient is calling about an urgent dental issue (toothache, trauma, swelling, broken tooth). One speaker is the front desk or clinical staff and the other is the patient. Evaluate whether proper triage questions were asked (onset, severity, symptoms, allergies, medications), appropriate urgency assessment was made, and clear next-step instructions were given.",
  // Dental clinical documentation categories
  dental_encounter: "This is a DENTAL CLINICAL ENCOUNTER — a dentist, hygienist, or dental specialist treating a patient in the office. Focus on clinical documentation accuracy, procedure details, and dental-specific terminology. Use CDT (Current Dental Terminology) codes instead of CPT codes.",
  dental_consultation: "This is a DENTAL CONSULTATION — a new patient evaluation or second-opinion visit. Focus on comprehensive examination findings, treatment planning, and patient education. Use CDT codes for any procedures discussed or performed.",
};

export interface PromptTemplateConfig {
  evaluationCriteria?: string;
  requiredPhrases?: Array<{ phrase: string; label: string; severity: string }>;
  scoringWeights?: { compliance: number; customerExperience: number; communication: number; resolution: number };
  additionalInstructions?: string;
  /** Extracted text from company reference documents (injected automatically) */
  referenceDocuments?: Array<{ name: string; category: string; text: string }>;
}

/**
 * For very long transcripts, keep the beginning and end (most info-dense)
 * and sample the middle to stay within reasonable token budgets.
 * Threshold: ~80K chars (~20K tokens input).
 */
function smartTruncate(text: string, maxChars = 80000): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.35);
  const tailSize = Math.floor(maxChars * 0.35);
  const midSize = maxChars - headSize - tailSize - 200;
  const midStart = Math.floor((text.length - midSize) / 2);

  return [
    text.slice(0, headSize),
    `\n\n[... ${((text.length - maxChars) / 1000).toFixed(0)}K characters omitted from mid-call transitions ...]\n\n`,
    text.slice(midStart, midStart + midSize),
    "\n\n[... continued ...]\n\n",
    text.slice(-tailSize),
  ].join("");
}

/**
 * Build the static system prompt (cacheable across requests).
 *
 * OPTIMIZATION: This is sent as the Bedrock Converse API's `system` field,
 * which Bedrock caches across requests with identical prefixes. The system
 * prompt contains evaluation criteria, reference docs, and scoring guidelines
 * that rarely change between calls for the same org/category — enabling
 * 25-40% input token savings from prompt caching.
 */
export function buildSystemPrompt(callCategory?: string, template?: PromptTemplateConfig): string {
  // Clinical documentation mode — entirely different output schema
  const clinicalCategories = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];
  if (callCategory && clinicalCategories.includes(callCategory)) {
    if (callCategory === "dental_encounter" || callCategory === "dental_consultation") {
      return buildDentalClinicalSystemPrompt(callCategory, template);
    }
    return buildClinicalSystemPrompt(callCategory, template);
  }

  const categoryContext = callCategory && CATEGORY_CONTEXT[callCategory]
    ? `\nCALL CONTEXT:\n${CATEGORY_CONTEXT[callCategory]}\n`
    : "";

  // Use custom evaluation criteria from template, or defaults
  let evaluationCriteria: string;
  if (template?.evaluationCriteria) {
    evaluationCriteria = `- EVALUATION CRITERIA (use these to guide your scoring):\n${template.evaluationCriteria}`;
  } else if (callCategory === "internal") {
    evaluationCriteria = "- Evaluate on: communication clarity, collaboration effectiveness, action item follow-through, and productivity";
  } else {
    evaluationCriteria = "- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols";
  }

  // Build scoring weights section
  let scoringSection = "";
  if (template?.scoringWeights) {
    const w = template.scoringWeights;
    scoringSection = `\n- SCORING WEIGHTS: Compliance (${w.compliance}%), Customer Experience (${w.customerExperience}%), Communication (${w.communication}%), Resolution (${w.resolution}%). Weight your performance_score accordingly.`;
  }

  // Build required phrases check
  let phrasesSection = "";
  if (template?.requiredPhrases && template.requiredPhrases.length > 0) {
    const required = template.requiredPhrases.filter(p => p.severity === "required");
    const recommended = template.requiredPhrases.filter(p => p.severity === "recommended");
    if (required.length > 0) {
      phrasesSection += `\n- REQUIRED PHRASES: The agent MUST say something equivalent to the following. Flag "missing_required_phrase:<label>" for each missing phrase:\n`;
      phrasesSection += required.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
    if (recommended.length > 0) {
      phrasesSection += `\n- RECOMMENDED PHRASES: The agent SHOULD say something similar to these. Note in suggestions if missing:\n`;
      phrasesSection += recommended.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
  }

  // Build reference documents section
  let referenceSection = "";
  if (template?.referenceDocuments && template.referenceDocuments.length > 0) {
    const isRagRetrieved = template.referenceDocuments.some(d => d.category === "rag_retrieval");

    if (isRagRetrieved) {
      const ragText = template.referenceDocuments.map(d => d.text).join("\n\n");
      referenceSection = `\n- COMPANY KNOWLEDGE BASE (semantically retrieved): The following excerpts from company documentation were selected as most relevant to this specific call. Use them to evaluate compliance, product knowledge, and adherence to company procedures. Cite specific sections when relevant:\n${ragText}`;
    } else {
      const maxRefChars = 15000;
      let totalChars = 0;
      const docSnippets: string[] = [];

      for (const doc of template.referenceDocuments) {
        const remaining = maxRefChars - totalChars;
        if (remaining <= 200) break;
        const snippet = doc.text.slice(0, remaining);
        docSnippets.push(`--- ${doc.name} (${doc.category}) ---\n${snippet}`);
        totalChars += snippet.length;
      }

      referenceSection = `\n- COMPANY REFERENCE DOCUMENTS: Use the following company-specific materials as context for your evaluation. Reference these when scoring compliance, product knowledge, and adherence to company procedures:\n${docSnippets.join("\n\n")}`;
    }
  }

  // Build additional instructions
  let additionalSection = "";
  if (template?.additionalInstructions) {
    additionalSection = `\n- ADDITIONAL INSTRUCTIONS:\n${template.additionalInstructions}`;
  }

  return `You are analyzing a call transcript for a medical supply company. Analyze the ENTIRE transcript from beginning to end — reference moments from the beginning, middle, AND end. Do not skip or summarize sections.
${categoryContext}
Respond with ONLY valid JSON (no markdown, no code fences):
{"summary":"...","topics":["..."],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["..."],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"customer|insurance|medical_facility|medicare|vendor|internal|other","flags":[],"detected_agent_name":null}

Guidelines:
- sentiment_score: 0.0-1.0 (1.0 = most positive)
- performance_score: 0.0-10.0 (overall weighted score)
- sub_scores (each 0.0-10.0): compliance (procedures, HIPAA, policies), customer_experience (empathy, patience, tone), communication (clarity, listening, completeness), resolution (issue resolution effectiveness)
${evaluationCriteria}${scoringSection}${phrasesSection}${referenceSection}${additionalSection}
- For EACH strength/suggestion, include approximate timestamp (MM:SS) of the referenced moment
- 2-4 concrete, actionable action items
- Topics: specific (e.g. "order tracking", "billing dispute"), not generic
- call_party_type: "customer" (patients), "insurance" (reps), "medical_facility" (clinics/hospitals), "medicare" (1-800-MEDICARE), "vendor", "internal" (coworkers), "other"
- detected_agent_name: Agent's name if clearly stated (e.g. "Hi, my name is Sarah"). Return null if uncertain. Only the agent's name, not the customer's.
- flags: "medicare_call" if Medicare involved, "low_score" if performance ≤2.0, "exceptional_call" if ≥9.0 with outstanding service, "agent_misconduct:<description>" for serious misconduct (abusive language, hanging up, HIPAA violations, etc.)`;
}

/**
 * Build clinical documentation system prompt.
 * Outputs a combined QA + clinical note JSON for clinical encounter categories.
 */
function buildClinicalSystemPrompt(callCategory: string, template?: PromptTemplateConfig): string {
  const categoryContext = CATEGORY_CONTEXT[callCategory] || "";

  // Build reference documents section (same logic as QA)
  let referenceSection = "";
  if (template?.referenceDocuments && template.referenceDocuments.length > 0) {
    const isRagRetrieved = template.referenceDocuments.some(d => d.category === "rag_retrieval");
    if (isRagRetrieved) {
      const ragText = template.referenceDocuments.map(d => d.text).join("\n\n");
      referenceSection = `\n- CLINICAL KNOWLEDGE BASE: ${ragText}`;
    } else {
      const docSnippets = template.referenceDocuments.slice(0, 5).map(d => `--- ${d.name} ---\n${d.text.slice(0, 3000)}`);
      referenceSection = `\n- REFERENCE MATERIALS:\n${docSnippets.join("\n\n")}`;
    }
  }

  let additionalSection = "";
  if (template?.additionalInstructions) {
    additionalSection = `\n- ADDITIONAL INSTRUCTIONS:\n${template.additionalInstructions}`;
  }

  return `You are a clinical documentation AI assistant analyzing a recorded healthcare encounter. Your task is to draft structured clinical notes from the provider-patient conversation.

CALL CONTEXT:
${categoryContext}
${referenceSection}${additionalSection}

Respond with ONLY valid JSON (no markdown, no code fences). The JSON must contain BOTH standard analysis fields AND a clinical_note object:

{"summary":"Brief encounter summary","topics":["chief complaint","relevant topics"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"soap","chief_complaint":"...","subjective":"Patient history and symptoms as reported","objective":"Physical exam findings, vitals, observations mentioned","assessment":"Clinical assessment and diagnoses","plan":["Treatment plan items"],"hpi_narrative":"Detailed HPI narrative","review_of_systems":{"constitutional":"...","cardiovascular":"..."},"differential_diagnoses":["..."],"icd10_codes":[{"code":"Z00.00","description":"General adult medical examination"}],"cpt_codes":[{"code":"99213","description":"Office visit, established patient, low complexity"}],"prescriptions":[{"medication":"...","dosage":"...","instructions":"..."}],"follow_up":"Return in 2 weeks","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":["sections not covered in the encounter"]}}

Guidelines for standard fields:
- summary: Brief 1-2 sentence encounter summary
- sentiment_score: 0.0-1.0 (patient satisfaction/comfort level)
- performance_score: 0.0-10.0 (clinical documentation quality)
- sub_scores: compliance (clinical guidelines adherence), customer_experience (bedside manner), communication (clarity of explanations), resolution (addressed patient concerns)
- detected_agent_name: Provider's name if stated. Return null if uncertain.

Guidelines for clinical_note:
- format: Always "soap" unless the encounter clearly fits another format
- chief_complaint: The primary reason for the visit in the patient's own words
- subjective: Patient-reported symptoms, history, medications, allergies — everything the patient tells the provider
- objective: Any physical exam findings, vitals, or observations the provider describes
- assessment: Clinical impression, working diagnoses, differential considerations
- plan: Array of specific plan items (medications, tests ordered, referrals, lifestyle modifications)
- hpi_narrative: Detailed History of Present Illness in standard medical documentation format
- review_of_systems: Only include systems that were actually discussed (e.g., {"constitutional": "No fever, fatigue, or weight loss", "respiratory": "Denies cough or dyspnea"})
- icd10_codes: Suggest appropriate ICD-10 codes based on the encounter. These are SUGGESTIONS for provider review, not final codes
- cpt_codes: Suggest appropriate E/M or procedure codes based on encounter complexity
- prescriptions: Any medications prescribed, discussed, or adjusted during the encounter
- follow_up: Follow-up instructions or return visit timing
- documentation_completeness: 0.0-10.0 (how thorough the encounter documentation is)
- clinical_accuracy: 0.0-10.0 (clinical appropriateness of the AI-generated note)
- missing_sections: List any standard documentation sections NOT covered in the encounter

IMPORTANT:
- All clinical notes are DRAFTS requiring provider attestation before use
- Do NOT fabricate clinical information not discussed in the encounter
- If information for a section was not discussed, note it in missing_sections
- Use standard medical terminology and abbreviations where appropriate
- ICD-10 and CPT codes are suggestions only — provider must verify`;
}

/**
 * Build dental-specific clinical documentation system prompt.
 * Outputs dental SOAP notes with CDT codes, tooth numbers, and periodontal findings.
 */
function buildDentalClinicalSystemPrompt(callCategory: string, template?: PromptTemplateConfig): string {
  const categoryContext = CATEGORY_CONTEXT[callCategory] || "";

  let referenceSection = "";
  if (template?.referenceDocuments && template.referenceDocuments.length > 0) {
    const isRagRetrieved = template.referenceDocuments.some(d => d.category === "rag_retrieval");
    if (isRagRetrieved) {
      const ragText = template.referenceDocuments.map(d => d.text).join("\n\n");
      referenceSection = `\n- DENTAL KNOWLEDGE BASE: ${ragText}`;
    } else {
      const docSnippets = template.referenceDocuments.slice(0, 5).map(d => `--- ${d.name} ---\n${d.text.slice(0, 3000)}`);
      referenceSection = `\n- REFERENCE MATERIALS:\n${docSnippets.join("\n\n")}`;
    }
  }

  let additionalSection = "";
  if (template?.additionalInstructions) {
    additionalSection = `\n- ADDITIONAL INSTRUCTIONS:\n${template.additionalInstructions}`;
  }

  return `You are a dental clinical documentation AI assistant analyzing a recorded dental encounter. Your task is to draft structured dental clinical notes from the provider-patient conversation.

CALL CONTEXT:
${categoryContext}
${referenceSection}${additionalSection}

Respond with ONLY valid JSON (no markdown, no code fences). The JSON must contain standard analysis fields AND a dental-specific clinical_note object:

{"summary":"Brief encounter summary","topics":["chief complaint","procedures performed"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"dental_exam","chief_complaint":"...","subjective":"Patient-reported symptoms, dental history, pain description","objective":"Clinical findings, radiographic findings, intraoral exam","assessment":"Dental diagnoses and clinical assessment","plan":["Treatment plan items"],"tooth_numbers":["14","19"],"quadrants":["UR","LL"],"cdt_codes":[{"code":"D0150","description":"Comprehensive oral evaluation"}],"icd10_codes":[{"code":"K02.9","description":"Dental caries, unspecified"}],"periodontal_findings":{"probing_depths":"Generalized 2-3mm, localized 5mm on #3 mesial","bleeding_on_probing":"Localized BOP #3, #14","gingival_description":"Marginal erythema localized to #3"},"treatment_phases":[{"phase":1,"description":"Disease control","procedures":["SRP quadrants 1-4","Re-evaluation 4-6 weeks"],"estimated_cost":"$800-1200"}],"prescriptions":[{"medication":"Amoxicillin 500mg","dosage":"TID x 7 days","instructions":"Take with food, complete full course"}],"follow_up":"Return in 2 weeks for re-evaluation","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":["sections not covered"]}}

Guidelines for standard fields:
- summary: Brief 1-2 sentence encounter summary
- sentiment_score: 0.0-1.0 (patient comfort/satisfaction level)
- performance_score: 0.0-10.0 (clinical documentation quality)
- sub_scores: compliance (clinical guidelines adherence), customer_experience (chairside manner), communication (explanation clarity), resolution (addressed patient concerns)
- detected_agent_name: Provider's name if stated. Return null if uncertain.

Guidelines for dental clinical_note:
- format: "dental_exam", "dental_operative", "dental_perio", "dental_endo", "dental_ortho_progress", "dental_surgery", or "dental_treatment_plan"
- chief_complaint: Primary reason for visit in patient's own words
- subjective: Patient-reported symptoms, dental history, pain level/location, relevant medical history, medications, allergies
- objective: Clinical findings — intraoral exam, extraoral exam, radiographic findings, vitals if taken
- assessment: Dental diagnoses with tooth-specific findings
- plan: Specific treatment steps (procedures, referrals, follow-up)
- tooth_numbers: Use Universal Numbering System (1-32 for permanent, A-T for primary teeth)
- quadrants: Affected quadrants (UR=upper right, UL=upper left, LR=lower right, LL=lower left)
- cdt_codes: CDT (Current Dental Terminology) procedure codes — these are SUGGESTIONS for provider review
- icd10_codes: Relevant ICD-10-CM diagnostic codes
- periodontal_findings: Probing depths, bleeding on probing, attachment levels, gingival description, mobility, furcation involvement
- treatment_phases: For comprehensive plans, organize into phases (1=urgent/disease control, 2=definitive, 3=maintenance)
- prescriptions: Medications prescribed (antibiotics, analgesics, mouth rinses)
- follow_up: Return visit timing and instructions
- documentation_completeness: 0.0-10.0
- clinical_accuracy: 0.0-10.0
- missing_sections: Standard sections not covered in the encounter

IMPORTANT:
- All clinical notes are DRAFTS requiring dentist attestation before use
- Do NOT fabricate findings not discussed in the encounter
- Use standard dental terminology (mesial, distal, buccal, lingual, occlusal, etc.)
- Tooth numbers use Universal Numbering System (1-32) unless Palmer notation is explicitly used
- CDT codes are suggestions only — the dentist must verify and sign off
- ICD-10-CM codes for dental: K00-K14 (diseases of oral cavity), K02 (caries), K05 (gingivitis/periodontal), K08 (other disorders)
- If a procedure was discussed but not performed, note it in the plan, not as a completed procedure`;
}

/**
 * Build the user message (dynamic, per-call transcript).
 */
export function buildUserMessage(transcriptText: string, callCategory?: string): string {
  const processedTranscript = smartTruncate(transcriptText);
  return `TRANSCRIPT:\n${processedTranscript}`;
}

/**
 * Build a combined single prompt (backward compatibility for non-Bedrock providers).
 */
export function buildAnalysisPrompt(transcriptText: string, callCategory?: string, template?: PromptTemplateConfig): string {
  const system = buildSystemPrompt(callCategory, template);
  const user = buildUserMessage(transcriptText, callCategory);
  return `${system}\n\n${user}`;
}

/**
 * Parse a JSON object from model output, handling markdown fences and extra text.
 */
export function parseJsonResponse(text: string, callId: string): CallAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ callId, responsePreview: text.slice(0, 200) }, "AI response was not parseable JSON");
    throw new Error("AI response did not contain valid JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]) as CallAnalysis;
  } catch (parseError) {
    logger.warn({ callId, err: parseError, responsePreview: text.slice(0, 300) }, "AI response JSON parse failed");
    throw new Error("AI response contained malformed JSON");
  }
}
