/**
 * Domain model for VoiceClaim Auditor.
 *
 * These types are the contract between the UI and the verification backend.
 * Today they are fulfilled by mock services (src/lib/voiceclaim/services);
 * swapping in Speechmatics / Bright Data Web MCP / AI-ML API implementations
 * must not require changing anything in this file or in the components.
 */

export type VerificationMode = "general" | "investor" | "academic" | "custom";
export type VerificationDepth = "quick" | "deep";
export type IntervalPreset = "fast" | "balanced" | "long";

export type StatementClassification = "verifiable_fact" | "opinion" | "prediction" | "context";

/** How a claim relates to the immediately active discourse. */
export type DiscourseRelation =
  | "new_claim"
  | "modifies_previous"
  | "provides_context"
  | "contradicts_earlier"
  | "duplicate";

/** A compact, serializable representation of a final transcript turn. */
export interface ConversationTurn {
  segmentId: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string | undefined;
}

export interface ConversationEntity {
  name: string;
  type?: "person" | "organization" | "location" | "product" | "other" | undefined;
  sourceSegmentId: string;
  lastMentionedMs: number;
}

export interface ConversationContextSnapshot {
  recentTurns: ConversationTurn[];
  activeEntities: ConversationEntity[];
  recentClaims: Array<Pick<AtomicClaim, "id" | "normalizedClaim" | "sourceSegmentIds">>;
  /** Approximate whitespace-token count, guaranteed not to exceed the memory budget. */
  tokenCount: number;
}

/** Audit receipt for a reconstruction made from conversational context. */
export interface ContextualResolution {
  surfaceForm: string;
  resolvedReferent: string;
  antecedentSegmentId: string;
  confidence: number;
  rationale: string;
}

export type ClaimState =
  | "DETECTED"
  | "QUEUED"
  | "RESEARCHING"
  | "CHALLENGING"
  | "SYNTHESIZING"
  | "COMPLETED"
  | "INSUFFICIENT_EVIDENCE"
  | "VERIFICATION_ERROR";

export type Verdict =
  | "supported"
  | "mostly_supported"
  | "mixed"
  | "misleading"
  | "contradicted"
  | "insufficient_evidence";

export type EvidenceRelation = "supports" | "contradicts" | "contextual";

export type SourceCategory =
  | "government"
  | "scientific"
  | "financial_filing"
  | "company"
  | "news"
  | "fact_check"
  | "social"
  | "custom_corpus";

export type QualitativeLevel = "low" | "medium" | "high";

export interface TranscriptSegment {
  id: string;
  /** Milliseconds from session start. */
  startMs: number;
  endMs: number;
  /** Exactly what was said. Never overwritten by normalization. */
  text: string;
  /** True while Speechmatics is still refining this segment. */
  interim: boolean;
  classification?: StatementClassification | undefined;
  tokens?: Array<{
    text: string;
    confidence: number;
    startMs: number;
    endMs: number;
  }> | undefined;
}

export interface TranscriptChunk {
  id: string;
  sessionId: string;
  sourceSegmentIds: string[];
  startMs: number;
  endMs: number;
  /** Exact concatenated wording; never normalized in place. */
  text: string;
  intervalWindows: number;
  forced: boolean;
}

export type SourceTier =
  | "primary_official"
  | "primary_org"
  | "established_news"
  | "secondary"
  | "user_corpus"
  | "social";

export interface EvidenceItem {
  id: string;
  title: string;
  domain: string;
  url: string;
  category: SourceCategory;
  excerpt: string;
  relation: EvidenceRelation;
  publishedAt?: string | undefined;
  retrievedAt: string;
  /** Authority relative to this specific claim, not in the abstract. */
  authority: QualitativeLevel;
  /** False when the item repeats an upstream report already counted. */
  independent: boolean;
  upstreamOf?: string | undefined;
  tier?: SourceTier | undefined;
  clusterId?: string | undefined;
  span?: { start: number; end: number; contentHash: string } | undefined;
  verifier?: { entail: number; neutral: number; contradict: number; verifierId: string } | undefined;
  quantityCheck?: "match" | "within_tolerance" | "mismatch" | "not_applicable" | undefined;
  publishedAtSource?: "page_metadata" | "page_text" | "serp" | "unknown" | undefined;
  retrievalEventId?: string | undefined;
}

export interface EvidenceConfidence {
  /** 0-100. Confidence in the verdict given retrieved evidence — not a probability of truth. */
  score: number;
  evidenceStrength: QualitativeLevel;
  contradiction: QualitativeLevel;
  freshness: QualitativeLevel;
}

