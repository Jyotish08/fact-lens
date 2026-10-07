import "@tanstack/react-start/server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const STANDARD_OPENAI_MODELS = {
  fast: "gpt-4o-mini",
  verifier: "gpt-4o-mini",
  synthesis: "gpt-4o",
  embedding: "text-embedding-3-small",
} as const;

export type ModelRole = keyof typeof STANDARD_OPENAI_MODELS;

const GA_CHAT_MODELS =
  /^(gpt-(3\.5-turbo|4o(-mini)?|4(-turbo)?|4\.1(-mini|-nano)?|5(\.\d+)?(-mini|-nano|-pro|-codex|-luna|-sol|-terra)?|6(\.\d+)?(-luna|-sol)?)|o[134](-mini|-preview|-pro)?)(-\d{4}-\d{2}-\d{2})?$/i;
const GA_EMBEDDING_MODELS =
  /^(text-embedding-3-(small|large)|text-embedding-ada-002)$/i;
const NON_OPENAI_MODELS = /^(claude|gemini|deepseek|llama|mistral|qwen|anthropic\/|google\/|meta\/)/i;

export function sanitizeAndValidateModel(
  configuredModel: string | undefined,
  role: ModelRole,
): string {
  const fallback = STANDARD_OPENAI_MODELS[role];
  if (!configuredModel) return fallback;
  const trimmed = configuredModel.trim();
  if (!trimmed) return fallback;

  if (NON_OPENAI_MODELS.test(trimmed)) {
    console.warn(
      `[voiceclaim:model-guardrail] Incompatible third-party model identifier "${trimmed}" detected for ${role}. Automatically falling back to official OpenAI GA model "${fallback}".`,
    );
    return fallback;
  }

  const isAllowed =
    role === "embedding"
      ? GA_EMBEDDING_MODELS.test(trimmed)
      : GA_CHAT_MODELS.test(trimmed);

  if (!isAllowed) {
    console.warn(
      `[voiceclaim:model-guardrail] Model identifier "${trimmed}" is not a recognized OpenAI GA model for ${role}.`,
    );
  }

  return trimmed;
}

const configSchema = z.object({
  serviceMode: z.enum(["live", "mock"]),
  signingSecret: z.string().min(32),
  speechmaticsApiKey: z.string().optional(),
  speechmaticsRealtimeUrl: z.string().url(),
  speechmaticsBatchUrl: z.string().url(),
  brightDataToken: z.string().optional(),
  brightDataMcpUrl: z.string().url(),
  openaiApiKey: z.string().optional(),
  fastModel: z.string().min(1),
  verifierModel: z.string().min(1),
  synthesisModel: z.string().min(1),
  embeddingModel: z.string().min(1),
  pipelineVersion: z.enum(["v1", "v2"]).default("v1"),
  verifierProvider: z.enum(["llm", "nli", "hybrid"]).default("llm"),
  nliEndpointUrl: z.string().url().optional(),
  nliApiKey: z.string().optional(),
  maxClaimsPerHour: z.number().min(0).default(60),
});

export type ServerConfig = z.infer<typeof configSchema>;

let cached: ServerConfig | undefined;
const projectEnvMap = new Map<string, string>();
let projectEnvLoaded = false;

function loadProjectEnvFiles() {
  if (projectEnvLoaded) return;
  projectEnvLoaded = true;
  try {
    const root = process.cwd();
    for (const filename of [".env.local", ".env"]) {
      const fullPath = path.join(root, filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
            if (val && !projectEnvMap.has(key)) {
              projectEnvMap.set(key, val);
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal if filesystem is restricted or read fails
  }
}

function env(name: string) {
  loadProjectEnvFiles();
  return projectEnvMap.get(name) ?? (process.env[name]?.trim() || undefined);
}

export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const serviceMode = env("VOICECLAIM_SERVICE_MODE") ?? "live";
  const developmentSecret = "voiceclaim-local-development-secret-change-me";
  if (process.env["NODE_ENV"] === "production" && !env("VOICECLAIM_SESSION_SIGNING_SECRET")) {
    throw new Error("VOICECLAIM_SESSION_SIGNING_SECRET is required in production");
  }

  const rawFastModel = env("VOICECLAIM_FAST_MODEL");
  const rawVerifierModel = env("VOICECLAIM_VERIFIER_MODEL");
  const rawSynthesisModel = env("VOICECLAIM_SYNTHESIS_MODEL");
  const rawEmbeddingModel = env("VOICECLAIM_EMBEDDING_MODEL");
  const rawPipelineVersion = (env("VOICECLAIM_PIPELINE_VERSION") ?? "v1") as "v1" | "v2";

  cached = configSchema.parse({
    serviceMode,
    signingSecret: env("VOICECLAIM_SESSION_SIGNING_SECRET") ?? developmentSecret,
    speechmaticsApiKey: env("SPEECHMATICS_API_KEY"),
    speechmaticsRealtimeUrl:
      env("SPEECHMATICS_REALTIME_URL") ?? "wss://global.rt.speechmatics.com/v2",
    speechmaticsBatchUrl: env("SPEECHMATICS_BATCH_URL") ?? "https://asr.api.speechmatics.com",
    brightDataToken: env("BRIGHTDATA_API_TOKEN"),
    brightDataMcpUrl: env("BRIGHTDATA_MCP_URL") ?? "https://mcp.brightdata.com/mcp",
    openaiApiKey: env("OPENAI_API_KEY"),
    fastModel: sanitizeAndValidateModel(rawFastModel, "fast"),
    verifierModel: sanitizeAndValidateModel(rawVerifierModel ?? rawFastModel, "verifier"),
    synthesisModel: sanitizeAndValidateModel(rawSynthesisModel, "synthesis"),
    embeddingModel: sanitizeAndValidateModel(rawEmbeddingModel, "embedding"),
    pipelineVersion: rawPipelineVersion === "v2" ? "v2" : "v1",
    verifierProvider: (env("VOICECLAIM_VERIFIER_PROVIDER") ?? "llm") as "llm" | "nli" | "hybrid",
    nliEndpointUrl: env("VOICECLAIM_NLI_ENDPOINT_URL") || undefined,
    nliApiKey: env("VOICECLAIM_NLI_API_KEY") || env("HF_API_KEY") || undefined,
    maxClaimsPerHour: env("VOICECLAIM_MAX_CLAIMS_PER_HOUR")
      ? Number.parseInt(env("VOICECLAIM_MAX_CLAIMS_PER_HOUR")!, 10)
      : 60,
  });
  return cached;
}

export function requireIntegration(name: "speechmatics" | "brightdata" | "openai") {
  const config = getServerConfig();
  if (config.serviceMode === "mock") return config;
  const configured =
    name === "speechmatics"
      ? config.speechmaticsApiKey
      : name === "brightdata"
        ? config.brightDataToken
        : config.openaiApiKey;
  if (!configured) throw new Error(`${name.toUpperCase()}_NOT_CONFIGURED`);
  return config;
}
