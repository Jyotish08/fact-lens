import "@tanstack/react-start/server-only";
import OpenAI from "openai";
import { z } from "zod";
import { getServerConfig, requireIntegration, sanitizeAndValidateModel } from "./config.server";
import { ProviderError, sanitizeSecrets } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";

interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

let openaiClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  const config = requireIntegration("openai");
  const apiKey = config.openaiApiKey || process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new ProviderError("openai", "OPENAI_NOT_CONFIGURED", "OpenAI API is not configured");
  }
  if (!openaiClient || openaiClient.apiKey !== apiKey) {
    openaiClient = new OpenAI({
      apiKey,
    });
  }
  return openaiClient;
}

export function handleOpenAIError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const errMessage = error instanceof Error ? error.message : String(error ?? "");
  const errName = error instanceof Error ? error.name : "";
  const combined = `${errName} ${errMessage}`;

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIUserAbortError ||
    /AbortError|timeout|ETIMEDOUT|Request was aborted/i.test(combined)
  ) {
    return new ProviderError(
      "openai",
      "OPENAI_NETWORK_TIMEOUT",
      "OpenAI request timed out or was aborted before receiving a response.",
      true,
    );
  }

  if (
    error instanceof OpenAI.APIConnectionError ||
    /ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|socket hang up/i.test(combined)
  ) {
    return new ProviderError(
      "openai",
      "OPENAI_NETWORK_ERROR",
      "OpenAI network connection failed or socket hung up.",
      true,
    );
  }

  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    let code: string;
    let message: string;
    let isRetryable = false;

    if (status === 401) {
      code = "OPENAI_UNAUTHORIZED";
      message = "Invalid, expired, or malformed OpenAI API key. Check OPENAI_API_KEY in your .env configuration.";
      isRetryable = false;
    } else if (status === 429) {
      const errObj = error as { code?: string; type?: string; message?: string };
      const isQuota =
        errObj.code === "insufficient_quota" ||
        errObj.type === "insufficient_quota" ||
        /quota|billing|credit/i.test(error.message || "");
      if (isQuota) {
        code = "OPENAI_INSUFFICIENT_QUOTA";
        message = "OpenAI account quota exceeded. Check your OpenAI billing plan and credit balance.";
        isRetryable = false;
      } else {
        code = "OPENAI_RATE_LIMIT_EXCEEDED";
        message = "OpenAI rate limit exceeded. Requests are being throttled.";
        isRetryable = true;
      }
    } else if (status === 404) {
      code = "OPENAI_MODEL_NOT_FOUND";
      message = "Requested OpenAI model does not exist or your API key lacks access to it.";
      isRetryable = false;
    } else if (status === 400) {
      code = "OPENAI_BAD_REQUEST";
      message = sanitizeSecrets(error.message) || "OpenAI request was invalid or incompatible with model parameters/schema.";
      isRetryable = false;
    } else if (status !== undefined && status >= 500) {
      code = `OPENAI_HTTP_${status}`;
      message = "OpenAI service error. Please try again shortly.";
      isRetryable = true;
    } else {
      code = `OPENAI_HTTP_${status ?? "ERROR"}`;
      message = sanitizeSecrets(error.message) || `OpenAI API request failed (${status})`;
      isRetryable = status === 408;
    }

    const retryAfterHeader = error.headers?.["retry-after"];
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1_000 : undefined;
    return new ProviderError(
      "openai",
      code,
      message,
      isRetryable,
      status,
      retryAfterMs,
    );
  }

  return new ProviderError(
    "openai",
    "OPENAI_UNKNOWN_ERROR",
    sanitizeSecrets(errMessage || "An unknown OpenAI error occurred"),
    false,
  );
}