export type ReasonCode =
  | "STRONG_INDEPENDENT_SUPPORT"
  | "SUPPORT_WITH_MINOR_GAPS"
  | "QUANTITY_APPROXIMATE"
  | "CORROBORATED_MISSING_CONTEXT"
  | "DIRECT_CONTRADICTION"
  | "QUANTITY_MISMATCH"
  | "CONFLICTING_INDEPENDENT_SOURCES"
  | "NO_RELEVANT_SOURCES"
  | "SOURCES_NEUTRAL"
  | "WEAK_CONTRADICTION_ONLY"
  | "PARTIAL_RETRIEVAL_FAILURE"
  | "AMBIGUOUS_CLAIM"
  | "STALE_EVIDENCE_ONLY";

export interface RetrievalCoverage {
  queriesRequested: number;
  queriesSucceeded: number;
  pagesAttempted: number;
  pagesRetrieved: number;
  passagesVerified: number;
  verifierFailures: number;
  budgetExhausted: boolean;
}

export interface VerificationTrace {
  promptVersions: Record<string, string>;
  tokensIn?: number;
  tokensOut?: number;
  retrievalEvents: Array<{
    id: string;
    kind: "search" | "scrape";
    query?: string;
    url?: string;
    status: "ok" | "error";
    errorCode?: string;
    durationMs: number;
  }>;
  decision: {
    support: number;
    contradiction: number;
    thresholdsVersion: string;
    rulesFired: string[];
    clustersUsed: string[];
  };
}

export interface VerificationResult {
  verdict: Verdict;
  confidence: EvidenceConfidence;
  summary: string;
  explanation: string;
  challengeSummary: string;
  evidenceGaps: string[];
  recommendedActions: string[];
  roundsRun: number;
  reasonCode?: ReasonCode | undefined;
  coverage?: RetrievalCoverage | undefined;
  pipelineVersion?: "v1" | "v2" | undefined;
  calibration?: { status: "uncalibrated" | "calibrated"; mappingVersion?: string } | undefined;
  trace?: VerificationTrace | undefined;
}

export type ClaimType =
  | "quantity"
  | "ranking"
  | "event"
  | "attribute"
  | "causal"
  | "self_report";

export interface ClaimQuantity {
  raw: string;
  value: number;
  unit: string;
  comparator: "exact" | "approx" | "at_least" | "at_most";
  asrLowConfidence?: boolean | undefined;
}

export interface ClaimTemporal {
  expression: string | null;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  anchorSource: "utterance_time" | "recording_date" | "explicit" | "unknown";
  currentness: "historical" | "current" | "timeless";
}

export interface ClaimFrame {
  version: 2;
  subject: string;
  claimType: ClaimType;
  quantities: ClaimQuantity[];
  temporal: ClaimTemporal;
  scope: string | null;
  condition: string | null;
  modality: "asserted" | "reported_speech" | "hedged";
  unresolvedReferent: boolean;
  selfRepairApplied: boolean;
}

export interface AtomicClaim {
  id: string;
  sessionId: string;
  sourceSegmentIds: string[];
  /** Original spoken wording — always preserved. */
  originalText: string;
  /** Normalized, self-contained assertion. */
  normalizedClaim: string;
  context: string;
  timestampMs: number;
  utteranceAt?: string | undefined;
  mode: VerificationMode;
  depth: VerificationDepth;
  state: ClaimState;
  priority: number;
  manual: boolean;
  /** Evidence streams in progressively; incomplete until state is terminal. */
  evidence: EvidenceItem[];
  result?: VerificationResult | undefined;
  error?: string | undefined;
  frame?: ClaimFrame | undefined;
  asrFlags?: { lowConfidenceTokens: string[] } | undefined;
  /** Segments that supplied entities or terms needed to reconstruct this assertion. */
  antecedentSegmentIds?: string[] | undefined;
  resolution?: ContextualResolution | undefined;
  discourseRelation?: DiscourseRelation | undefined;
  parentClaimId?: string | undefined;
}

