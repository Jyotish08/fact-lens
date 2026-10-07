import type {
  AtomicClaim,
  EvidenceItem,
  ReasonCode,
  Verdict,
} from "../../types";
import { structuredCompletion } from "../openai.server";
import {
  synthesisPrompt,
  type SynthesisOutput,
} from "../prompts/synthesis";

export interface GenerateSynthesisV2Input {
  claim: AtomicClaim;
  verdict: Verdict;
  reasonCode: ReasonCode;
  evidence: EvidenceItem[];
  missingContext?: string | undefined;
  support: number;
  contradiction: number;
  customContext?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface SynthesisV2Result {
  summary: string;
  explanation: string;
  challengeSummary: string;
  evidenceGaps: string[];
  recommendedActions: string[];
}

export function generateTemplateSummary(
  claim: AtomicClaim,
  verdict: Verdict,
  reasonCode: ReasonCode,
  missingContext?: string,
): string {
  const claimText = claim.normalizedClaim;
  switch (verdict) {
    case "supported":
      return `The claim that "${claimText}" is strongly supported by authoritative and independent sources.`;
    case "mostly_supported":
      return `The claim that "${claimText}" is corroborated by reliable evidence with minor approximations or caveats.`;
    case "contradicted":
      return `The claim that "${claimText}" is refuted by independent official data and credible sources.`;
    case "misleading":
      return `The claim that "${claimText}" is technically true or partially grounded, but materially misleading. ${missingContext ?? "Crucial context was omitted."}`;
    case "mixed":
      return `Credible independent sources report conflicting findings regarding "${claimText}".`;
    case "insufficient_evidence":
    default:
      if (reasonCode === "AMBIGUOUS_CLAIM") {
        return `The claim "${claimText}" contains unresolved referents and lacks specific context to verify.`;
      }
      if (reasonCode === "PARTIAL_RETRIEVAL_FAILURE") {
        return `Search providers were partially unavailable, resulting in insufficient evidence to determine "${claimText}".`;
      }
      return `Available public evidence is insufficient to verify or dispute "${claimText}".`;
  }
}

export function validateAndCleanSummary(
  summary: string,
  verdict: Verdict,
  fallback: string,
): string {
  const lower = summary.toLowerCase();
  if (verdict === "supported" && (lower.includes("is false") || lower.includes("is contradicted") || lower.includes("is refuted"))) {
    return fallback;
  }
  if (verdict === "contradicted" && (lower.includes("is supported") || lower.includes("is confirmed") || lower.includes("is accurate"))) {
    return fallback;
  }
  if (verdict === "insufficient_evidence" && (lower.includes("is fully supported") || lower.includes("is conclusively debunked"))) {
    return fallback;
  }
  return summary.trim() || fallback;
}

export async function generateSynthesisV2(
  input: GenerateSynthesisV2Input,
): Promise<SynthesisV2Result> {
  const {
    claim,
    verdict,
    reasonCode,
    evidence,
    missingContext,
    support,
    contradiction,
    customContext,
    signal,
  } = input;

  const fallbackSummary = generateTemplateSummary(claim, verdict, reasonCode, missingContext);
  const fallbackExplanation = fallbackSummary;
  const fallbackChallenge =
    contradiction > 0.4
      ? "Opposing data was identified in retrieved sources."
      : "No significant contradictory evidence was identified in public records.";
  const fallbackActions =
    verdict === "insufficient_evidence"
      ? ["Provide additional organizational or primary documents", "Clarify ambiguous dates or entity names"]
      : ["Review linked primary source filings"];

  const deterministicGaps: string[] = [];
  if (claim.frame?.temporal.anchorSource === "unknown" && claim.frame.temporal.expression) {
    deterministicGaps.push(`Relative temporal expression "${claim.frame.temporal.expression}" could not be anchored to an exact date.`);
  }
  if (claim.asrFlags?.lowConfidenceTokens?.length) {
    deterministicGaps.push(`Potential transcription noise in numbers: ${claim.asrFlags.lowConfidenceTokens.join(", ")}`);
  }

  const evidenceRecords = evidence.map((e) => ({
    id: e.id,
    title: e.title,
    domain: e.domain,
    excerpt: e.excerpt,
    authority: e.authority,
    relation: e.relation,
  }));

  try {
    const raw = (await structuredCompletion({
      system: synthesisPrompt.system,
      user: synthesisPrompt.buildUser({
        normalizedClaim: claim.normalizedClaim,
        verdict,
        evidence: evidenceRecords,
        support,
        contradiction,
        ...(customContext ? { customContext } : {}),
      }),
      output: synthesisPrompt.output,
      jsonSchema: synthesisPrompt.jsonSchema,
      ...(signal ? { signal } : {}),
    })) as SynthesisOutput;

    const cleanSummary = validateAndCleanSummary(raw.summary, verdict, fallbackSummary);
    const combinedGaps = Array.from(new Set([...deterministicGaps, ...(raw.evidenceGaps || [])]));

    return {
      summary: cleanSummary,
      explanation: raw.explanation || fallbackExplanation,
      challengeSummary: raw.challengeSummary || fallbackChallenge,
      evidenceGaps: combinedGaps,
      recommendedActions: raw.recommendedActions || fallbackActions,
    };
  } catch {
    return {
      summary: fallbackSummary,
      explanation: fallbackExplanation,
      challengeSummary: fallbackChallenge,
      evidenceGaps: deterministicGaps,
      recommendedActions: fallbackActions,
    };
  }
}
