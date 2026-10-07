import type { SourceCategory, SourceTier } from "../../types";

export interface SourceDocument {
  docId: string;
  url: string;
  registrableDomain: string;
  title: string;
  cleanedText: string;
  contentHash: string;
  retrievalEventId: string;
  publishedAt: string | null;
  publishedAtSource: "page_metadata" | "page_text" | "serp" | "unknown";
  tier: SourceTier;
  category: SourceCategory;
  wireMarker: string | null;
}

export interface Passage {
  passageId: string; // `${docId}#p${n}`
  docId: string;
  start: number; // char offsets into cleanedText
  end: number;
  text: string; // cleanedText.slice(start, end)
  contextText: string; // neighbor window (prev+self+next) for verification
  relevance: number; // RRF-fused rank score, normalized 0..1 (relevance only)
}

export interface VerifierOutput {
  passageId: string;
  entail: number;
  neutral: number;
  contradict: number;
  supportSpan: { start: number; end: number } | null;
  verifierId: string;
}
