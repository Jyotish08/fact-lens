import "@tanstack/react-start/server-only";
import type { ProviderName } from "./errors.server";

export function logProviderStage(event: {
  provider: ProviderName;
  stage: string;
  durationMs: number;
  count?: number | undefined;
  errorCode?: string | undefined;
}) {
  console.info(
    JSON.stringify({
      event: "voiceclaim_provider_stage",
      provider: event.provider,
      stage: event.stage,
      durationMs: Math.round(event.durationMs),
      ...(event.count === undefined ? {} : { count: event.count }),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    }),
  );
}

export function logPipelineEvent(event: {
  claimTraceId: string;
  pipelineVersion?: "v1" | "v2";
  stage: string;
  durationMs: number;
  count?: number;
  errorCode?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  promptVersion?: string;
}) {
  console.info(
    JSON.stringify({
      event: "voiceclaim_pipeline_event",
      claimTraceId: event.claimTraceId,
      pipelineVersion: event.pipelineVersion ?? "v1",
      stage: event.stage,
      durationMs: Math.round(event.durationMs),
      ...(event.count !== undefined ? { count: event.count } : {}),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(event.model ? { model: event.model } : {}),
      ...(event.tokensIn !== undefined ? { tokensIn: event.tokensIn } : {}),
      ...(event.tokensOut !== undefined ? { tokensOut: event.tokensOut } : {}),
      ...(event.promptVersion ? { promptVersion: event.promptVersion } : {}),
    }),
  );
}

/** Privacy-preserving CCI metrics. Never include transcript, claim, URL, or prompt text. */
export function logContextualResolution(event: {
  claimTraceId?: string | undefined;
  durationMs: number;
  resolved: boolean;
  confidence?: number | undefined;
  antecedentSegmentId?: string | undefined;
}) {
  console.info(JSON.stringify({
    event: "voiceclaim_contextual_resolution",
    ...(event.claimTraceId ? { claimTraceId: event.claimTraceId } : {}),
    durationMs: Math.round(event.durationMs),
    resolved: event.resolved,
    ...(event.confidence === undefined ? {} : { confidence: Math.max(0, Math.min(1, event.confidence)) }),
    ...(event.antecedentSegmentId ? { antecedentSegmentId: event.antecedentSegmentId } : {}),
  }));
}

export function logClaimLinking(event: {
  claimTraceId?: string | undefined;
  durationMs: number;
  relation: "new_claim" | "modifies_previous" | "provides_context" | "contradicts_earlier" | "duplicate";
  duplicate: boolean;
}) {
  console.info(JSON.stringify({
    event: "voiceclaim_claim_linking",
    ...(event.claimTraceId ? { claimTraceId: event.claimTraceId } : {}),
    durationMs: Math.round(event.durationMs),
    relation: event.relation,
    duplicate: event.duplicate,
  }));
}

