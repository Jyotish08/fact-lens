import type {
  EvidenceConfidence,
  QualitativeLevel,
  RetrievalCoverage,
  SourceTier,
  Verdict,
} from "../../types";
import type { AggregationResult } from "./aggregate";
import { DEFAULT_THRESHOLDS, type PipelineV2Thresholds } from "./thresholds";
import { applyCalibration, CALIBRATION_VERSION } from "./calibration-table";

export interface ComputeConfidenceV2Input {
  verdict: Verdict;
  aggregation: AggregationResult;
  coverage: RetrievalCoverage;
  evidenceTiers: SourceTier[];
  isTimeless?: boolean | undefined;
}

export function levelFromScore(score: number, highThresh = 0.70, medThresh = 0.40): QualitativeLevel {
  if (score >= highThresh) return "high";
  if (score >= medThresh) return "medium";
  return "low";
}

export function computeConfidenceV2(
  input: ComputeConfidenceV2Input,
  thresholds: PipelineV2Thresholds = DEFAULT_THRESHOLDS,
): EvidenceConfidence & { calibration: { status: "uncalibrated" | "calibrated"; mappingVersion?: string } } {
  const { verdict, aggregation, coverage, evidenceTiers, isTimeless } = input;
  const { S, C, supportClusters, contradictClusters } = aggregation;

  const coverageRatio =
    coverage.queriesRequested > 0
      ? coverage.queriesSucceeded / coverage.queriesRequested
      : 1;

  let raw = 50;

  if (verdict === "insufficient_evidence") {
    const distinctTiers = new Set(evidenceTiers).size;
    const verifiedRatio = Math.min(coverage.passagesVerified / 10, 1);
    const tierRatio = Math.min(distinctTiers / 3, 1);

    raw = 50 * coverageRatio + 30 * verifiedRatio + 20 * tierRatio;
  } else {
    // Decisive verdicts: supported, mostly_supported, contradicted, mixed, misleading
    let fit = 0;
    let decidingClusters = 0;
    let bestTierWeight = 0.5;

    if (verdict === "supported" || verdict === "mostly_supported" || verdict === "misleading") {
      fit = S;
      decidingClusters = supportClusters.length;
      if (aggregation.bestSupportTier) {
        bestTierWeight = thresholds.tierWeights[aggregation.bestSupportTier] ?? 0.5;
      }
    } else if (verdict === "contradicted") {
      fit = C;
      decidingClusters = contradictClusters.length;
      if (aggregation.bestContradictTier) {
        bestTierWeight = thresholds.tierWeights[aggregation.bestContradictTier] ?? 0.5;
      }
    } else if (verdict === "mixed") {
      fit = Math.min(S, C);
      decidingClusters = Math.min(supportClusters.length, contradictClusters.length);
      bestTierWeight = Math.max(
        aggregation.bestSupportTier ? thresholds.tierWeights[aggregation.bestSupportTier] ?? 0.5 : 0.5,
        aggregation.bestContradictTier ? thresholds.tierWeights[aggregation.bestContradictTier] ?? 0.5 : 0.5,
      );
    }

    const margin = Math.max(0, Math.min(1, Math.abs(S - C)));
    const clusterBreadth = Math.min(decidingClusters / 3, 1);
    const freshnessFit = isTimeless ? 1.0 : 0.8;

    raw =
      45 * fit +
      20 * margin +
      15 * clusterBreadth +
      10 * bestTierWeight +
      10 * freshnessFit -
      10 * (1 - coverageRatio);
  }

  const rawScore = Math.max(5, Math.min(95, Math.round(raw)));
  const score = applyCalibration(rawScore);

  const strength = levelFromScore(Math.max(S, C), 0.75, 0.50);
  const contradiction = levelFromScore(C, 0.60, 0.30);
  const freshness = levelFromScore(0.85, 0.80, 0.50);

  return {
    score,
    evidenceStrength: strength,
    contradiction,
    freshness,
    calibration: {
      status: "calibrated",
      mappingVersion: CALIBRATION_VERSION,
    },
  };
}
