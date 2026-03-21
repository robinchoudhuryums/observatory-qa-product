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
  // Email channel categories
  email_support: "This is a SUPPORT EMAIL — a customer or patient wrote in requesting help. Evaluate response quality: thoroughness, empathy, accuracy, resolution, and follow-up. The 'transcript' is the email text.",
  email_billing: "This is a BILLING EMAIL — regarding payments, invoices, or financial matters. Evaluate accuracy of financial information, clarity of explanation, and resolution.",
  email_complaint: "This is a COMPLAINT EMAIL — a customer is expressing dissatisfaction. Evaluate empathy, acknowledgment, resolution offered, and de-escalation approach.",
  email_appointment: "This is an APPOINTMENT EMAIL — regarding scheduling, confirmation, or rescheduling. Evaluate responsiveness, clarity of instructions, and ease of scheduling.",
  email_insurance: "This is an INSURANCE EMAIL — regarding coverage, authorization, or claims. Evaluate accuracy of insurance information, completeness, and patient guidance.",
  email_referral: "This is a REFERRAL EMAIL — a patient or customer referral communication. Evaluate professionalism, completeness of information, and follow-up actions.",
  email_followup: "This is a FOLLOW-UP EMAIL — a post-service or post-appointment communication. Evaluate timeliness, personalization, and quality of care continuity.",
  email_general: "This is a GENERAL EMAIL — a miscellaneous inquiry or communication. Evaluate professionalism, response completeness, and clarity.",
};