export const REASON_LABELS: Record<ReasonCode, string> = {
  STRONG_INDEPENDENT_SUPPORT: "Multiple authoritative independent records corroborate this assertion.",
  SUPPORT_WITH_MINOR_GAPS: "Primary sources corroborate core claims with minor contextual omissions.",
  QUANTITY_APPROXIMATE: "Reported magnitude matches authoritative statistics within acceptable margin.",
  CORROBORATED_MISSING_CONTEXT: "Key context omitted; multiple sources confirm statement is materially distorted.",
  DIRECT_CONTRADICTION: "Directly refuted by primary official documentation.",
  QUANTITY_MISMATCH: "Audited figures contradict the reported quantities or percentages.",
  CONFLICTING_INDEPENDENT_SOURCES: "Authoritative independent sources report conflicting data.",
  NO_RELEVANT_SOURCES: "No relevant authoritative sources found.",
  SOURCES_NEUTRAL: "Retrieved documents discuss the topic without taking a stance.",
  WEAK_CONTRADICTION_ONLY: "Only weak non-authoritative counter-claims were identified.",
  PARTIAL_RETRIEVAL_FAILURE: "Retrieval infrastructure experienced partial failure; evidence incomplete.",
  AMBIGUOUS_CLAIM: "Claim contains unresolved ambiguous referents or unspecified terms.",
  STALE_EVIDENCE_ONLY: "Available evidence predates current conditions.",
};

export type SessionStatus =
  "idle" | "listening" | "processing" | "reconnecting" | "completed" | "error";

export type SessionSource = "microphone" | "audio_upload" | "video_upload";

export type SessionProgressStage =
  | "connecting"
  | "uploading"
  | "transcribing"
  | "extracting"
  | "researching"
  | "challenging"
  | "synthesizing"
  | "finalizing"
  | "completed"
  | "error";

export interface SessionProgress {
  stage: SessionProgressStage;
  label: string;
  detail: string;
  /** Overall progress for finite uploaded recordings. Live microphone sessions are indeterminate. */
  percent?: number | undefined;
}

export interface CustomSource {
  id: string;
  name: string;
  kind: "pdf" | "txt" | "csv";
  sizeBytes: number;
  parserStatus: "stored" | "parsing" | "parsed" | "indexing" | "ready" | "error";
  pageCount?: number | undefined;
  rowCount?: number | undefined;
  chunkCount: number;
  indexingError?: string | undefined;
}

export interface SessionSettings {
  mode: VerificationMode;
  depth: VerificationDepth;
  intervalPreset: IntervalPreset;
  /** Sources targeted per research round. */
  sourceCount: number;
  concurrency: number;
  recordingDate?: string | undefined;
}

export interface Session {
  id: string;
  title: string;
  source: SessionSource;
  settings: SessionSettings;
  customSources: CustomSource[];
  startedAt: string;
  endedAt?: string | undefined;
  status: SessionStatus;
  durationMs: number;
  segments: TranscriptSegment[];
  claims: AtomicClaim[];
  progress?: SessionProgress | undefined;
}

export const INTERVAL_SECONDS: Record<IntervalPreset, number> = {
  fast: 6,
  balanced: 14,
  long: 28,
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: "Supported",
  mostly_supported: "Mostly Supported",
  mixed: "Mixed",
  misleading: "Misleading",
  contradicted: "Contradicted",
  insufficient_evidence: "Insufficient Evidence",
};

export const MODE_LABELS: Record<VerificationMode, string> = {
  general: "General",
  investor: "Investor",
  academic: "Academic",
  custom: "Custom Sources",
};

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  government: "Government / official",
  scientific: "Peer-reviewed",
  financial_filing: "Regulatory filing",
  company: "Company primary",
  news: "News",
  fact_check: "Fact-checker",
  social: "Social signal",
  custom_corpus: "Your corpus",
};

export const CLAIM_STAGE_LABELS: Record<ClaimState, string> = {
  DETECTED: "Claim detected",
  QUEUED: "Queued",
  RESEARCHING: "Searching evidence",
  CHALLENGING: "Checking contradictions",
  SYNTHESIZING: "Generating verdict",
  COMPLETED: "Verdict ready",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  VERIFICATION_ERROR: "Verification error",
};

export const TERMINAL_STATES: ClaimState[] = [
  "COMPLETED",
  "INSUFFICIENT_EVIDENCE",
  "VERIFICATION_ERROR",
];

export function isTerminal(state: ClaimState) {
  return TERMINAL_STATES.includes(state);
}

export type ClaimFilter = "all" | "supported" | "questionable" | "contradicted" | "insufficient";

export function matchesFilter(claim: AtomicClaim, filter: ClaimFilter) {
  if (filter === "all") return true;
  const verdict = claim.result?.verdict;
  if (!verdict) return false;
  switch (filter) {
    case "supported":
      return verdict === "supported";
    case "questionable":
      return verdict === "mostly_supported" || verdict === "mixed" || verdict === "misleading";
    case "contradicted":
      return verdict === "contradicted";
    case "insufficient":
      return verdict === "insufficient_evidence";
  }
}

export function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
