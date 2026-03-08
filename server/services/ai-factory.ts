/**
 * Factory that selects the AI analysis provider based on configuration.
 *
 * Priority:
 *   1. Per-org AI provider (from OrgSettings.aiProvider / bedrockModel)
 *   2. AI_PROVIDER env var (explicit choice: "gemini" or "bedrock")
 *   3. Auto-detect based on available credentials
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { GeminiProvider } from "./gemini";
import { BedrockProvider } from "./bedrock";
import type { OrgSettings } from "@shared/schema";

function createProvider(modelOverride?: string): AIAnalysisProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();

  if (explicit === "bedrock") {
    const provider = new BedrockProvider(modelOverride);
    if (provider.isAvailable) return provider;
    console.warn("AI_PROVIDER=bedrock but AWS credentials missing. Falling back to Gemini.");
  }

  if (explicit === "gemini" || !explicit) {
    const gemini = new GeminiProvider();
    if (gemini.isAvailable) return gemini;
  }

  // Auto-detect: try Bedrock if Gemini wasn't available
  if (!explicit) {
    const bedrock = new BedrockProvider(modelOverride);
    if (bedrock.isAvailable) return bedrock;
  }

  // No provider available — return a Gemini stub (isAvailable = false)
  console.warn("No AI analysis provider configured. Analysis will use transcript-based defaults.");
  return new GeminiProvider();
}

// Default global provider (used when no org-specific config exists)
export const aiProvider = createProvider();

// Cache of per-org providers to avoid re-creating on every call
const orgProviderCache = new Map<string, AIAnalysisProvider>();

/**
 * Get the AI provider for a specific organization.
 * Uses org settings to select provider/model, falling back to global default.
 */
export function getOrgAIProvider(orgId: string, orgSettings?: OrgSettings | null): AIAnalysisProvider {
  if (!orgSettings?.aiProvider) {
    return aiProvider; // Use global default
  }

  const cacheKey = `${orgId}:${orgSettings.aiProvider}`;
  const cached = orgProviderCache.get(cacheKey);
  if (cached) return cached;

  let provider: AIAnalysisProvider;
  if (orgSettings.aiProvider === "bedrock") {
    provider = new BedrockProvider();
    if (!provider.isAvailable) provider = aiProvider; // Fallback to global
  } else if (orgSettings.aiProvider === "gemini") {
    provider = new GeminiProvider();
    if (!provider.isAvailable) provider = aiProvider;
  } else {
    provider = aiProvider;
  }

  orgProviderCache.set(cacheKey, provider);
  return provider;
}
