/**
 * AWS Bedrock + Claude provider for call analysis.
 *
 * Authentication — uses AWS Signature V4 via standard env vars:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials / IAM roles)
 *
 * HIPAA: Bedrock is HIPAA-eligible under the AWS BAA.
 * Just ensure your AWS account has a BAA in place.
 *
 * Uses the Bedrock "Converse" API (no SDK needed, plain fetch + SigV4).
 *
 * OPTIMIZATION: System prompt is sent as a separate cacheable field.
 * Bedrock caches system prompts across requests with the same prefix,
 * reducing input token costs by 25-40% for repeated analysis calls.
 */
import { createHash } from "crypto";
import { hmac, hmacHex, getSignatureKey, sha256Hex } from "./aws-credentials";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildSystemPrompt, buildUserMessage, parseJsonResponse } from "./ai-provider";
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials";
import { logger } from "./logger";

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
const BEDROCK_TIMEOUT_MS = 120_000; // 2 minutes — long transcripts may need >60s

export class BedrockProvider implements AIAnalysisProvider {
  readonly name = "bedrock";
  private credentials: AwsCredentials | null = null;
  private model: string;
  private credentialsInitialized = false;

  /**
   * @param modelOverride - Per-org model override (from OrgSettings.bedrockModel)
   */
  constructor(modelOverride?: string) {
    this.model = modelOverride || process.env.BEDROCK_MODEL || DEFAULT_MODEL;

    // Eagerly try env vars for backward compat (async IMDSv2 resolved on first use)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
        region: process.env.AWS_REGION?.trim() || "us-east-1",
        source: "env" as const,
      };
      this.credentialsInitialized = true;
      logger.info({ region: this.credentials.region, model: this.model }, "Bedrock provider initialized (env credentials)");
    } else {
      logger.info({ model: this.model }, "Bedrock provider: will attempt IMDSv2 on first use");
    }
  }

  /**
   * Ensure credentials are resolved (env or IMDSv2).
   */
  private async ensureCredentials(): Promise<void> {
    if (this.credentialsInitialized && this.credentials) {
      // Check if IMDSv2 creds are about to expire
      if (this.credentials.expiresAt) {
        const bufferMs = 5 * 60 * 1000;
        if (this.credentials.expiresAt.getTime() - Date.now() < bufferMs) {
          this.credentials = await getAwsCredentials();
        }
      }
      return;
    }
    this.credentials = await getAwsCredentials();
    this.credentialsInitialized = true;
    if (this.credentials) {
      logger.info({ source: this.credentials.source, region: this.credentials.region, model: this.model }, "Bedrock provider credentials resolved");
    } else {
      logger.warn("Bedrock provider: No AWS credentials available (checked env + IMDSv2)");
    }
  }

  /** Create a provider with a specific model — used for A/B testing. */
  static createWithModel(modelId: string): BedrockProvider {
    return new BedrockProvider(modelId);
  }

  get modelId(): string {
    return this.model;
  }

  get isAvailable(): boolean {
    // If credentials haven't been resolved yet (IMDSv2 path), optimistically return true
    // since ensureCredentials() will resolve them on first use
    if (!this.credentialsInitialized) return true;
    return this.credentials !== null;
  }

  async generateText(prompt: string): Promise<string> {
    await this.ensureCredentials();
    if (!this.credentials) {
      throw new Error("Bedrock provider not configured — no AWS credentials available");
    }

    const region = this.credentials.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
    });

    const headers = this.signRequest("POST", host, rawPath, body, region);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });

      if (!response.ok) {
        const errorText = await response.text();
        // HIPAA: Truncate error to avoid leaking PHI in logs
        throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      this.logTokenUsage(result, "generateText");
      return result.output?.message?.content?.[0]?.text || "";
    } finally {
      clearTimeout(timeout);
    }
  }

  async analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: any): Promise<CallAnalysis> {
    await this.ensureCredentials();
    if (!this.credentials) {
      throw new Error("Bedrock provider not configured — no AWS credentials available");
    }

    // Split prompt into cacheable system prompt + dynamic user message
    const systemPrompt = buildSystemPrompt(callCategory, promptTemplate);
    const userMessage = buildUserMessage(transcriptText, callCategory);

    const region = this.credentials.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    // System prompt is sent separately — Bedrock caches it across requests
    // with identical system prompt prefixes, reducing input token costs
    const body = JSON.stringify({
      system: [{ text: systemPrompt }],
      messages: [
        { role: "user", content: [{ text: userMessage }] },
      ],
      inferenceConfig: {
        temperature: 0.3,
        maxTokens: 2048,
      },
    });

    logger.info({ callId, model: this.model, systemPromptLen: systemPrompt.length, userMsgLen: userMessage.length }, "Calling Bedrock for analysis");

    const headers = this.signRequest("POST", host, rawPath, body, region);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    let result: any;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        // HIPAA: Truncate error to avoid leaking PHI in logs
        throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      result = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    // Log token usage for cost tracking
    this.logTokenUsage(result, callId);

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } }, usage: { inputTokens, outputTokens } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

    const analysis = parseJsonResponse(responseText, callId);
    logger.info({ callId, performanceScore: analysis.performance_score, sentiment: analysis.sentiment }, "Bedrock analysis complete");
    return analysis;
  }

  /**
   * Log token usage from Bedrock response for cost tracking and billing.
   */
  private logTokenUsage(result: any, context: string): void {
    const usage = result?.usage;
    if (usage) {
      logger.info({
        context,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
        cacheReadTokens: usage.cacheReadInputTokenCount,
        cacheWriteTokens: usage.cacheWriteInputTokenCount,
      }, "Bedrock token usage");
    }
  }

  // --- AWS Signature V4 ---

  private signRequest(
    method: string,
    host: string,
    rawPath: string,
    body: string,
    region: string,
  ): Record<string, string> {
    const creds = this.credentials!;
    const service = "bedrock";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = sha256(body);

    // SigV4: canonical URI must have each path segment URI-encoded once
    const canonicalUri = rawPath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");

    // Headers must be sorted alphabetically by name for canonical form
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      (creds.sessionToken ? `x-amz-security-token:${creds.sessionToken}\n` : "");

    const signedHeaders = creds.sessionToken
      ? "content-type;host;x-amz-date;x-amz-security-token"
      : "content-type;host;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      "", // query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, service);
    const signature = hmacHex(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Host": host,
      "X-Amz-Date": amzDate,
      "Authorization": authHeader,
    };
    if (creds.sessionToken) {
      headers["X-Amz-Security-Token"] = creds.sessionToken;
    }
    return headers;
  }
}

// Crypto helpers (sha256Hex, hmac, hmacHex, getSignatureKey) imported from aws-credentials.ts
const sha256 = sha256Hex; // Local alias for existing usage
