import type { AtomicClaim, EvidenceItem, SourceTier } from "../../types";
import { DEFAULT_THRESHOLDS, type PipelineV2Thresholds } from "./thresholds";

export interface ClusterScore {
  clusterId: string;
  tier: SourceTier;
  maxSupportWeight: number;
  maxContradictWeight: number;
  items: EvidenceItem[];
  publishedAt?: string | undefined;
}

export interface AggregationResult {
  S: number;
  C: number;
  supportClusters: ClusterScore[];
  contradictClusters: ClusterScore[];
  fullEntail: boolean;
  hasQuantityMismatch: boolean;
  hasQuantityWithinTolerance: boolean;
  bestSupportTier?: SourceTier | undefined;
  bestContradictTier?: SourceTier | undefined;
}

/**
 * Calculates noisy-OR over top-k scores: 1 - prod(1 - c_i)
 */
export function noisyOr(scores: number[], k = 3): number {
  const top = [...scores].sort((a, b) => b - a).slice(0, k);
  if (top.length === 0) return 0;
  let prod = 1;
  for (const s of top) {
    const clamped = Math.max(0, Math.min(1, s));
    prod *= 1 - clamped;
  }
  return Math.round((1 - prod) * 1000) / 1000;
}

export function aggregateEvidenceV2(
  claim: AtomicClaim,
  evidence: EvidenceItem[],
  thresholds: PipelineV2Thresholds = DEFAULT_THRESHOLDS,
): AggregationResult {
  const clusters = new Map<string, ClusterScore>();

  for (const item of evidence) {
    const clusterId = item.clusterId ?? item.id;
    const tier: SourceTier = (item.tier as SourceTier) ?? "secondary";
    let baseTierWeight = thresholds.tierWeights[tier] ?? 0.50;

    // Self-report modifier: if claimant is talking about own org metrics, discount support from own site
    if (claim.frame?.claimType === "self_report" && tier === "primary_org") {
      baseTierWeight = 0.50;
    }

    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        clusterId,
        tier,
        maxSupportWeight: 0,
        maxContradictWeight: 0,
        items: [],
        publishedAt: item.publishedAt,
      });
    }

    const cluster = clusters.get(clusterId)!;
    cluster.items.push(item);
    if (!cluster.publishedAt && item.publishedAt) {
      cluster.publishedAt = item.publishedAt;
    }

    const entail = item.verifier?.entail ?? (item.relation === "supports" ? 0.8 : 0);
    const contradict = item.verifier?.contradict ?? (item.relation === "contradicts" ? 0.8 : 0);

    if (item.relation === "supports") {
      const weight = baseTierWeight * entail;
      if (weight > cluster.maxSupportWeight) {
        cluster.maxSupportWeight = weight;
      }
    } else if (item.relation === "contradicts") {
      const weight = baseTierWeight * contradict;
      if (weight > cluster.maxContradictWeight) {
        cluster.maxContradictWeight = weight;
      }
    }
  }

  const allClusters = Array.from(clusters.values());

  const supportClusters = allClusters
    .filter((c) => c.maxSupportWeight > 0)
    .sort((a, b) => b.maxSupportWeight - a.maxSupportWeight);

  const contradictClusters = allClusters
    .filter((c) => c.maxContradictWeight > 0)
    .sort((a, b) => b.maxContradictWeight - a.maxContradictWeight);

  const S = noisyOr(supportClusters.map((c) => c.maxSupportWeight), 3);
  const C = noisyOr(contradictClusters.map((c) => c.maxContradictWeight), 3);

  // fullEntail: exists a supports item with entail >= tau_full (0.85) from tier >= established_news
  const fullEntail = evidence.some((item) => {
    if (item.relation !== "supports") return false;
    const tier = item.tier as SourceTier;
    const isCredibleTier =
      tier === "primary_official" ||
      tier === "primary_org" ||
      tier === "user_corpus" ||
      tier === "established_news";
    const entail = item.verifier?.entail ?? 0;
    return isCredibleTier && entail >= thresholds.fullEntailThreshold;
  });

  const hasQuantityMismatch = evidence.some(
    (item) => item.quantityCheck === "mismatch",
  );

  const hasQuantityWithinTolerance = evidence.some(
    (item) => item.quantityCheck === "within_tolerance",
  );

  return {
    S,
    C,
    supportClusters,
    contradictClusters,
    fullEntail,
    hasQuantityMismatch,
    hasQuantityWithinTolerance,
    bestSupportTier: supportClusters[0]?.tier,
    bestContradictTier: contradictClusters[0]?.tier,
  };
}
