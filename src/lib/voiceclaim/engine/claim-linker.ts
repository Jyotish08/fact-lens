import type { AtomicClaim, DiscourseRelation } from "../types";

export interface ClaimLinkDecision {
  relation: DiscourseRelation;
  parentClaimId?: string;
  duplicateOf?: string;
}

const words = (text: string) => new Set(text.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((word) => word.length > 2));
const numbers = (text: string) => text.match(/\b\d+(?:\.\d+)?\b/g)?.join(",") ?? "";

/** Deterministic linker used before queueing so repeated utterances do not re-run verification. */
export function linkClaim(candidate: AtomicClaim, existing: AtomicClaim[]): ClaimLinkDecision {
  if (candidate.discourseRelation === "duplicate" || candidate.discourseRelation === "modifies_previous" || candidate.discourseRelation === "contradicts_earlier") {
    const parent = existing.at(-1);
    return parent ? { relation: candidate.discourseRelation, parentClaimId: parent.id } : { relation: candidate.discourseRelation };
  }
  const candidateWords = words(candidate.normalizedClaim);
  for (const prior of [...existing].reverse()) {
    if (candidate.timestampMs - prior.timestampMs > 60_000) break;
    const priorWords = words(prior.normalizedClaim);
    const intersection = [...candidateWords].filter((word) => priorWords.has(word)).length;
    const union = new Set([...candidateWords, ...priorWords]).size;
    if (numbers(candidate.normalizedClaim) === numbers(prior.normalizedClaim) && union > 0 && intersection / union >= 0.86) return { relation: "duplicate", duplicateOf: prior.id, parentClaimId: prior.id };
  }
  return { relation: candidate.discourseRelation ?? "new_claim" };
}
