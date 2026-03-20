/**
 * Style Learning Service
 *
 * Analyzes a provider's past attested clinical notes to automatically learn
 * style preferences. Learned preferences are stored in
 * org.settings.providerStylePreferences[userId].
 *
 * HIPAA: This service processes clinical note content for style analysis only.
 * No PHI is logged — only aggregate metrics (counts, lengths, format labels).
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single clinical note passed in for analysis. */
export interface ClinicalNote {
  /** When the note was attested (ISO string or Date). Used for recency weighting. */
  attestedAt: string | Date;
  /** The specialty associated with this note, if known. */
  specialty?: string;
  /** Note sections keyed by section name (e.g. "subjective", "objective"). */
  sections: Record<string, string>;
  /** The full note text (used when sections aren't broken out). */
  fullText?: string;
}

/** Confidence-scored value for a single learned preference. */
export interface ScoredPreference<T> {
  value: T;
  confidence: number; // 0–1
}

/** Full result returned by analyzeProviderStyle. */
export interface StyleAnalysisResult {
  noteFormat: ScoredPreference<string>;
  abbreviationLevel: ScoredPreference<"minimal" | "moderate" | "heavy">;
  includeNegativePertinents: ScoredPreference<boolean>;
  sectionEmphasis: ScoredPreference<string>;
  commonPhrases: ScoredPreference<string[]>;
  avgNoteLength: number;
  preferredSpecialty: ScoredPreference<string> | null;
  /** Ready-to-store object matching the providerStylePreferences schema. */
  suggestedPreferences: {
    noteFormat?: string;
    sectionOrder?: string[];
    abbreviationLevel?: "minimal" | "moderate" | "heavy";
    includeNegativePertinents?: boolean;
    defaultSpecialty?: string;
    customSections?: string[];
    templateOverrides?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_NOTES_REQUIRED = 3;

/** Exponential decay half-life in days — notes older than this get half weight. */
const HALF_LIFE_DAYS = 30;

const NOTE_FORMAT_PATTERNS: Record<string, RegExp[]> = {
  soap: [/\bsubjective\b/i, /\bobjective\b/i, /\bassessment\b/i, /\bplan\b/i],
  dap: [/\bdata\b/i, /\bassessment\b/i, /\bplan\b/i],
  birp: [/\bbehavior\b/i, /\bintervention\b/i, /\bresponse\b/i, /\bplan\b/i],
  hpi_focused: [/\bhpi\b/i, /\bhistory of present/i, /\breview of systems/i],
  procedure_note: [/\bprocedure\b/i, /\bindication/i, /\bfindings\b/i, /\bcomplication/i],
};

const NEGATIVE_PERTINENT_PHRASES = [
  "denies",
  "no evidence of",
  "negative for",
  "without",
  "no signs of",
  "no history of",
  "unremarkable",
  "within normal limits",
  "no complaint",
  "non-tender",
  "no acute",
];

const SECTION_GROUPS: Record<string, string[]> = {
  subjective: ["subjective", "chief complaint", "hpi", "history of present illness", "cc"],
  objective: ["objective", "physical exam", "examination", "vitals", "review of systems", "ros"],
  assessment: ["assessment", "impression", "diagnosis", "diagnoses"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute exponential decay weight for a note based on its age. */
function recencyWeight(attestedAt: string | Date, now: Date): number {
  const noteDate = new Date(attestedAt);
  const ageDays = (now.getTime() - noteDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Get all text from a note as a single string. */
function getNoteText(note: ClinicalNote): string {
  if (note.fullText) return note.fullText;
  return Object.values(note.sections).join("\n");
}

/** Get total character count across all sections of a note. */
function getNoteLength(note: ClinicalNote): number {
  return getNoteText(note).length;
}

/** Count occurrences of a phrase (case-insensitive) in text. */
function countPhrase(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(escaped, "gi"));
  return matches ? matches.length : 0;
}

/**
 * Extract n-grams (2–4 words) from text, returning frequency map.
 * Filters out very short or stop-word-heavy n-grams.
 */
function extractPhrases(text: string): Map<string, number> {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "and", "or", "but",
    "not", "no", "this", "that", "it", "its", "he", "she", "they", "we",
  ]);

  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(w => w.length > 1);
  const phrases = new Map<string, number>();

  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n);
      // Skip if majority are stop words
      const stopCount = gram.filter(w => stopWords.has(w)).length;
      if (stopCount > gram.length / 2) continue;
      const phrase = gram.join(" ");
      if (phrase.length < 5) continue;
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }

  return phrases;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Analyze a provider's attested clinical notes to learn style preferences.
 *
 * @returns StyleAnalysisResult with learned preferences and confidence scores,
 *          or null if fewer than MIN_NOTES_REQUIRED notes are provided.
 */
export function analyzeProviderStyle(
  orgId: string,
  userId: string,
  notes: ClinicalNote[],
): StyleAnalysisResult | null {
  if (notes.length < MIN_NOTES_REQUIRED) {
    logger.info(
      { orgId, userId, noteCount: notes.length, required: MIN_NOTES_REQUIRED },
      "Not enough attested notes for style analysis",
    );
    return null;
  }

  const now = new Date();
  const weights = notes.map(n => recencyWeight(n.attestedAt, now));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // --- Note format detection ---
  const formatScores: Record<string, number> = {};
  for (const [format, patterns] of Object.entries(NOTE_FORMAT_PATTERNS)) {
    let weightedScore = 0;
    for (let i = 0; i < notes.length; i++) {
      const text = getNoteText(notes[i]);
      const sectionKeys = Object.keys(notes[i].sections).map(k => k.toLowerCase());
      const combined = text + " " + sectionKeys.join(" ");
      const matched = patterns.filter(p => p.test(combined)).length;
      weightedScore += (matched / patterns.length) * weights[i];
    }
    formatScores[format] = weightedScore / totalWeight;
  }
  const bestFormat = Object.entries(formatScores).sort((a, b) => b[1] - a[1])[0];
  const noteFormat: ScoredPreference<string> = {
    value: bestFormat[0],
    confidence: Math.min(bestFormat[1], 1),
  };

  // --- Abbreviation level ---
  let weightedDensity = 0;
  for (let i = 0; i < notes.length; i++) {
    const length = getNoteLength(notes[i]);
    weightedDensity += length * weights[i];
  }
  const avgWeightedLength = weightedDensity / totalWeight;
  let abbreviationValue: "minimal" | "moderate" | "heavy";
  let abbreviationConfidence: number;
  if (avgWeightedLength < 400) {
    abbreviationValue = "heavy";
    abbreviationConfidence = Math.min(1, (400 - avgWeightedLength) / 300);
  } else if (avgWeightedLength > 1200) {
    abbreviationValue = "minimal";
    abbreviationConfidence = Math.min(1, (avgWeightedLength - 1200) / 800);
  } else {
    abbreviationValue = "moderate";
    // Confidence peaks at the midpoint (800 chars)
    abbreviationConfidence = 1 - Math.abs(avgWeightedLength - 800) / 400;
  }
  const abbreviationLevel: ScoredPreference<"minimal" | "moderate" | "heavy"> = {
    value: abbreviationValue,
    confidence: Math.max(0.1, abbreviationConfidence),
  };

  // --- Negative pertinents ---
  let weightedNegCount = 0;
  let weightedNoteCount = 0;
  for (let i = 0; i < notes.length; i++) {
    const text = getNoteText(notes[i]);
    const hasNeg = NEGATIVE_PERTINENT_PHRASES.some(phrase => countPhrase(text, phrase) > 0);
    if (hasNeg) weightedNegCount += weights[i];
    weightedNoteCount += weights[i];
  }
  const negRatio = weightedNegCount / weightedNoteCount;
  const includeNegativePertinents: ScoredPreference<boolean> = {
    value: negRatio >= 0.5,
    confidence: Math.abs(negRatio - 0.5) * 2, // 0 at 50/50, 1 at 100% or 0%
  };

  // --- Section emphasis ---
  const sectionLengths: Record<string, number> = {};
  const sectionWeights: Record<string, number> = {};
  for (let i = 0; i < notes.length; i++) {
    for (const [sectionName, content] of Object.entries(notes[i].sections)) {
      const normalized = sectionName.toLowerCase().trim();
      // Map to group
      let group = normalized;
      for (const [groupName, aliases] of Object.entries(SECTION_GROUPS)) {
        if (aliases.includes(normalized)) {
          group = groupName;
          break;
        }
      }
      sectionLengths[group] = (sectionLengths[group] || 0) + content.length * weights[i];
      sectionWeights[group] = (sectionWeights[group] || 0) + weights[i];
    }
  }
  // Normalize by count to get average weighted length per section group
  const avgSectionLengths: Record<string, number> = {};
  for (const group of Object.keys(sectionLengths)) {
    avgSectionLengths[group] = sectionLengths[group] / (sectionWeights[group] || 1);
  }
  const sortedSections = Object.entries(avgSectionLengths).sort((a, b) => b[1] - a[1]);
  const longestSection = sortedSections[0];
  const sectionEmphasis: ScoredPreference<string> = longestSection
    ? {
        value: longestSection[0],
        confidence: sortedSections.length > 1
          ? Math.min(1, longestSection[1] / (sortedSections[1][1] || 1) - 1)
          : 0.5,
      }
    : { value: "unknown", confidence: 0 };

  // --- Common phrases ---
  const globalPhrases = new Map<string, number>();
  for (let i = 0; i < notes.length; i++) {
    const text = getNoteText(notes[i]);
    const notePhrases = extractPhrases(text);
    Array.from(notePhrases.entries()).forEach(([phrase, count]) => {
      globalPhrases.set(phrase, (globalPhrases.get(phrase) || 0) + count * weights[i]);
    });
  }
  // Keep phrases appearing in multiple notes with decent frequency
  const phraseEntries = Array.from(globalPhrases.entries())
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxPhraseScore = phraseEntries.length > 0 ? phraseEntries[0][1] : 1;
  const commonPhrases: ScoredPreference<string[]> = {
    value: phraseEntries.map(([phrase]) => phrase),
    confidence: phraseEntries.length > 0 ? Math.min(1, phraseEntries.length / 5) : 0,
  };

  // --- Average note length ---
  const avgNoteLength = notes.reduce((sum, n) => sum + getNoteLength(n), 0) / notes.length;

  // --- Preferred specialty ---
  const specialtyCounts = new Map<string, number>();
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].specialty) {
      const sp = notes[i].specialty!.toLowerCase().trim();
      specialtyCounts.set(sp, (specialtyCounts.get(sp) || 0) + weights[i]);
    }
  }
  let preferredSpecialty: ScoredPreference<string> | null = null;
  if (specialtyCounts.size > 0) {
    const sorted = Array.from(specialtyCounts.entries()).sort((a, b) => b[1] - a[1]);
    preferredSpecialty = {
      value: sorted[0][0],
      confidence: Math.min(1, sorted[0][1] / totalWeight),
    };
  }

  // --- Section order (from most common ordering) ---
  const orderCounts = new Map<string, number>();
  for (let i = 0; i < notes.length; i++) {
    const order = Object.keys(notes[i].sections).map(k => k.toLowerCase().trim()).join(",");
    if (order) {
      orderCounts.set(order, (orderCounts.get(order) || 0) + weights[i]);
    }
  }
  const bestOrder = Array.from(orderCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const sectionOrder = bestOrder ? bestOrder[0].split(",") : undefined;

  // --- Custom sections (sections outside standard groups) ---
  const allSections = new Set<string>();
  const standardSections = new Set(Object.values(SECTION_GROUPS).flat());
  for (const note of notes) {
    for (const key of Object.keys(note.sections)) {
      const normalized = key.toLowerCase().trim();
      if (!standardSections.has(normalized)) {
        allSections.add(normalized);
      }
    }
  }
  const customSections = allSections.size > 0 ? Array.from(allSections) : undefined;

  // --- Build suggested preferences ---
  const suggestedPreferences: StyleAnalysisResult["suggestedPreferences"] = {
    noteFormat: noteFormat.confidence >= 0.3 ? noteFormat.value : undefined,
    sectionOrder,
    abbreviationLevel: abbreviationLevel.confidence >= 0.2 ? abbreviationLevel.value : undefined,
    includeNegativePertinents: includeNegativePertinents.confidence >= 0.3
      ? includeNegativePertinents.value
      : undefined,
    defaultSpecialty: preferredSpecialty && preferredSpecialty.confidence >= 0.4
      ? preferredSpecialty.value
      : undefined,
    customSections,
  };

  logger.info(
    {
      orgId,
      userId,
      noteCount: notes.length,
      detectedFormat: noteFormat.value,
      formatConfidence: noteFormat.confidence.toFixed(2),
      abbreviation: abbreviationLevel.value,
      avgNoteLength: Math.round(avgNoteLength),
    },
    "Style analysis completed",
  );

  return {
    noteFormat,
    abbreviationLevel,
    includeNegativePertinents,
    sectionEmphasis,
    commonPhrases,
    avgNoteLength: Math.round(avgNoteLength),
    preferredSpecialty,
    suggestedPreferences,
  };
}

