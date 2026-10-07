import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  claimInputSchema,
  customContextSchema,
  sessionTokenSchema,
  settingsSchema,
  transcriptChunkSchema,
  conversationContextSnapshotSchema,
} from "./schemas";

async function noStore() {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Cache-Control", "no-store, max-age=0");
  setResponseHeader("Pragma", "no-cache");
}

export const createAnonymousSession = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        requestedSessionId: z.string().min(1).max(100),
        requestedServiceMode: z.enum(["live", "mock"]).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { issueAnonymousToken } = await import("./server/security.server");
    const { getServerConfig } = await import("./server/config.server");
    const config = getServerConfig();
    const serviceMode = data.requestedServiceMode ?? config.serviceMode;
    return {
      sessionId: data.requestedSessionId,
      sessionToken: await issueAnonymousToken(data.requestedSessionId),
      expiresInSeconds: 6 * 60 * 60,
      serviceMode,
    };
  });

export const issueSpeechmaticsToken = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().min(1).max(100),
        type: z.enum(["rt", "batch"]),
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { requireIntegration } = await import("./server/config.server");
    const { classifyProviderResponse, ProviderError } = await import("./server/errors.server");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.sessionId);
    const config = requireIntegration("speechmatics");
    if (!config.speechmaticsApiKey) {
      throw new ProviderError(
        "speechmatics",
        "SPEECHMATICS_NOT_CONFIGURED",
        "Speechmatics is not configured",
      );
    }
    const response = await fetch(
      `https://mp.speechmatics.com/v1/api_keys?type=${encodeURIComponent(data.type)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.speechmaticsApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: 60,
          ...(data.type === "batch" ? { client_ref: data.sessionId } : {}),
        }),
      },
    );
    if (!response.ok) throw classifyProviderResponse("speechmatics", response);
    const body = (await response.json()) as { key_value?: string };
    if (!body.key_value) {
      throw new ProviderError(
        "speechmatics",
        "SPEECHMATICS_TOKEN_INVALID",
        "Speechmatics returned no temporary key",
      );
    }
    return {
      token: body.key_value,
      expiresInSeconds: 60,
      endpoint: data.type === "rt" ? config.speechmaticsRealtimeUrl : config.speechmaticsBatchUrl,
    };
  });

export const extractClaims = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        chunk: transcriptChunkSchema,
        settings: settingsSchema,
        sessionToken: sessionTokenSchema,
        previousTail: z.string().optional(),
        sessionTitle: z.string().optional(),
        anchorDate: z.string().optional(),
        contextSnapshot: conversationContextSnapshotSchema.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { structuredCompletion } = await import("./server/openai.server");
    const { logProviderStage, logContextualResolution } = await import("./server/logging.server");
    const { deterministicPriority } = await import("./priority");
    const { verifyAnonymousToken } = await import("./server/security.server");
    const { extractPrompt } = await import("./server/prompts");
    const { resolveTemporal } = await import("./temporal");
    await verifyAnonymousToken(data.sessionToken, data.chunk.sessionId);

    const anchorDate = data.anchorDate || data.settings.recordingDate;

    const result = await structuredCompletion({
      system: extractPrompt.system,
      user: extractPrompt.buildUser({
        mode: data.settings.mode,
        forced: data.chunk.forced,
        text: data.chunk.text,
        previousTail: data.previousTail,
        sessionTitle: data.sessionTitle,
        anchorDate,
        contextSnapshot: data.contextSnapshot,
      }),
      output: extractPrompt.output,
      jsonSchema: extractPrompt.jsonSchema,
    });
    logProviderStage({
      provider: "openai",
      stage: `claim_extraction_${result.classification}`,
      durationMs: 0,
      count: result.claims.length,
    });
    const resolutionStart = Date.now();
    const mappedClaims = result.claims.map((claim) => {
      if (claim.resolution) {
        logContextualResolution({
          durationMs: Date.now() - resolutionStart,
          resolved: true,
          confidence: claim.resolution.confidence,
          antecedentSegmentId: claim.resolution.antecedentSegmentId,
        });
      } else if (claim.frame?.unresolvedReferent) {
        logContextualResolution({ durationMs: Date.now() - resolutionStart, resolved: false });
      }
      return claim;
    });
    return {
      ...result,
      originalText: data.chunk.text,
      claims: mappedClaims.map((claim) => {
        let frame: import("./types").ClaimFrame | undefined;
        if (claim.frame) {
          const temporal = resolveTemporal({
            expression: claim.frame.temporalExpression ?? null,
            anchorDate,
          });
          frame = {
            version: 2,
            subject: claim.frame.subject ?? "",
            claimType: claim.frame.claimType ?? "attribute",
            quantities: claim.frame.quantities ?? [],
            temporal,
            scope: claim.frame.scope ?? null,
            condition: claim.frame.condition ?? null,
            modality: claim.frame.modality ?? "asserted",
            unresolvedReferent: claim.frame.unresolvedReferent ?? false,
            selfRepairApplied: claim.frame.selfRepairApplied ?? false,
          };
        }
        return {
          ...claim,
          frame,
          antecedentSegmentIds: claim.antecedentSegmentIds,
          resolution: claim.resolution,
          discourseRelation: claim.discourseRelation,
          priority: deterministicPriority(claim.normalizedClaim, data.settings.mode, false, frame),
        };
      }),
    };
  });

export const verifyClaimStream = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        claim: claimInputSchema,
        settings: settingsSchema,
        customContext: customContextSchema,
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async function* ({ data }) {
    await noStore();
    const { publicError } = await import("./server/errors.server");
    const { runVerification } = await import("./server/pipeline.server");
    const { verifyAnonymousToken, checkSessionRateLimit } = await import("./server/security.server");
    try {
      await verifyAnonymousToken(data.sessionToken, data.claim.sessionId);
      checkSessionRateLimit(data.claim.sessionId);
      for await (const update of runVerification(data.claim, data.settings, data.customContext)) {
        yield update;
      }
    } catch (error) {
      yield { type: "error" as const, message: publicError(error) };
    }
  });

export const embedTexts = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        texts: z.array(z.string().min(1).max(8_000)).min(1).max(32),
        purpose: z.enum(["document", "query"]),
        sessionId: z.string().min(1).max(100),
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { createEmbeddings } = await import("./server/openai.server");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.sessionId);
    return { dimensions: 512, vectors: await createEmbeddings(data.texts) };
  });

export const getIntegrationHealth = createServerFn({ method: "GET" }).handler(async () => {
  await noStore();
  const { getServerConfig } = await import("./server/config.server");
  const { probeModel } = await import("./server/openai.server");
  const config = getServerConfig();

  const missing: string[] = [];
  if (!config.speechmaticsApiKey) missing.push("SPEECHMATICS_API_KEY");
  if (!config.brightDataToken) missing.push("BRIGHTDATA_API_TOKEN");
  if (!config.openaiApiKey) missing.push("OPENAI_API_KEY");

  const [fastProbe, verifierProbe, synthesisProbe, embeddingProbe] = await Promise.all([
    probeModel(config.fastModel),
    probeModel(config.verifierModel),
    probeModel(config.synthesisModel),
    probeModel(config.embeddingModel),
  ]);

  const rawFast = process.env["VOICECLAIM_FAST_MODEL"];
  const rawSynthesis = process.env["VOICECLAIM_SYNTHESIS_MODEL"];
  const modelFallbackActive =
    (Boolean(rawFast) && rawFast !== config.fastModel) ||
    (Boolean(rawSynthesis) && rawSynthesis !== config.synthesisModel);

  return {
    mode: config.serviceMode,
    ready: config.serviceMode === "mock" || missing.length === 0,
    missing,
    integrations: {
      speechmatics: {
        configured: Boolean(config.speechmaticsApiKey),
        name: "Speechmatics ASR",
      },
      brightData: {
        configured: Boolean(config.brightDataToken),
        name: "Bright Data Web MCP",
      },
      openAi: {
        configured: Boolean(config.openaiApiKey),
        name: "OpenAI GPT-4o & Embeddings",
      },
    },
    models: {
      extraction: config.fastModel,
      verifier: config.verifierModel,
      synthesis: config.synthesisModel,
      embeddings: config.embeddingModel,
      modelFallbackActive,
      configuredFast: rawFast ?? config.fastModel,
      configuredSynthesis: rawSynthesis ?? config.synthesisModel,
      availability: {
        extraction: fastProbe.available,
        verifier: verifierProbe.available,
        synthesis: synthesisProbe.available,
        embeddings: embeddingProbe.available,
      },
    },
    guidance:
      missing.length > 0 && config.serviceMode === "live"
        ? `Missing credentials in .env: ${missing.join(", ")}. Either supply them or switch to Mock Mode for deterministic testing.`
        : undefined,
  };
});