export async function structuredCompletion<T>(options: {
  system: string;
  user: string;
  output: z.ZodType<T>;
  jsonSchema: JsonSchemaFormat;
  model?: string | undefined;
  signal?: AbortSignal | undefined;
  onUsage?:
    | ((usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        model: string;
      }) => void)
    | undefined;
}) {
  const config = getServerConfig();
  const apiKey = config.openaiApiKey || process.env["OPENAI_API_KEY"];
  const isMock =
    !apiKey || config.serviceMode === "mock" || process.env["VOICECLAIM_MOCK_OPENAI"] === "1";

  if (isMock) {
    if (options.onUsage) {
      options.onUsage({
        promptTokens: 150,
        completionTokens: 50,
        totalTokens: 200,
        model: "mock-model",
      });
    }
    return generateDeterministicMockCompletion(options);
  }

  const selectedModel = sanitizeAndValidateModel(options.model ?? config.fastModel, "fast");

  return retry(
    async (attempt) => {
      const started = Date.now();
      const client = getOpenAIClient();
      const repair =
        attempt > 1
          ? "\nYour previous output was invalid. Return only JSON matching the schema exactly."
          : "";

      try {
        const isFixedTemperatureModel =
          /^(gpt-5|gpt-6|o[134]|.*luna|.*sol|.*terra)/i.test(selectedModel);

        const response = await withDeadline(
          (deadlineSignal) =>
            client.chat.completions.create(
              {
                model: selectedModel,
                ...(isFixedTemperatureModel ? {} : { temperature: 0 }),
                messages: [
                  { role: "system", content: options.system },
                  { role: "user", content: `${options.user}${repair}` },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: options.jsonSchema.name,
                    strict: true,
                    schema: options.jsonSchema.schema,
                  },
                },
              },
              { signal: deadlineSignal },
            ),
          90_000,
          options.signal,
        );

        const content = response.choices?.[0]?.message?.content;
        if (!content) {
          throw new ProviderError(
            "openai",
            "OPENAI_EMPTY_OUTPUT",
            "OpenAI API returned no output",
            true,
          );
        }

        try {
          const parsed = options.output.parse(JSON.parse(content));
          if (response.usage && options.onUsage) {
            options.onUsage({
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
              model: response.model ?? selectedModel,
            });
          }
          logProviderStage({
            provider: "openai",
            stage: "structured_completion",
            durationMs: Date.now() - started,
            count: 1,
          });
          return parsed;
        } catch {
          throw new ProviderError(
            "openai",
            "OPENAI_INVALID_OUTPUT",
            "OpenAI API returned malformed structured output",
            true,
          );
        }
      } catch (err) {
        const providerErr = handleOpenAIError(err);
        logProviderStage({
          provider: "openai",
          stage: "structured_completion",
          durationMs: Date.now() - started,
          errorCode: providerErr.code,
        });
        throw providerErr;
      }
    },
    { attempts: 2 },
  );
}

export async function createEmbeddings(texts: string[], signal?: AbortSignal | undefined) {
  const started = Date.now();
  const config = requireIntegration("openai");
  const apiKey = config.openaiApiKey || process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new ProviderError("openai", "OPENAI_NOT_CONFIGURED", "OpenAI API is not configured");
  }

  const embeddingModel = sanitizeAndValidateModel(config.embeddingModel, "embedding");

  try {
    const client = getOpenAIClient();
    const response = await retry(() =>
      withDeadline(
        (deadlineSignal) =>
          client.embeddings.create(
            {
              model: embeddingModel,
              input: texts,
              dimensions: 512,
            },
            { signal: deadlineSignal },
          ),
        30_000,
        signal,
      ),
    );

    const vectors = [...(response.data ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== 512)) {
      throw new ProviderError(
        "openai",
        "OPENAI_INVALID_EMBEDDINGS",
        "Embedding response did not match the request",
      );
    }

    logProviderStage({
      provider: "openai",
      stage: "embeddings",
      durationMs: Date.now() - started,
      count: texts.length,
    });

    return vectors;
  } catch (err) {
    throw handleOpenAIError(err);
  }
}

interface ModelProbeCacheEntry {
  available: boolean;
  error?: string;
  cachedAt: number;
}

const probeCache = new Map<string, ModelProbeCacheEntry>();
const PROBE_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes

export function clearModelProbeCache() {
  probeCache.clear();
}

