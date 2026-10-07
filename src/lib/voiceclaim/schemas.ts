import { z } from "zod";
import type { EvidenceItem } from "./types";

export const verificationModeSchema = z.enum(["general", "investor", "academic", "custom"]);
export const verificationDepthSchema = z.enum(["quick", "deep"]);
export const intervalPresetSchema = z.enum(["fast", "balanced", "long"]);

export const settingsSchema = z.object({
  mode: verificationModeSchema,
  depth: verificationDepthSchema,
  intervalPreset: intervalPresetSchema,
  sourceCount: z.number().int().min(2).max(8),
  concurrency: z.number().int().min(1).max(4),
  recordingDate: z.string().optional(),
});

export const transcriptChunkSchema = z.object({
  id: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  sourceSegmentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1).max(30_000),
  intervalWindows: z.number().int().min(1).max(2),
  forced: z.boolean(),
});

export const customContextSchema = z.string().max(12_000).default("");

export const claimQuantitySchema = z.object({
  raw: z.string(),
  value: z.number(),
  unit: z.string(),
  comparator: z.enum(["exact", "approx", "at_least", "at_most"]),
  asrLowConfidence: z.boolean().optional(),
});

export const claimTemporalSchema = z.object({
  expression: z.string().nullable(),
  resolvedStart: z.string().nullable(),
  resolvedEnd: z.string().nullable(),
  anchorSource: z.enum(["utterance_time", "recording_date", "explicit", "unknown"]),
  currentness: z.enum(["historical", "current", "timeless"]),
});

export const claimFrameSchema = z.object({
  version: z.literal(2),
  subject: z.string(),
  claimType: z.enum(["quantity", "ranking", "event", "attribute", "causal", "self_report"]),
  quantities: z.array(claimQuantitySchema),
  temporal: claimTemporalSchema,
  scope: z.string().nullable(),
  condition: z.string().nullable(),
  modality: z.enum(["asserted", "reported_speech", "hedged"]),
  unresolvedReferent: z.boolean(),
  selfRepairApplied: z.boolean(),
});

export const discourseRelationSchema = z.enum([
  "new_claim",
  "modifies_previous",
  "provides_context",
  "contradicts_earlier",
  "duplicate",
]);

export const contextualResolutionSchema = z.object({
  surfaceForm: z.string().min(1).max(500),
  resolvedReferent: z.string().min(1).max(500),
  antecedentSegmentId: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2_000),
});

export const conversationTurnSchema = z.object({
  segmentId: z.string().min(1).max(100),
  text: z.string().min(1).max(30_000),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speakerId: z.string().max(100).optional(),
});

export const conversationEntitySchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(["person", "organization", "location", "product", "other"]).optional(),
  sourceSegmentId: z.string().min(1).max(100),
  lastMentionedMs: z.number().int().nonnegative(),
});

export const conversationContextSnapshotSchema = z.object({
  recentTurns: z.array(conversationTurnSchema).max(8),
  activeEntities: z.array(conversationEntitySchema).max(32),
  recentClaims: z.array(z.object({
    id: z.string().min(1).max(150),
    normalizedClaim: z.string().min(1).max(8_000),
    sourceSegmentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  })).max(20),
  tokenCount: z.number().int().nonnegative().max(600),
});

export const claimInputSchema = z.object({
  id: z.string().min(1).max(150),
  sessionId: z.string().min(1).max(100),
  sourceSegmentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  originalText: z.string().min(1).max(30_000),
  normalizedClaim: z.string().min(1).max(8_000),
  context: z.string().max(12_000),
  timestampMs: z.number().int().nonnegative(),
  utteranceAt: z.string().optional(),
  mode: verificationModeSchema,
  depth: verificationDepthSchema,
  state: z.enum([
    "DETECTED",
    "QUEUED",
    "RESEARCHING",
    "CHALLENGING",
    "SYNTHESIZING",
    "COMPLETED",
    "INSUFFICIENT_EVIDENCE",
    "VERIFICATION_ERROR",
  ]),
  priority: z.number().min(0).max(100),
  manual: z.boolean(),
  evidence: z.array(z.custom<EvidenceItem>()).max(100),
  frame: claimFrameSchema.optional(),
  asrFlags: z.object({ lowConfidenceTokens: z.array(z.string()) }).optional(),
  antecedentSegmentIds: z.array(z.string().min(1).max(100)).max(100).optional(),
  resolution: contextualResolutionSchema.optional(),
  discourseRelation: discourseRelationSchema.optional(),
  parentClaimId: z.string().min(1).max(150).optional(),
});

export const sessionTokenSchema = z.string().min(20).max(4096);

export const reasonCodeSchema = z.enum([
  "STRONG_INDEPENDENT_SUPPORT",
  "SUPPORT_WITH_MINOR_GAPS",
  "QUANTITY_APPROXIMATE",
  "CORROBORATED_MISSING_CONTEXT",
  "DIRECT_CONTRADICTION",
  "QUANTITY_MISMATCH",
  "CONFLICTING_INDEPENDENT_SOURCES",
  "NO_RELEVANT_SOURCES",
  "SOURCES_NEUTRAL",
  "WEAK_CONTRADICTION_ONLY",
  "PARTIAL_RETRIEVAL_FAILURE",
  "AMBIGUOUS_CLAIM",
  "STALE_EVIDENCE_ONLY",
]);

export const retrievalCoverageSchema = z.object({
  queriesRequested: z.number().int().nonnegative(),
  queriesSucceeded: z.number().int().nonnegative(),
  pagesAttempted: z.number().int().nonnegative(),
  pagesRetrieved: z.number().int().nonnegative(),
  passagesVerified: z.number().int().nonnegative(),
  verifierFailures: z.number().int().nonnegative(),
  budgetExhausted: z.boolean(),
});

export const verificationTraceSchema = z.object({
  promptVersions: z.record(z.string()),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  retrievalEvents: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["search", "scrape"]),
      query: z.string().optional(),
      url: z.string().optional(),
      status: z.enum(["ok", "error"]),
      errorCode: z.string().optional(),
      durationMs: z.number(),
    }),
  ),
  decision: z.object({
    support: z.number(),
    contradiction: z.number(),
    thresholdsVersion: z.string(),
    rulesFired: z.array(z.string()),
    clustersUsed: z.array(z.string()),
  }),
});

export const verificationResultSchema = z.object({
  verdict: z.enum([
    "supported",
    "mostly_supported",
    "mixed",
    "misleading",
    "contradicted",
    "insufficient_evidence",
  ]),
  confidence: z.object({
    score: z.number().min(0).max(100),
    evidenceStrength: z.enum(["high", "medium", "low"]),
    contradiction: z.enum(["high", "medium", "low"]),
    freshness: z.enum(["high", "medium", "low"]),
  }),
  summary: z.string(),
  explanation: z.string(),
  challengeSummary: z.string(),
  evidenceGaps: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  roundsRun: z.number(),
  reasonCode: reasonCodeSchema.optional(),
  coverage: retrievalCoverageSchema.optional(),
  pipelineVersion: z.enum(["v1", "v2"]).optional(),
  calibration: z
    .object({
      status: z.enum(["uncalibrated", "calibrated"]),
      mappingVersion: z.string().optional(),
    })
    .optional(),
  trace: verificationTraceSchema.optional(),
});
