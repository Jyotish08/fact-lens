import type { AtomicClaim, ClaimFrame } from "./types";

export function deterministicPriority(
  claim: string,
  mode: AtomicClaim["mode"],
  manual = false,
  frame?: ClaimFrame | undefined,
) {
  if (manual) return 100;
  const namedEntities = (claim.match(/\b[A-Z][a-zA-Z0-9&.-]+(?:\s+[A-Z][a-zA-Z0-9&.-]+)*/g) ?? [])
    .length;
  const quantities = (claim.match(/\b\d+(?:\.\d+)?%?|\$\d+/g) ?? []).length;
  const temporal = /\b(19|20)\d{2}\b|\b(today|yesterday|last|next|quarter|year|month|week)\b/i.test(
    claim,
  );
  const specificity = Math.min(claim.split(/\s+/).length / 24, 1);
  const evidenceAvailability =
    /\b(revenue|profit|study|reported|filed|rate|population|trial|dataset)\b/i.test(claim)
      ? 1
      : mode === "general"
        ? 0.55
        : 0.75;

  let score =
    0.25 +
    0.2 * specificity +
    0.15 * Math.min(namedEntities / 2, 1) +
    0.15 * Math.min(quantities, 1) +
    0.1 * Number(temporal) +
    0.15 * evidenceAvailability;

  if (frame) {
    if (frame.quantities.length > 0) score += 0.1;
    if (frame.claimType === "quantity" || frame.claimType === "ranking") score += 0.05;
  }

  return Math.min(100, Math.round(100 * score));
}