export async function probeModel(
  modelId: string,
): Promise<{ available: boolean; error?: string | undefined }> {
  const cached = probeCache.get(modelId);
  if (cached && Date.now() - cached.cachedAt < PROBE_CACHE_TTL_MS) {
    return { available: cached.available, error: cached.error };
  }

  let apiKey: string | undefined;
  try {
    const config = requireIntegration("openai");
    apiKey = config.openaiApiKey || process.env["OPENAI_API_KEY"];
  } catch {
    apiKey = process.env["OPENAI_API_KEY"];
  }

  if (!apiKey) {
    return { available: false, error: "OPENAI_NOT_CONFIGURED" };
  }

  try {
    const client = getOpenAIClient();
    await client.models.retrieve(modelId);
    const entry = { available: true };
    probeCache.set(modelId, { ...entry, cachedAt: Date.now() });
    return entry;
  } catch (err: unknown) {
    const providerErr = handleOpenAIError(err);
    const entry = {
      available: false,
      error: sanitizeSecrets(providerErr.message || providerErr.code),
    };
    probeCache.set(modelId, { ...entry, cachedAt: Date.now() });
    return entry;
  }
}

function generateDeterministicMockCompletion<T>(options: {
  jsonSchema: JsonSchemaFormat;
  output: z.ZodType<T>;
  user: string;
}): T {
  const schemaName = options.jsonSchema.name;
  if (schemaName === "verification_queries") {
    return options.output.parse({
      supporting: ["primary records official source", "corroborating verification facts"],
      contradictory: ["counter-evidence challenge context", "alternative facts refutation"],
    });
  }
  if (schemaName === "claim_extraction") {
    const textMatch = options.user.match(
      /(?:Exact transcript:\s*|<<<BEGIN UNTRUSTED transcript[^>]*>>>\n)([\s\S]*?)(?:<<<END UNTRUSTED>>>|$)/i,
    );
    const text = textMatch?.[1]?.trim() || "Claim assertion";
    return options.output.parse({
      classification: "verifiable_fact",
      requiresMoreContext: false,
      claims: [
        {
          normalizedClaim: text.slice(0, 500),
          context: "Transcript extraction",
          frame: {
            subject: "Organization",
            claimType: "attribute",
            quantities: [],
            temporalExpression: null,
            scope: null,
            condition: null,
            modality: "asserted",
            unresolvedReferent: false,
            selfRepairApplied: false,
          },
        },
      ],
    });
  }
  if (schemaName === "evidence_analysis") {
    const candMatches = [...options.user.matchAll(/---\s*(candidate-\d+|custom-\d+)\s*---/g)];
    const analyses = candMatches.map((m) => {
      const id = m[1]!;
      const startIdx = m.index! + m[0].length;
      const snippet = options.user.slice(startIdx, startIdx + 500);
      const cleanExcerpt = snippet
        .replace(/Title:[^\n]*/g, "")
        .replace(/<<<[^>]+>>>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const excerpt =
        cleanExcerpt.length >= 15
          ? cleanExcerpt.slice(0, 150)
          : "This official evidence record provides factual documentation.";
      const isContradiction = /contradicted|false|failing|loss|error|not|below/i.test(options.user);
      return {
        candidateId: id,
        excerpt,
        relation: isContradiction ? "contradicts" : "supports",
        authority: "high",
        category: "government",
        relevance: 0.95,
        directness: 0.95,
        freshness: 0.9,
        publishedAt: "2025-06-01",
        upstreamUrl: null,
        materialDistortion: false,
      };
    });
    return options.output.parse({ analyses });
  }
  if (schemaName === "verification_synthesis") {
    return options.output.parse({
      summary:
        "Evidence corroborates the verified claim in accordance with retrieved official records.",
      explanation:
        "Detailed factual analysis confirms alignment with authoritative published primary sources.",
      challengeSummary: "Independent contradictory queries returned no credible counter-evidence.",
      evidenceGaps: [],
      recommendedActions: ["Maintain record for session audit."],
      allMaterialElementsCovered: true,
    });
  }
  if (schemaName === "research_stop_decision") {
    return options.output.parse({
      resolved: true,
      reason: "authoritative_direct",
    });
  }
  throw new Error(`Unsupported mock schema: ${schemaName}`);
}

