/**
 * Score Calibration Service
 *
 * AI models (Claude via Bedrock) tend to cluster performance scores around 7.0,
 * making it hard to differentiate between good and great calls. This service
 * normalizes the raw AI score distribution to a configurable target.
 *
 * Algorithm: Shifted z-score normalization.
 *   calibrated = targetCenter + ((raw - aiMean) / aiSpread) * targetSpread
 *   Clamped to [0, 10].
 *
 * Configuration via env vars (all optional):
 *   SCORE_CALIBRATION_ENABLED  = "true" to enable (default: disabled)
 *   SCORE_CALIBRATION_CENTER   = desired mean (default: 5.5)
 *   SCORE_CALIBRATION_SPREAD   = desired spread/std-dev (default: 1.2)
 *   SCORE_AI_MODEL_MEAN        = observed AI model mean (default: 7.0)
 *   SCORE_AI_MODEL_SPREAD      = observed AI model spread (default: 1.0)
 *   SCORE_LOW_THRESHOLD        = low score alert threshold (default: 4.0)
 *   SCORE_HIGH_THRESHOLD       = high score alert threshold (default: 9.0)
 *
 * Per-org overrides can be stored in org.settings.scoringCalibration.
 */
import { logger } from "./logger";

interface CalibrationConfig {
  enabled: boolean;
  targetCenter: number;
  targetSpread: number;
  aiModelMean: number;
  aiModelSpread: number;
  lowThreshold: number;
  highThreshold: number;
}

function getGlobalConfig(): CalibrationConfig {
  return {
    enabled: process.env.SCORE_CALIBRATION_ENABLED === "true",
    targetCenter: parseFloat(process.env.SCORE_CALIBRATION_CENTER || "5.5"),
    targetSpread: parseFloat(process.env.SCORE_CALIBRATION_SPREAD || "1.2"),
    aiModelMean: parseFloat(process.env.SCORE_AI_MODEL_MEAN || "7.0"),
    aiModelSpread: parseFloat(process.env.SCORE_AI_MODEL_SPREAD || "1.0"),
    lowThreshold: parseFloat(process.env.SCORE_LOW_THRESHOLD || "4.0"),
    highThreshold: parseFloat(process.env.SCORE_HIGH_THRESHOLD || "9.0"),
  };
}

function mergeConfig(orgSettings?: any): CalibrationConfig {
  const global = getGlobalConfig();
  const orgCal = orgSettings?.scoringCalibration;
  if (!orgCal) return global;

  return {
    enabled: orgCal.enabled ?? global.enabled,
    targetCenter: orgCal.targetCenter ?? global.targetCenter,
    targetSpread: orgCal.targetSpread ?? global.targetSpread,
    aiModelMean: orgCal.aiModelMean ?? global.aiModelMean,
    aiModelSpread: orgCal.aiModelSpread ?? global.aiModelSpread,
    lowThreshold: orgCal.lowThreshold ?? global.lowThreshold,
    highThreshold: orgCal.highThreshold ?? global.highThreshold,
  };
}

/**
 * Calibrate a single score.
 */
function calibrateScore(raw: number, config: CalibrationConfig): number {
  if (!config.enabled || config.aiModelSpread === 0) return raw;

  const zScore = (raw - config.aiModelMean) / config.aiModelSpread;
  const calibrated = config.targetCenter + zScore * config.targetSpread;

  // Clamp to valid range
  return Math.round(Math.max(0, Math.min(10, calibrated)) * 10) / 10;
}

/**
 * Calibrate a full analysis result (overall score + sub-scores).
 * Returns a new object — does NOT mutate the input.
 */
export function calibrateAnalysis(
  analysis: {
    performance_score: number;
    sub_scores: { compliance: number; customer_experience: number; communication: number; resolution: number };
  },
  orgSettings?: any,
): {
  performance_score: number;
  sub_scores: { compliance: number; customer_experience: number; communication: number; resolution: number };
  calibration_applied: boolean;
} {
  const config = mergeConfig(orgSettings);

  if (!config.enabled) {
    return {
      ...analysis,
      calibration_applied: false,
    };
  }

  const result = {
    performance_score: calibrateScore(analysis.performance_score, config),
    sub_scores: {
      compliance: calibrateScore(analysis.sub_scores.compliance, config),
      customer_experience: calibrateScore(analysis.sub_scores.customer_experience, config),
      communication: calibrateScore(analysis.sub_scores.communication, config),
      resolution: calibrateScore(analysis.sub_scores.resolution, config),
    },
    calibration_applied: true,
  };

  logger.debug({
    originalScore: analysis.performance_score,
    calibratedScore: result.performance_score,
    config: { center: config.targetCenter, spread: config.targetSpread },
  }, "Score calibration applied");

  return result;
}

/**
 * Check if a score triggers low/high alerts (uses calibrated thresholds).
 */
export function getScoreAlertLevel(
  score: number,
  orgSettings?: any,
): "low" | "high" | null {
  const config = mergeConfig(orgSettings);
  if (score <= config.lowThreshold) return "low";
  if (score >= config.highThreshold) return "high";
  return null;
}

/**
 * Check if calibration is enabled for an org.
 */
export function isCalibrationEnabled(orgSettings?: any): boolean {
  return mergeConfig(orgSettings).enabled;
}