export interface PromptTemplateConfig {
  evaluationCriteria?: string;
  requiredPhrases?: Array<{ phrase: string; label: string; severity: string }>;
  scoringWeights?: { compliance: number; customerExperience: number; communication: number; resolution: number };
  additionalInstructions?: string;
  /** Extracted text from company reference documents (injected automatically) */
  referenceDocuments?: Array<{ name: string; category: string; text: string }>;
  /** Provider-specific style preferences for clinical note generation */
  providerStylePreferences?: {
    noteFormat?: string;
    sectionOrder?: string[];
    abbreviationLevel?: "minimal" | "moderate" | "heavy";
    includeNegativePertinents?: boolean;
    defaultSpecialty?: string;
    customSections?: string[];
    templateOverrides?: Record<string, string>;
  };
  /** Clinical specialty for specialty-specific prompt context */
  clinicalSpecialty?: string;
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
 * Specialty-specific clinical prompt context.
 * Guides the AI on what to focus on for each medical specialty.
 */
const SPECIALTY_CONTEXT: Record<string, string> = {
  primary_care: "Focus on comprehensive assessment, preventive care recommendations, chronic disease management, medication reconciliation, and appropriate screening tests based on age/sex/risk factors.",
  internal_medicine: "Focus on complex medical decision-making, multi-system assessment, medication interactions, specialist referral appropriateness, and diagnostic reasoning for internal medicine conditions.",
  cardiology: "Focus on cardiovascular history (chest pain characterization, dyspnea classification, edema assessment), cardiac exam findings (murmurs, rhythm, JVD), cardiac medications, and risk stratification. Use ACC/AHA guidelines where applicable.",
  dermatology: "Focus on lesion description using dermatologic terminology (morphology, distribution, color, size, borders), differential diagnosis, biopsy decisions, and treatment plans. Document lesion location precisely.",
  orthopedics: "Focus on musculoskeletal exam (ROM, strength, stability testing, special tests), imaging interpretation, surgical vs. conservative management decisions, and functional limitations. Note laterality clearly.",
  psychiatry: "Focus on mental status examination (MSE), psychiatric history, safety assessment (SI/HI), medication management (psychotropics, side effects), therapeutic modality, and functional assessment. Include PHQ-9/GAD-7 scores if discussed.",
  pediatrics: "Focus on developmental milestones, growth parameters (percentiles), immunization status, age-appropriate screening, parent/caregiver concerns, and pediatric-specific dosing. Note age in years/months.",
  ob_gyn: "Focus on obstetric history (G/P), menstrual history, prenatal care elements (gestational age, fetal assessment), gynecologic exam findings, contraception counseling, and appropriate screening (Pap, mammogram).",
  emergency: "Focus on chief complaint, triage acuity, time-sensitive interventions, differential diagnosis with critical diagnoses ruled out, disposition decision-making, and discharge instructions. Document medical decision-making complexity.",
  urgent_care: "Focus on acute complaint assessment, point-of-care testing, return precautions, follow-up recommendations, and appropriate primary care referral. Document why ED referral was or was not indicated.",
  general_dentistry: "Focus on comprehensive oral examination, periodontal assessment, caries risk assessment, treatment planning, and patient education. Use CDT codes and Universal Numbering System.",
  periodontics: "Focus on periodontal charting (probing depths, CAL, BOP, mobility, furcation), classification of periodontal disease, scaling/root planing documentation, and maintenance intervals.",
  endodontics: "Focus on pulp vitality testing, periapical pathology assessment, working length determination, obturation technique, and post-treatment instructions. Note tooth number and canal anatomy.",
  oral_surgery: "Focus on surgical indications, anesthesia type, surgical technique, specimen handling (if applicable), hemostasis, and post-operative instructions. Document informed consent discussion.",
  orthodontics: "Focus on malocclusion classification, treatment objectives, appliance adjustments, compliance assessment, and treatment progress relative to planned duration.",
  prosthodontics: "Focus on prosthesis design, material selection, preparation details, impression technique, shade selection, and occlusal scheme. Document try-in results.",
  pediatric_dentistry: "Focus on behavior management technique, developmental dental assessment, caries risk assessment, fluoride recommendations, and parent education. Use primary tooth notation (A-T).",
};

/**
 * Build provider style preference instructions for clinical note generation.
 */
function buildProviderStyleSection(prefs?: PromptTemplateConfig["providerStylePreferences"]): string {
  if (!prefs) return "";

  const instructions: string[] = [];

  if (prefs.noteFormat) {
    instructions.push(`- NOTE FORMAT: Use "${prefs.noteFormat}" format for this note`);
  }

  if (prefs.abbreviationLevel) {
    const levels: Record<string, string> = {
      minimal: "Use minimal abbreviations. Write out most terms fully for maximum clarity.",
      moderate: "Use standard medical abbreviations (SOB, HTN, DM, etc.) but write out uncommon terms.",
      heavy: "Use heavy abbreviations as preferred by experienced clinicians (pt, hx, dx, tx, rx, etc.).",
    };
    instructions.push(`- ABBREVIATION STYLE: ${levels[prefs.abbreviationLevel]}`);
  }

  if (prefs.includeNegativePertinents === true) {
    instructions.push("- PERTINENT NEGATIVES: Include relevant negative findings in the ROS and physical exam (e.g., 'Denies chest pain, dyspnea, palpitations')");
  } else if (prefs.includeNegativePertinents === false) {
    instructions.push("- PERTINENT NEGATIVES: Only document positive findings unless negative findings are clinically significant");
  }

  if (prefs.sectionOrder && prefs.sectionOrder.length > 0) {
    instructions.push(`- SECTION ORDER: Organize the note sections in this order: ${prefs.sectionOrder.join(", ")}`);
  }

  if (prefs.customSections && prefs.customSections.length > 0) {
    instructions.push(`- ADDITIONAL SECTIONS: Include these custom sections in the note: ${prefs.customSections.join(", ")}`);
  }

  if (prefs.templateOverrides) {
    for (const [section, override] of Object.entries(prefs.templateOverrides)) {
      instructions.push(`- ${section.toUpperCase()} FORMAT: ${override}`);
    }
  }

  return instructions.length > 0
    ? `\nPROVIDER PREFERENCES (learned from this provider's past notes):\n${instructions.join("\n")}\n`
    : "";
}

/**
 * Build clinical documentation system prompt.
 * Supports SOAP, DAP, BIRP, and custom note formats.
 * Includes specialty-specific context and provider style preferences.
 */
function buildClinicalSystemPrompt(callCategory: string, template?: PromptTemplateConfig): string {
  const categoryContext = CATEGORY_CONTEXT[callCategory] || "";

  // Build reference documents section
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

  // Specialty-specific context
  const specialty = template?.clinicalSpecialty || template?.providerStylePreferences?.defaultSpecialty;
  const specialtySection = specialty && SPECIALTY_CONTEXT[specialty]
    ? `\nSPECIALTY CONTEXT (${specialty}):\n${SPECIALTY_CONTEXT[specialty]}\n`
    : "";

  // Provider style preferences
  const styleSection = buildProviderStyleSection(template?.providerStylePreferences);

  // Determine note format for the JSON template
  const preferredFormat = template?.providerStylePreferences?.noteFormat || "soap";
  const formatInstructions = buildFormatInstructions(preferredFormat);

  return `You are a clinical documentation AI assistant analyzing a recorded healthcare encounter. Your task is to draft structured clinical notes from the provider-patient conversation.

CALL CONTEXT:
${categoryContext}
${specialtySection}${styleSection}${referenceSection}${additionalSection}

Respond with ONLY valid JSON (no markdown, no code fences). The JSON must contain BOTH standard analysis fields AND a clinical_note object:

${formatInstructions.jsonTemplate}

Guidelines for standard fields:
- summary: Brief 1-2 sentence encounter summary
- sentiment_score: 0.0-1.0 (patient satisfaction/comfort level)
- performance_score: 0.0-10.0 (clinical documentation quality)
- sub_scores: compliance (clinical guidelines adherence), customer_experience (bedside manner), communication (clarity of explanations), resolution (addressed patient concerns)
- detected_agent_name: Provider's name if stated. Return null if uncertain.

${formatInstructions.guidelines}

IMPORTANT:
- All clinical notes are DRAFTS requiring provider attestation before use
- Do NOT fabricate clinical information not discussed in the encounter
- If information for a section was not discussed, note it in missing_sections
- Use standard medical terminology and abbreviations where appropriate
- ICD-10 and CPT codes are suggestions only — provider must verify`;
}

/**
 * Build format-specific JSON template and guidelines for clinical notes.
 * Supports: SOAP, DAP, BIRP, HPI-focused, procedure, progress.
 */
function buildFormatInstructions(format: string): { jsonTemplate: string; guidelines: string } {
  switch (format) {
    case "dap":
      return {
        jsonTemplate: `{"summary":"Brief encounter summary","topics":["presenting issue"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"dap","chief_complaint":"Presenting problem","data":"Objective and subjective data from the session — what was observed, reported, and discussed","assessment":"Clinical assessment, diagnosis, treatment effectiveness, progress toward goals","plan":["Next session focus","Homework assignments","Referrals"],"icd10_codes":[{"code":"F41.1","description":"Generalized anxiety disorder"}],"cpt_codes":[{"code":"90834","description":"Psychotherapy, 45 minutes"}],"prescriptions":[],"follow_up":"Next appointment in 1 week","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":[]}}`,
        guidelines: `Guidelines for DAP clinical_note:
- format: "dap" (Data, Assessment, Plan)
- chief_complaint: The presenting problem or reason for the session (REQUIRED — e.g., "Follow-up for generalized anxiety disorder")
- data: Combined subjective and objective data (REQUIRED). Structure as:
  * CLIENT REPORT: What the client verbally reported — symptoms since last session, life events, medication effects, sleep, appetite, stressors
  * CLINICIAN OBSERVATIONS: Observed affect (flat, congruent, labile), appearance, eye contact, psychomotor activity, speech patterns, engagement level
  * SESSION CONTENT: Key themes discussed, therapeutic interventions used (CBT, MI, psychoeducation topics), client responses to interventions
- assessment: Clinical interpretation (REQUIRED). Include: diagnosis with current severity, progress toward treatment goals (improved/stable/regressed), barriers to progress, risk assessment (SI/HI/SIB screening result), changes in functional status
- plan: Array of specific next steps (REQUIRED). Include: next session date/frequency, homework or skills to practice between sessions, referrals, medication management notes, safety plan updates if applicable
- icd10_codes: Suggest behavioral health ICD-10 codes (F-codes) based on the session
- cpt_codes: Suggest appropriate therapy CPT codes (90834 for 45min, 90837 for 60min, 90847 for family, etc.)
- documentation_completeness: 0.0-10.0
- clinical_accuracy: 0.0-10.0
- missing_sections: Standard DAP sections not adequately covered`,
      };

    case "birp":
      return {
        jsonTemplate: `{"summary":"Brief encounter summary","topics":["presenting issue"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"birp","chief_complaint":"Presenting problem","behavior":"Observable client behaviors, affect, appearance, engagement level during session","intervention":"Therapeutic interventions applied — techniques, modalities, psychoeducation provided","response":"Client's response to interventions — engagement, insight gained, resistance, emotional reactions","plan":["Next session goals","Homework","Referrals","Medication management"],"icd10_codes":[{"code":"F32.1","description":"Major depressive disorder, single episode, moderate"}],"cpt_codes":[{"code":"90837","description":"Psychotherapy, 60 minutes"}],"prescriptions":[],"follow_up":"Next session in 1 week","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":[]}}`,
        guidelines: `Guidelines for BIRP clinical_note:
- format: "birp" (Behavior, Intervention, Response, Plan)
- chief_complaint: The presenting problem or session focus (REQUIRED — e.g., "Individual therapy for PTSD with panic symptoms")
- behavior: CLIENT'S presenting behavior (REQUIRED). This is about the CLIENT, not the clinician. Document:
  * Observed affect and appearance (e.g., "Client appeared anxious, fidgeting, poor eye contact")
  * Reported symptoms and events since last session
  * Verbal and nonverbal cues during the session
  * Current mood as reported by client vs. observed mood
  * Engagement level (cooperative, guarded, resistant, tearful)
- intervention: CLINICIAN'S therapeutic interventions (REQUIRED). Be specific about what techniques were used:
  * Named modality (CBT, DBT, EMDR, MI, psychoeducation, supportive therapy)
  * Specific techniques (cognitive restructuring, exposure hierarchy, distress tolerance skills, chain analysis)
  * Topics of psychoeducation provided
  * Any crisis intervention or safety planning performed
- response: CLIENT'S response to the interventions (REQUIRED). This captures the therapeutic interaction's effectiveness:
  * Did the client engage with the intervention or resist?
  * Was insight demonstrated? (e.g., "Client identified link between avoidance and increased anxiety")
  * Were skills acquired or practiced? Note skill level (emerging, developing, established)
  * Emotional reactions during session (catharsis, frustration, relief)
  * Any shifts in perspective, motivation, or commitment to change
- plan: Array of specific next steps (REQUIRED). Include: next session focus/goals, homework assignments (be specific — not just "practice skills"), coping skills to use between sessions, referrals, safety plan updates, medication management notes
- icd10_codes: Suggest behavioral health ICD-10 codes (F-codes)
- cpt_codes: Suggest therapy CPT codes (90834, 90837, 90846, 90847, etc.)
- documentation_completeness: 0.0-10.0
- clinical_accuracy: 0.0-10.0
- missing_sections: Standard BIRP sections not covered`,
      };

    case "hpi_focused":
      return {
        jsonTemplate: `{"summary":"Brief encounter summary","topics":["chief complaint"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"hpi_focused","chief_complaint":"...","hpi_narrative":"Detailed narrative HPI using OLDCARTS framework","review_of_systems":{"constitutional":"..."},"subjective":"Additional subjective information","objective":"Physical exam and findings","assessment":"Clinical assessment","plan":["Treatment plan"],"icd10_codes":[],"cpt_codes":[],"prescriptions":[],"follow_up":"...","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":[]}}`,
        guidelines: `Guidelines for HPI-focused clinical_note:
- format: "hpi_focused"
- hpi_narrative: Detailed History of Present Illness using OLDCARTS framework (Onset, Location, Duration, Character, Aggravating factors, Relieving factors, Timing, Severity). Write as a flowing narrative paragraph.
- review_of_systems: Organized by organ system, include pertinent positives and negatives
- Other fields follow standard SOAP structure
- Emphasis on comprehensive history documentation`,
      };

    case "procedure_note":
      return {
        jsonTemplate: `{"summary":"Brief procedure summary","topics":["procedure performed"],"sentiment":"neutral","sentiment_score":0.5,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["post-procedure items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"procedure_note","chief_complaint":"Indication for procedure","subjective":"Pre-procedure assessment","objective":"Procedure details: technique, findings, specimens, complications","assessment":"Post-procedure assessment","plan":["Post-procedure care instructions"],"icd10_codes":[],"cpt_codes":[],"prescriptions":[],"follow_up":"Post-procedure follow-up plan","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":[]}}`,
        guidelines: `Guidelines for procedure note clinical_note:
- format: "procedure_note"
- chief_complaint: Indication/reason for the procedure
- subjective: Pre-procedure assessment, consent discussion, patient symptoms
- objective: Procedure details — technique used, anesthesia, findings during procedure, specimens obtained, estimated blood loss, complications or lack thereof
- assessment: Post-procedure status, immediate outcomes
- plan: Post-procedure care, activity restrictions, follow-up schedule, wound care
- Include appropriate procedure CPT codes`,
      };

    default: // SOAP (default)
      return {
        jsonTemplate: `{"summary":"Brief encounter summary","topics":["chief complaint","relevant topics"],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["follow-up items"],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"medical_facility","flags":[],"detected_agent_name":null,"clinical_note":{"format":"soap","chief_complaint":"...","subjective":"Patient history and symptoms as reported","objective":"Physical exam findings, vitals, observations mentioned","assessment":"Clinical assessment and diagnoses","plan":["Treatment plan items"],"hpi_narrative":"Detailed HPI narrative","review_of_systems":{"constitutional":"...","cardiovascular":"..."},"differential_diagnoses":["..."],"icd10_codes":[{"code":"Z00.00","description":"General adult medical examination"}],"cpt_codes":[{"code":"99213","description":"Office visit, established patient, low complexity"}],"prescriptions":[{"medication":"...","dosage":"...","instructions":"..."}],"follow_up":"Return in 2 weeks","documentation_completeness":0.0,"clinical_accuracy":0.0,"missing_sections":["sections not covered in the encounter"]}}`,
        guidelines: `Guidelines for SOAP clinical_note:
- format: "soap" (Subjective, Objective, Assessment, Plan)
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
- missing_sections: List any standard documentation sections NOT covered in the encounter`,
      };
  }
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
 * Build system prompt specifically for email analysis.
 * Emails don't have timestamps, speakers, or talk speed — focus on written communication quality.
 */
export function buildEmailSystemPrompt(emailCategory?: string, template?: PromptTemplateConfig): string {
  const categoryContext = emailCategory && CATEGORY_CONTEXT[emailCategory]
    ? `\nEMAIL CONTEXT:\n${CATEGORY_CONTEXT[emailCategory]}\n`
    : "";

  let evaluationCriteria: string;
  if (template?.evaluationCriteria) {
    evaluationCriteria = `- EVALUATION CRITERIA:\n${template.evaluationCriteria}`;
  } else {
    evaluationCriteria = "- Evaluate on: professionalism, accuracy, completeness, empathy, clarity, resolution, and response timeliness";
  }

  let scoringSection = "";
  if (template?.scoringWeights) {
    const w = template.scoringWeights;
    scoringSection = `\n- SCORING WEIGHTS: Compliance (${w.compliance}%), Customer Experience (${w.customerExperience}%), Communication (${w.communication}%), Resolution (${w.resolution}%). Weight your performance_score accordingly.`;
  }

  let phrasesSection = "";
  if (template?.requiredPhrases && template.requiredPhrases.length > 0) {
    const required = template.requiredPhrases.filter(p => p.severity === "required");
    const recommended = template.requiredPhrases.filter(p => p.severity === "recommended");
    if (required.length > 0) {
      phrasesSection += `\n- REQUIRED ELEMENTS: The email MUST include something equivalent to the following. Flag "missing_required_phrase:<label>" for each missing element:\n`;
      phrasesSection += required.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
    if (recommended.length > 0) {
      phrasesSection += `\n- RECOMMENDED ELEMENTS: The email SHOULD include these. Note in suggestions if missing:\n`;
      phrasesSection += recommended.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
  }

  let referenceSection = "";
  if (template?.referenceDocuments && template.referenceDocuments.length > 0) {
    const ragText = template.referenceDocuments.map(d => d.text).join("\n\n");
    referenceSection = `\n- COMPANY KNOWLEDGE BASE: Use the following excerpts to evaluate accuracy and compliance:\n${ragText}`;
  }

  let additionalSection = "";
  if (template?.additionalInstructions) {
    additionalSection = `\n- ADDITIONAL INSTRUCTIONS:\n${template.additionalInstructions}`;
  }

  return `You are analyzing an email communication for quality assurance. This is a TEXT-BASED communication (not a phone call) — do NOT reference audio, voice quality, or tone of voice. Focus on written communication quality.
${categoryContext}
Respond with ONLY valid JSON (no markdown, no code fences):
{"summary":"...","topics":["..."],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["..."],"feedback":{"strengths":["..."],"suggestions":["..."]},"call_party_type":"customer|insurance|medical_facility|vendor|internal|other","flags":[],"detected_agent_name":null}

Guidelines:
- sentiment_score: 0.0-1.0 (1.0 = most positive)
- performance_score: 0.0-10.0 (overall weighted score)
- sub_scores (each 0.0-10.0): compliance (policies, accuracy), customer_experience (empathy, helpfulness, tone), communication (clarity, grammar, completeness, formatting), resolution (issue resolution, next steps, follow-up)
${evaluationCriteria}${scoringSection}${phrasesSection}${referenceSection}${additionalSection}
- For strengths/suggestions, do NOT include timestamps (this is email, not audio)
- 2-4 concrete, actionable action items
- Topics: specific (e.g. "insurance inquiry", "appointment request"), not generic
- detected_agent_name: Employee's name if present in the email signature or greeting. Return null if uncertain.
- flags: "low_score" if performance ≤2.0, "exceptional_call" if ≥9.0, "urgent" if email requires immediate attention, "escalation_needed" if the issue should be escalated`;
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

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    logger.warn({ callId, err: parseError, responsePreview: text.slice(0, 300) }, "AI response JSON parse failed");
    throw new Error("AI response contained malformed JSON");
  }

  // Validate and normalize with safe defaults for missing/malformed fields
  const clampScore = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const toStringArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter(x => typeof x === "string" || typeof x === "object").map(x => typeof x === "string" ? x : String(x));
    if (typeof v === "string") return [v];
    return [];
  };

  const rawSubScores = (raw.sub_scores && typeof raw.sub_scores === "object" && !Array.isArray(raw.sub_scores))
    ? raw.sub_scores as Record<string, unknown>
    : {};

  const rawFeedback = (raw.feedback && typeof raw.feedback === "object" && !Array.isArray(raw.feedback))
    ? raw.feedback as Record<string, unknown>
    : {};

  const analysis: CallAnalysis = {
    summary: typeof raw.summary === "string" ? raw.summary : "",
    topics: toStringArray(raw.topics),
    sentiment: typeof raw.sentiment === "string" ? raw.sentiment : "neutral",
    sentiment_score: clampScore(raw.sentiment_score, 0, 1, 0.5),
    performance_score: clampScore(raw.performance_score, 0, 10, 5.0),
    sub_scores: {
      compliance: clampScore(rawSubScores.compliance, 0, 10, 5.0),
      customer_experience: clampScore(rawSubScores.customer_experience, 0, 10, 5.0),
      communication: clampScore(rawSubScores.communication, 0, 10, 5.0),
      resolution: clampScore(rawSubScores.resolution, 0, 10, 5.0),
    },
    action_items: toStringArray(raw.action_items),
    feedback: {
      strengths: Array.isArray(rawFeedback.strengths) ? rawFeedback.strengths : [],
      suggestions: Array.isArray(rawFeedback.suggestions) ? rawFeedback.suggestions : [],
    },
    call_party_type: typeof raw.call_party_type === "string" ? raw.call_party_type : "other",
    flags: toStringArray(raw.flags),
    detected_agent_name: typeof raw.detected_agent_name === "string" ? raw.detected_agent_name : null,
  };

  // Carry through clinical_note if present
  if (raw.clinical_note && typeof raw.clinical_note === "object") {
    analysis.clinical_note = raw.clinical_note as CallAnalysis["clinical_note"];
  }

  // Log if we had to fix missing fields
  const missingFields: string[] = [];
  if (!raw.summary) missingFields.push("summary");
  if (!raw.performance_score && raw.performance_score !== 0) missingFields.push("performance_score");
  if (!raw.sub_scores) missingFields.push("sub_scores");
  if (!raw.feedback) missingFields.push("feedback");
  if (missingFields.length > 0) {
    logger.warn({ callId, missingFields }, "AI response missing fields — defaults applied");
  }

  return analysis;
}
