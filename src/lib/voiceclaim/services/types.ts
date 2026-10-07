import type {
  AtomicClaim,
  EvidenceItem,
  SessionSettings,
  StatementClassification,
  TranscriptChunk,
  TranscriptSegment,
  ConversationContextSnapshot,
  VerificationResult,
} from "../types";

export type TranscriptEvent =
  | { type: "interim"; segment: TranscriptSegment }
  | { type: "final"; segment: TranscriptSegment }
  | {
      type: "connection";
      status: "connected" | "reconnecting" | "closed";
      attempt?: number | undefined;
      incompleteInterval?: { startMs: number; endMs: number } | undefined;
    }
  | {
      type: "progress";
      stage: "uploading" | "transcribing" | "processing" | "cleaning_up";
      message: string;
      detail?: string | undefined;
      percent: number;
    }
  | { type: "end" };

/**
 * Streaming speech-to-text. The mock replays a scripted scenario; the real
 * implementation opens a Speechmatics realtime socket and emits the same events.
 */
export interface TranscriptionService {
  start(handler: (event: TranscriptEvent) => void): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface ExtractedClaim {
  normalizedClaim: string;
  context: string;
  priority: number;
  frame?: import("../types").ClaimFrame | undefined;
  antecedentSegmentIds?: string[] | undefined;
  resolution?: import("../types").ContextualResolution | undefined;
  discourseRelation?: import("../types").DiscourseRelation | undefined;
}

export interface ExtractionOutput {
  classification: StatementClassification;
  originalText: string;
  claims: ExtractedClaim[];
  requiresMoreContext: boolean;
}

/**
 * Claim Extractor stage. Classifies a completed statement and decomposes it
 * into atomic assertions. Backed by the AI/ML API in production.
 */
export interface ClaimExtractionService {
  extract(
    chunk: TranscriptChunk,
    settings: SessionSettings,
    context?: {
      previousTail?: string | undefined;
      sessionTitle?: string | undefined;
      anchorDate?: string | undefined;
      contextSnapshot?: ConversationContextSnapshot | undefined;
    },
  ): Promise<ExtractionOutput>;
}

export type VerificationUpdate =
  | { type: "stage"; state: AtomicClaim["state"] }
  | { type: "evidence"; items: EvidenceItem[] }
  | { type: "result"; result: VerificationResult }
  | { type: "error"; message: string };

/**
 * Evidence Agent -> Adversarial Skeptic -> Synthesizer, orchestrated server-side.
 * Bright Data Web MCP performs retrieval; the AI/ML API powers each agent.
 */
export interface VerificationService {
  verify(
    claim: AtomicClaim,
    settings: SessionSettings,
    onUpdate: (update: VerificationUpdate) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface EvidenceCorpusService {
  register(files: File[]): Promise<void>;
  contextForClaim(claim: string): Promise<string>;
  clear(): Promise<void> | void;
}

export interface VoiceClaimServices {
  transcription: TranscriptionService;
  extraction: ClaimExtractionService;
  verification: VerificationService;
  corpus: EvidenceCorpusService;
}