// ---------------------------------------------------------------------------
// AI prompt builder (for future Bedrock-based analysis)
// ---------------------------------------------------------------------------

/**
 * Build a prompt for Bedrock (Claude) to perform nuanced style analysis
 * on a batch of clinical notes. Returns structured JSON observations.
 *
 * Usage: send this prompt to the AI provider and parse the JSON response.
 */
export function buildStyleLearningPrompt(notes: ClinicalNote[]): string {
  const notesSummary = notes.map((note, idx) => {
    const sections = Object.entries(note.sections)
      .map(([name, content]) => `### ${name}\n${content}`)
      .join("\n\n");
    const text = sections || note.fullText || "(empty)";
    return `--- Note ${idx + 1} (${note.specialty || "unspecified specialty"}, attested ${new Date(note.attestedAt).toISOString().split("T")[0]}) ---\n${text}`;
  }).join("\n\n");

  return `You are a clinical documentation analyst. Analyze the following ${notes.length} attested clinical notes from the same provider and identify their documentation style patterns.

Return your analysis as a JSON object with exactly these fields:
{
  "noteFormat": { "value": "soap|dap|birp|hpi_focused|procedure_note|other", "reasoning": "..." },
  "abbreviationLevel": { "value": "minimal|moderate|heavy", "reasoning": "..." },
  "includeNegativePertinents": { "value": true|false, "reasoning": "..." },
  "sectionEmphasis": { "value": "subjective|objective|assessment|plan|other", "reasoning": "..." },
  "commonPhrases": ["phrase1", "phrase2", ...],
  "writingStyle": {
    "usesCompleteSeences": true|false,
    "usesListFormat": true|false,
    "formalityLevel": "formal|semiformal|informal",
    "typicalVoice": "active|passive|mixed"
  },
  "templateSuggestions": {
    "sectionOrder": ["section1", "section2", ...],
    "customSections": ["any non-standard sections used"],
    "boilerplatePatterns": ["repeated phrases that could become templates"]
  }
}

Focus on patterns that are consistent across multiple notes. Distinguish between idiosyncratic style choices and standard clinical conventions.

IMPORTANT: Return ONLY the JSON object, no additional text.

=== CLINICAL NOTES ===

${notesSummary}`;
}
