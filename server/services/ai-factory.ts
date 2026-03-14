/**
 * Factory that selects the AI analysis provider based on configuration.
 *
 * Uses AWS Bedrock (Claude) as the sole AI provider.
 * Per-org model overrides are supported via OrgSettings.bedrockModel.
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { BedrockProvider } from "./bedrock";
import type { OrgSettings } from "@shared/schema";
import { logger } from "./logger";

function createProvider(modelOverride?: string): AIAnalysisProvider {
  const provider = new BedrockProvider(modelOverride);
  if (provider.isAvailable) return provider;

  logger.warn("AWS credentials not configured — AI analysis will use transcript-based defaults");
  return provider;
}

// Default global provider (used when no org-specific config exists)
export const aiProvider = createProvider();

// Cache of per-org providers to avoid re-creating on every call
const orgProviderCache = new Map<string, AIAnalysisProvider>();

/**
 * Get the AI provider for a specific organization.
 * Uses org settings for model override, falling back to global default.
 */
export function getOrgAIProvider(orgId: string, orgSettings?: OrgSettings | null): AIAnalysisProvider {
  if (!orgSettings?.bedrockModel) {
    return aiProvider; // Use global default
  }

  const cacheKey = `${orgId}:${orgSettings.bedrockModel}`;
  const cached = orgProviderCache.get(cacheKey);
  if (cached) return cached;

  const provider = new BedrockProvider(orgSettings.bedrockModel);
  const resolved = provider.isAvailable ? provider : aiProvider;
  orgProviderCache.set(cacheKey, resolved);
  return resolved;
}
